import { access, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { ensureTask, normalizeUtterance, validatePlan, isInsideFolder, type Verdict } from "@followup/core";
import { BudgetStop, isPhaseName } from "./budget.js";
import { confirmOrganize, postChat, readChat } from "./chat/service.js";
import { HttpError, bad } from "./http-error.js";
import { runCollection } from "./jobs/collect.js";
import { holdMorning, morningAlreadySettled, readJob, recoverJobs, writeJob, type JobState } from "./jobs/job-store.js";
import { appendTrace } from "./jobs/trace.js";
import { extractJson } from "./model/json.js";
import { createNote, saveMaterialUrl, saveNoteText } from "./notes/create.js";
import { discoverCatalog } from "./opencli/catalog.js";
import { runDueTopics } from "./schedule/due.js";
import { listBriefs, listSnapshots, readBriefFile } from "./topic/archive.js";
import {
  applyThemeCard,
  blankThemeCard,
  clearPending,
  coerceAssignment,
  coerceQueries,
  createTopicFolder,
  readPending,
  readRegistry,
  readTheme,
  topicChatPath,
  writeRegistry,
  writeTheme,
  type ThemeCardInput,
  type ThemeFile,
} from "./topic/store.js";
import { mountLedger } from "./ledger/http.js";
import { DIR_BRIEF, DIR_MATERIAL, DIR_NOTE, DIR_SNAPSHOT, THEME_FILE, type AppDeps } from "./types.js";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function createApp(deps: AppDeps) {
  const app = new Hono();
  const jobs = new Map<string, JobState>();
  let recovering: Promise<void> | null = null;
  const ensureRecovered = () => {
    recovering ??= recoverJobs(deps, jobs);
    return recovering;
  };

  app.onError((error, c) => {
    if (error instanceof HttpError) return c.json({ error: { code: error.code, message: error.message } }, error.status);
    console.error(error);
    return c.json({ error: { code: "JOB_FAILED", message: "这次没有留下快照。" } }, 500);
  });

  mountLedger(app, deps);

  app.get("/api/health", async (c) => {
    let opencli = true;
    try {
      await deps.runner.run(["opencli", "--version"], 5_000);
    } catch {
      opencli = false;
    }
    return c.json({ ok: true, opencli, model: deps.model.available });
  });

  app.get("/api/topics", async (c) => {
    await ensureRecovered();
    return c.json({ topics: await listCards(deps) });
  });

  app.delete("/api/topics/:id", async (c) => {
    const id = c.req.param("id");
    const registry = await readRegistry(deps);
    const record = registry.topics.find((topic) => topic.id === id);
    if (!record) throw bad(404, "TOPIC_NOT_FOUND", "找不到这个主题。");
    registry.topics = registry.topics.filter((topic) => topic.id !== id);
    await writeRegistry(deps, registry);
    jobs.delete(id);
    await rm(path.dirname(topicChatPath(deps, id)), { recursive: true, force: true });
    const owned = isInsideFolder(deps.topicsRoot, path.resolve(record.folderPath));
    if (owned) await rm(path.resolve(record.folderPath), { recursive: true, force: true });
    return c.json({ ok: true, folderKept: !owned });
  });

  app.post("/api/topics", async (c) => {
    const body = await c.req.json().catch(() => ({})) as { utterance?: string };
    const utterance = normalizeUtterance(body.utterance ?? "");
    if (!utterance) throw bad(400, "UTTERANCE_INVALID", "请用一句话描述主题。");
    const id = crypto.randomUUID();
    const folderPath = await unusedFolder(deps, utterance, id);
    const now = deps.now().toISOString();
    await createTopicFolder(folderPath);
    const theme: ThemeFile = {
      id,
      status: "pending",
      utterance,
      keywords: [],
      ...blankThemeCard(),
      platforms: [],
      queries: [],
      assignment: "",
      morningReport: { enabled: false, time: null },
      folderPath,
      createdAt: now,
      updatedAt: now,
      confirmedAt: null,
    };
    const registry = await readRegistry(deps);
    registry.topics.push({ id, folderPath, createdAt: now });
    await writeRegistry(deps, registry);
    await writeTheme(theme);
    return c.json({ topic: { ...theme, snapshotCount: 0 }, defaultTab: "control" });
  });

  app.post("/api/topics/:id/suggest", async (c) => {
    const theme = await loadTheme(deps, c.req.param("id"));
    if (theme.status !== "pending" || theme.keywords.length > 0 || theme.platforms.length > 0) {
      return c.json({ topic: theme });
    }
    const draft = await proposeDraft(deps, theme.utterance);
    const current = await readTheme(theme.folderPath);
    if (current.status !== "pending" || current.keywords.length > 0 || current.platforms.length > 0) {
      return c.json({ topic: current });
    }
    current.keywords = draft.keywords;
    current.platforms = draft.platforms.map((command) => ({ command, selected: true }));
    current.updatedAt = deps.now().toISOString();
    await writeTheme(current);
    return c.json({ topic: current });
  });

  app.get("/api/topics/:id", async (c) => {
    const theme = await loadTheme(deps, c.req.param("id"));
    const snapshots = await listSnapshots(theme.folderPath).catch(() => []);
    return c.json({
      topic: { ...theme, snapshotCount: snapshots.length },
      pending: await readPending(deps, theme.id),
      defaultTab: theme.status === "pending" ? "control" : "overview",
    });
  });

  app.post("/api/topics/:id/confirm", async (c) => {
    const theme = await loadTheme(deps, c.req.param("id"));
    if (theme.status === "confirmed") throw bad(409, "ALREADY_CONFIRMED", "计划已经确认，请在设置里修改。");
    const body = await c.req.json() as { keywords?: string[]; platforms?: string[]; folderPath?: string; card?: ThemeCardInput };
    const next = applyTask(theme, applyThemeCard(await acceptPlan(deps, theme, body.keywords ?? [], body.platforms ?? [], body.folderPath ?? theme.folderPath), body.card));
    next.status = "confirmed";
    next.confirmedAt = deps.now().toISOString();
    next.updatedAt = next.confirmedAt;
    await writeTheme(next);
    await pointRegistry(deps, next);
    return c.json({ topic: next });
  });

  app.patch("/api/topics/:id/plan", async (c) => {
    const theme = await loadTheme(deps, c.req.param("id"));
    if (theme.status !== "confirmed") throw bad(409, "PLAN_NOT_CONFIRMED", "请先同意调研方案。");
    const body = await c.req.json() as {
      keywords?: string[];
      platforms?: string[];
      folderPath?: string;
      morningReport?: { enabled?: boolean; time?: string | null };
      card?: ThemeCardInput;
    };
    let next = { ...theme, morningReport: { ...theme.morningReport } };
    if (body.keywords || body.platforms || body.folderPath) {
      next = await acceptPlan(
        deps,
        next,
        body.keywords ?? next.keywords,
        body.platforms ?? next.platforms.filter((platform) => platform.selected).map((platform) => platform.command),
        body.folderPath ?? next.folderPath,
      );
    }
    if (body.morningReport) {
      const enabled = body.morningReport.enabled ?? next.morningReport.enabled;
      const time = body.morningReport.time === undefined ? next.morningReport.time : body.morningReport.time;
      if (enabled) {
        const snapshots = await listSnapshots(next.folderPath);
        if (snapshots.length === 0) throw bad(409, "NO_SNAPSHOT", "请先完成一次调研。");
        if (!time || !TIME_PATTERN.test(time)) throw bad(400, "PLAN_INVALID", "请至少留下一个关键词，并勾选一个平台。");
        next.morningReport = { enabled: true, time };
      } else {
        next.morningReport = { enabled: false, time: time && TIME_PATTERN.test(time) ? time : next.morningReport.time };
      }
    }
    if (body.card) next = applyThemeCard(next, body.card);
    next = applyTask(theme, next);
    next.updatedAt = deps.now().toISOString();
    await writeTheme(next);
    await pointRegistry(deps, next);
    return c.json({ topic: next });
  });

  app.post("/api/topics/:id/folder/open", async (c) => {
    const theme = await loadTheme(deps, c.req.param("id"));
    await deps.openFolder(theme.folderPath);
    return c.json({ ok: true });
  });

  app.post("/api/folders/pick", async (c) => c.json({ path: await deps.pickFolder() }));

  app.get("/api/catalog", async (c) => c.json(await discoverCatalog(deps, false)));
  app.post("/api/catalog/refresh", async (c) => c.json(await discoverCatalog(deps, true)));

  app.get("/api/topics/:id/tree", async (c) => {
    const theme = await loadTheme(deps, c.req.param("id"));
    return c.json(await fileTree(theme.folderPath));
  });

  app.get("/api/topics/:id/file", async (c) => {
    const theme = await loadTheme(deps, c.req.param("id"));
    const relative = c.req.query("path") ?? "";
    if (!isInsideFolder(theme.folderPath, relative)) throw bad(400, "PATH_ESCAPE", "只能读取这个主题文件夹里的文件。");
    const absolute = path.resolve(theme.folderPath, relative);
    const bytes = await readFile(absolute).catch(() => {
      throw bad(404, "TOPIC_NOT_FOUND", "找不到这个主题。");
    });
    const truncated = bytes.byteLength > 1_000_000;
    return c.json({ path: relative, text: bytes.subarray(0, 1_000_000).toString("utf8"), truncated });
  });

  app.post("/api/topics/:id/materials", async (c) => {
    const theme = await loadTheme(deps, c.req.param("id"));
    const body = await c.req.json() as { url?: string };
    return c.json({ path: await saveMaterialUrl(deps, theme.folderPath, body.url ?? "") });
  });

  app.post("/api/topics/:id/notes", async (c) => {
    const theme = await loadTheme(deps, c.req.param("id"));
    const body = await c.req.json() as { url?: string; materialPath?: string; text?: string };
    if (typeof body.text === "string" && body.text.trim()) {
      return c.json({ path: await saveNoteText(deps, theme.folderPath, body.text) });
    }
    if (theme.status !== "confirmed") throw bad(409, "PLAN_NOT_CONFIRMED", "请先同意调研方案。");
    return c.json({ path: await createNote(deps, theme.folderPath, body) });
  });

  app.post("/api/topics/:id/jobs", async (c) => {
    await ensureRecovered();
    const theme = await loadTheme(deps, c.req.param("id"));
    const body = await c.req.json() as { kind?: "collect" | "research" | "track" };
    const kind = body.kind === "track" || body.kind === "research" ? body.kind : "collect";
    await assertRunnable(theme, kind);
    const work = startJob(deps, jobs, theme.id, kind, null);
    void work.catch(() => undefined);
    return c.json({ job: jobs.get(theme.id) });
  });

  app.get("/api/topics/:id/jobs/current", async (c) => {
    await ensureRecovered();
    return c.json({ job: jobs.get(c.req.param("id")) ?? null });
  });

  app.get("/api/topics/:id/overview", async (c) => {
    await ensureRecovered();
    const theme = await loadTheme(deps, c.req.param("id"));
    const body = await overview(theme.folderPath);
    return c.json({ ...body, halted: haltText(jobs.get(theme.id)) });
  });

  app.get("/api/topics/:id/brief/latest", async (c) => {
    const theme = await loadTheme(deps, c.req.param("id"));
    const briefs = await listBriefs(theme.folderPath);
    const latest = briefs.at(-1) ?? null;
    return c.json({ brief: latest ? { ...latest, text: latest.body } : null });
  });

  app.get("/api/topics/:id/snapshots/:snapshotId", async (c) => {
    const theme = await loadTheme(deps, c.req.param("id"));
    const snapshots = await listSnapshots(theme.folderPath);
    const snapshot = snapshots.find((item) => item.id === c.req.param("snapshotId"));
    if (!snapshot) throw bad(404, "TOPIC_NOT_FOUND", "找不到这个主题。");
    let briefText = "";
    try {
      briefText = (await readBriefFile(path.join(theme.folderPath, DIR_BRIEF, `${snapshot.id}.md`))).body;
    } catch {
      briefText = "";
    }
    return c.json({ snapshot, briefText });
  });

  app.get("/api/topics/:id/chat", async (c) => c.json({ messages: await readChat(deps, c.req.param("id")) }));

  app.post("/api/topics/:id/chat", async (c) => {
    const theme = await loadTheme(deps, c.req.param("id"));
    const body = await c.req.json() as { text?: string };
    const result = await postChat(deps, theme.id, theme.folderPath, body.text ?? "");
    return c.json(result);
  });

  app.post("/api/topics/:id/pending/confirm", async (c) => {
    await ensureRecovered();
    const theme = await loadTheme(deps, c.req.param("id"));
    const pending = await readPending(deps, theme.id);
    if (!pending) throw bad(404, "TOPIC_NOT_FOUND", "找不到这个主题。");
    switch (pending.type) {
      case "organize": {
        const notePath = await confirmOrganize(deps, theme.id, theme.folderPath, pending);
        return c.json({ topic: theme, job: null, notePath });
      }
      case "update-plan":
      case "agree-plan": {
        await clearPending(deps, theme.id);
        const planned = applyThemeCard(await acceptPlan(deps, theme, pending.keywords, pending.platforms, theme.folderPath), pending.card);
        const task = ensureTask({
          ...planned,
          queries: coerceQueries(pending.queries),
          assignment: coerceAssignment(pending.assignment),
        });
        const next = { ...planned, queries: task.queries, assignment: task.assignment };
        if (next.status === "pending") {
          next.status = "confirmed";
          next.confirmedAt = deps.now().toISOString();
        }
        next.updatedAt = deps.now().toISOString();
        await writeTheme(next);
        return c.json({ topic: next, job: null });
      }
      case "track":
      case "research":
      case "collect": {
        const queries = coerceQueries(pending.queries);
        const assignment = coerceAssignment(pending.assignment);
        if (queries.length > 0) theme.queries = queries;
        if (assignment) theme.assignment = assignment;
        theme.updatedAt = deps.now().toISOString();
        await writeTheme(theme);
        await clearPending(deps, theme.id);
        await assertRunnable(theme, pending.type);
        const work = startJob(deps, jobs, theme.id, pending.type, null);
        void work.catch(() => undefined);
        return c.json({ topic: theme, job: jobs.get(theme.id) ?? null });
      }
      default: {
        const unreachable: never = pending.type;
        throw unreachable;
      }
    }
  });

  app.delete("/api/topics/:id/pending", async (c) => {
    await clearPending(deps, c.req.param("id"));
    return c.json({ ok: true });
  });

  const tick = async () => {
    await ensureRecovered();
    await runDueTopics(deps, jobs, (topicId, kind, nominalDate) => {
      if (nominalDate && morningAlreadySettled(jobs.get(topicId), nominalDate)) return Promise.resolve();
      return startJob(deps, jobs, topicId, kind, nominalDate);
    });
  };

  app.post("/api/scheduler/tick", async (c) => {
    await tick();
    return c.json({ ok: true });
  });

  return Object.assign(app, { tick });
}

function startJob(deps: AppDeps, jobs: Map<string, JobState>, topicId: string, kind: JobState["kind"], nominalDate: string | null): Promise<void> {
  if (jobs.get(topicId)?.state === "running") throw bad(409, "JOB_BUSY", "这一次采集还没结束。");
  const job: JobState = {
    id: crypto.randomUUID(),
    topicId,
    kind,
    state: "running",
    startedAt: deps.now().toISOString(),
    finishedAt: null,
    snapshotId: null,
    error: null,
    steps: [],
    phase: "采集",
    nominalDate,
  };
  jobs.set(topicId, job);
  let chain = Promise.resolve();
  const save = () => {
    chain = chain.then(() => writeJob(deps, job)).catch(() => undefined);
    return chain;
  };
  return (async () => {
    const started = Date.now();
    const record = (await readRegistry(deps)).topics.find((topic) => topic.id === topicId);
    if (!record) throw bad(404, "TOPIC_NOT_FOUND", "找不到这个主题。");
    await save();
    try {
      const outcome = await runCollection(deps, topicId, record.folderPath, kind, nominalDate, (steps, phase) => {
        job.steps = steps.map((step) => ({ ...step }));
        job.phase = phase;
        void save();
      });
      job.snapshotId = outcome.snapshotId;
      job.error = outcome.halted;
      job.state = outcome.halted ? "failed" : "succeeded";
      await appendTrace(deps, topicId, { action: "job", phase: job.phase, command: kind, ms: Date.now() - started, note: outcome.halted ?? "succeeded" });
    } catch (error) {
      job.state = "failed";
      if (error instanceof BudgetStop) {
        if (isPhaseName(error.phase)) job.phase = error.phase;
        job.error = error.message;
      } else {
        job.error = error instanceof Error ? error.message : "这次没有留下快照。";
      }
      await appendTrace(deps, topicId, { action: "job", phase: job.phase, command: kind, ms: Date.now() - started, note: job.error ?? "failed" });
      if (job.kind === "morning" && job.nominalDate && (job.error ?? "").startsWith("已停在")) {
        await holdMorning(deps, topicId, job.nominalDate);
      }
      throw error;
    } finally {
      job.finishedAt = deps.now().toISOString();
      await save();
    }
  })();
}

function haltText(job: JobState | undefined): string | null {
  if (!job?.error) return null;
  if (job.state === "incomplete") return job.error;
  if (job.state === "failed" && job.error.startsWith("已停在")) return job.error;
  return null;
}

async function assertRunnable(theme: ThemeFile, kind: "collect" | "research" | "track" | "morning") {
  if (theme.status !== "confirmed") throw bad(409, "PLAN_NOT_CONFIRMED", "请先同意调研方案。");
  const snapshots = await listSnapshots(theme.folderPath);
  if (kind === "collect" || kind === "research") return;
  if (snapshots.length === 0) throw bad(409, "NO_SNAPSHOT", "请先完成一次调研。");
}

async function loadTheme(deps: AppDeps, id: string): Promise<ThemeFile> {
  const record = (await readRegistry(deps)).topics.find((topic) => topic.id === id);
  if (!record) throw bad(404, "TOPIC_NOT_FOUND", "找不到这个主题。");
  try {
    await access(record.folderPath);
  } catch {
    throw bad(404, "FOLDER_MISSING", "挂钩文件夹不存在。");
  }
  const theme = await readTheme(record.folderPath);
  theme.folderPath = record.folderPath;
  return theme;
}

function applyTask(before: ThemeFile, next: ThemeFile): ThemeFile {
  const changed = JSON.stringify([before.keywords, before.keywordsEn, before.mustInclude]) !== JSON.stringify([next.keywords, next.keywordsEn, next.mustInclude]);
  const task = ensureTask({
    ...next,
    queries: changed ? [] : next.queries,
    assignment: changed ? "" : next.assignment,
  });
  return { ...next, queries: task.queries, assignment: task.assignment };
}

async function acceptPlan(deps: AppDeps, theme: ThemeFile, keywords: string[], platforms: string[], folderPath: string): Promise<ThemeFile> {
  const catalog = await discoverCatalog(deps, false);
  const selectable = new Set(catalog.commands.filter((entry) => entry.selectable).map((entry) => entry.command));
  if (platforms.some((platform) => !selectable.has(platform))) {
    throw bad(400, "PLATFORM_NOT_SELECTABLE", "这个平台暂不能纳入对比。");
  }
  const validated = validatePlan({ keywords, platforms }, selectable);
  if (!validated.ok) throw bad(400, "PLAN_INVALID", "请至少留下一个关键词，并勾选一个平台。");
  const next = { ...theme, keywords: validated.keywords, platforms: validated.platforms.map((command) => ({ command, selected: true })) };
  if (path.resolve(folderPath) !== path.resolve(theme.folderPath)) await rebind(deps, next, folderPath);
  return next;
}

async function rebind(deps: AppDeps, theme: ThemeFile, folderPath: string): Promise<void> {
  if (!path.isAbsolute(folderPath)) throw bad(400, "FOLDER_INVALID", "这个文件夹路径不能用。");
  const resolved = path.resolve(folderPath);
  const info = await stat(resolved).catch(() => null);
  if (info && !info.isDirectory()) throw bad(400, "FOLDER_INVALID", "这个文件夹路径不能用。");
  const registry = await readRegistry(deps);
  if (registry.topics.some((topic) => topic.id !== theme.id && path.resolve(topic.folderPath) === resolved)) {
    throw bad(409, "FOLDER_OCCUPIED", "这个文件夹已经挂钩到别的主题。");
  }
  const themeFile = path.join(resolved, THEME_FILE);
  try {
    await access(themeFile);
    const existing = await readTheme(resolved);
    if (existing.id !== theme.id) throw bad(409, "FOLDER_OCCUPIED", "这个文件夹已经挂钩到别的主题。");
  } catch (error) {
    if (error instanceof HttpError && error.code !== "ARCHIVE_UNREADABLE") throw error;
  }
  await createTopicFolder(resolved);
  theme.folderPath = resolved;
  theme.updatedAt = deps.now().toISOString();
  await writeTheme(theme);
  await pointRegistry(deps, theme);
  void themeFile;
}

async function pointRegistry(deps: AppDeps, theme: ThemeFile): Promise<void> {
  const registry = await readRegistry(deps);
  const record = registry.topics.find((topic) => topic.id === theme.id);
  if (!record) throw bad(404, "TOPIC_NOT_FOUND", "找不到这个主题。");
  record.folderPath = theme.folderPath;
  await writeRegistry(deps, registry);
}

async function proposeDraft(deps: AppDeps, utterance: string): Promise<{ keywords: string[]; platforms: string[] }> {
  try {
    const catalog = await discoverCatalog(deps, false);
    const selectable = catalog.commands.filter((entry) => entry.selectable && entry.loginState !== "not-logged-in");
    if (!deps.model.available || selectable.length === 0) return { keywords: [], platforms: [] };
    const reply = await deps.model.complete([
      { role: "system", content: "根据原话预选关键词和平台。只输出 JSON：{\"keywords\": string[], \"platforms\": string[]}。platforms 只能从给定命令中选择。" },
      { role: "user", content: JSON.stringify({ utterance, commands: selectable.map((entry) => ({ command: entry.command, description: entry.description, loginState: entry.loginState })) }) },
    ]);
    const parsed = extractJson(reply) as { keywords?: string[]; platforms?: string[] };
    const allowed = new Set(selectable.map((entry) => entry.command));
    return {
      keywords: [...new Set((parsed.keywords ?? []).map((keyword) => keyword.trim()).filter((keyword) => keyword.length > 0 && keyword.length <= 40))].slice(0, 20),
      platforms: (parsed.platforms ?? []).filter((platform) => allowed.has(platform)).slice(0, 20),
    };
  } catch {
    return { keywords: [], platforms: [] };
  }
}

async function listCards(deps: AppDeps) {
  const registry = await readRegistry(deps);
  const cards = [];
  for (const record of registry.topics) {
    let folderMissing = false;
    try {
      await access(record.folderPath);
    } catch {
      folderMissing = true;
    }
    let theme: ThemeFile | null = null;
    try {
      theme = folderMissing ? null : await readTheme(record.folderPath);
    } catch {
      theme = null;
    }
    const snapshots = theme ? await listSnapshots(record.folderPath) : [];
    const briefs = theme ? await listBriefs(record.folderPath) : [];
    const job = await readJob(deps, record.id);
    const verdict = [...briefs].reverse().find((brief) => brief.hasVerdicts);
    cards.push({
      id: record.id,
      utterance: theme?.utterance ?? "档案无法读取",
      folderPath: record.folderPath,
      folderMissing,
      createdAt: record.createdAt,
      lastCollectedAt: snapshots.at(-1)?.collectedAt ?? null,
      morningEnabled: theme?.morningReport.enabled ?? false,
      morningTime: theme?.morningReport.time ?? null,
      hotspotCount: snapshots.at(-1)?.hotspots?.length ?? 0,
      keywords: theme?.keywords ?? [],
      jobState: job?.state === "running" || job?.state === "incomplete" ? job.state : null,
      jobPhase: job?.phase ?? null,
      jobError: haltText(job ?? undefined),
      counts: verdict?.comparisonDate ? {
        appeared: verdict.counts.appeared,
        heating: verdict.counts.heating,
        fading: verdict.counts.fading,
        comparisonDate: verdict.comparisonDate,
      } : null,
    });
  }
  return cards;
}

async function overview(folder: string) {
  const snapshots = await listSnapshots(folder);
  const latest = snapshots.at(-1);
  const groups: Record<Verdict["kind"], Verdict[]> = { appeared: [], heating: [], ongoing: [], fading: [] };
  const briefs = latest ? await listBriefs(folder) : [];
  const brief = briefs.find((item) => item.snapshotId === latest?.id);
  const mode = !latest ? "empty" : latest.trigger === "track" ? "hotspot" : latest.trigger === "morning" ? "daily" : brief?.hasVerdicts ? "legacy" : "research";
  const hotspots = latest?.hotspots ?? [];
  if (!latest) {
    return { empty: true, mode, heading: "尚未调研", baselineLabel: "", hasVerdicts: false, quiet: false, hotspots, groups, newSources: [], failures: [], events: [], clusteringNote: null };
  }
  for (const verdict of brief?.verdicts ?? []) groups[verdict.kind].push(verdict);
  const heading = mode === "hotspot" ? "动态热点追踪" : mode === "daily" ? "每日简报" : mode === "legacy" ? "总状况" : "调研底稿";
  return {
    empty: false,
    mode,
    heading,
    baselineLabel: brief?.baselineLabel ?? latest.baseline.label,
    hasVerdicts: Boolean(brief?.hasVerdicts),
    quiet: (mode === "hotspot" || mode === "daily") && hotspots.length === 0,
    hotspots,
    digests: latest.digests ?? [],
    digestLead: latest.digestLead ?? "",
    digestFollowups: latest.digestFollowups ?? [],
    groups,
    newSources: brief?.newSources ?? [],
    failures: latest.platforms.filter((platform) => platform.status === "failed"),
    events: latest.events.flatMap((event) => {
      const url = latest.items.find((item) => event.itemIds.includes(item.id) && /^https?:\/\//i.test(item.url))?.url;
      if (!url) return [];
      return [{ title: event.title, url, platforms: event.platforms }];
    }),
    clusteringNote: latest.clustering.truncated ? "这次没能合并全部条目" : latest.clustering.degraded ? "这次没能合并同一件事" : null,
  };
}

async function fileTree(folder: string) {
  const entries = [];
  for (const name of [THEME_FILE, DIR_BRIEF, DIR_SNAPSHOT, DIR_NOTE, DIR_MATERIAL]) {
    const absolute = path.join(folder, name);
    const info = await stat(absolute).catch(() => null);
    if (!info) continue;
    if (info.isDirectory()) {
      const children = await readdir(absolute);
      entries.push({
        path: name,
        kind: "dir",
        children: children.map((child) => ({ path: `${name}/${child}`, kind: "file" })),
      });
    } else {
      entries.push({ path: name, kind: "file" });
    }
  }
  return { entries };
}

async function unusedFolder(deps: AppDeps, utterance: string, id: string): Promise<string> {
  const cleaned = utterance.replace(/[\\/:*?"<>|\s]/g, "").slice(0, 24) || "topic";
  let folder = path.join(deps.topicsRoot, `${cleaned}-${id.slice(0, 4)}`);
  let suffix = 2;
  while (await stat(folder).then(() => true).catch(() => false)) {
    folder = path.join(deps.topicsRoot, `${cleaned}-${id.slice(0, 4)}-${suffix}`);
    suffix += 1;
  }
  return folder;
}
