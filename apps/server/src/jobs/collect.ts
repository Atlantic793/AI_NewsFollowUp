import {
  buildQueries,
  composeDigestLead,
  ensureTask,
  countVerdicts,
  dedupeByUrl,
  formatWindowLead,
  isCluePlatform,
  renderDigest,
  freshnessDrop,
  selectHotspots,
  takeToOpen,
  topicDrop,
  titleKey,
  zonedParts,
  type DigestItem,
  type DropReason,
  type HotspotCandidate,
  type HotspotRecord,
} from "@followup/core";
import { BudgetStop, limitsOf, type PhaseName } from "../budget.js";
import { bad } from "../http-error.js";
import { discoverCatalog, runSearchCommand } from "../opencli/catalog.js";
import { genericNormalize } from "../opencli/normalize.js";
import { readEnvelope } from "../opencli/parse.js";
import { listSnapshots, snapshotStamp, writeBrief, writeSnapshot, type SnapshotFile } from "../topic/archive.js";
import { readTheme, writeTheme, type ThemeFile } from "../topic/store.js";
import type { AppDeps, BrowserRecipe, RawItem } from "../types.js";
import { assignEventKeys } from "./cluster.js";
import { explainItems, type ExplainSource } from "./explain.js";
import { firecrawlKey, readPages } from "./pages.js";
import type { JobState, JobStep } from "./job-store.js";
import { appendTrace } from "./trace.js";

interface PlatformResult {
  command: string;
  transport: "adapter" | "browser";
  status: "success" | "failed";
  error?: string;
  itemCount: number;
  loginState?: string;
  items: RawItem[];
}

export async function runCollection(
  deps: AppDeps,
  topicId: string,
  folder: string,
  kind: JobState["kind"],
  nominalDate: string | null,
  onStep: (steps: JobStep[], phase: PhaseName) => void,
): Promise<{ snapshotId: string; halted: string | null }> {
  const theme = await readTheme(folder);
  if (theme.status !== "confirmed") throw bad(409, "PLAN_NOT_CONFIRMED", "请先同意调研方案。");
  const prior = await listSnapshots(folder);
  if ((kind === "track" || kind === "morning") && prior.length === 0) {
    throw bad(409, "NO_SNAPSHOT", "请先完成一次调研。");
  }
  const selected = theme.platforms.filter((platform) => platform.selected).map((platform) => platform.command);
  const task = ensureTask(theme);
  if (theme.queries.join("\n") !== task.queries.join("\n") || theme.assignment !== task.assignment) {
    theme.queries = task.queries;
    theme.assignment = task.assignment;
    theme.updatedAt = formatIso(deps.now(), deps.timeZone);
    await writeTheme(theme);
  }
  const queries = task.queries.length > 0
    ? task.queries
    : buildQueries({ keywords: theme.keywords, keywordsEn: theme.keywordsEn, mustInclude: theme.mustInclude });
  const catalog = await discoverCatalog(deps, false);
  const known = new Set(catalog.commands.map((entry) => entry.command));
  const steps: JobStep[] = [];
  for (const command of selected) {
    for (const keyword of queries) steps.push({ command, keyword, state: "pending" });
  }
  const run = createRun(onStep, steps, deps);
  run.charge("采集");
  run.emit();

  const results: PlatformResult[] = [];
  const adapters = selected.filter((command) => !command.startsWith("browser:"));
  const queue = [...adapters];
  const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
    while (queue.length > 0) {
      const command = queue.shift();
      if (!command) return;
      const result = await collectAdapter(deps, command, queries, known, steps, run);
      results.push(result);
      await appendTrace(deps, topicId, { action: "search", phase: "采集", command, count: result.itemCount, note: result.status });
    }
  });
  await Promise.all(workers);
  const browsed = run.halted() ? [] : await collectBrowsers(deps, topicId, selected, queries, steps, run);
  results.push(...browsed);
  for (const result of browsed) {
    await appendTrace(deps, topicId, { action: "search", phase: "采集", command: result.command, count: result.itemCount, note: result.status });
  }

  if (results.some((result) => result.items.length > 0)) run.markProgress();
  run.charge("清洗去重");
  run.emit();
  const gathered = dedupeByUrl(results.flatMap((result) => result.items)).map((item, index) => ({
    ...item,
    id: `i${index + 1}`,
  }));
  const gated = gathered.map((item) => ({ item, drop: freshnessDrop(item, deps.now(), theme.timeWindow, theme.exclude) ?? undefined }));
  const eligible = gated.flatMap((row) => (row.drop ? [] : [row.item]));
  const { open, held } = takeToOpen([...eligible.filter((item) => item.publishedAt), ...eligible.filter((item) => !item.publishedAt)]);
  const pages = await readPages(deps, open.map((item) => item.url));
  await appendTrace(deps, topicId, { action: "fetch_pages", phase: "清洗去重", count: open.length, note: firecrawlKey() ? "firecrawl" : "local" });
  const judged = open.map((item) => {
    const page = pages.get(item.url);
    const next = { ...item, publishedAt: item.publishedAt || page?.publishedAt || "" };
    const drop = !next.publishedAt
      ? "没有日期" as const
      : freshnessDrop(next, deps.now(), theme.timeWindow, theme.exclude)
        ?? topicDrop({
          title: next.title,
          summary: next.summary,
          body: page?.text ?? "",
          keywords: theme.keywords,
          mustInclude: theme.mustInclude,
          exclude: theme.exclude,
        })
        ?? undefined;
    return { item: next, drop };
  });
  const kept = judged.flatMap((row) => (row.drop ? [] : [row.item]));
  const revised = new Map(judged.map((row) => [row.item.id, row.item]));
  const dropById = new Map<string, DropReason>();
  for (const row of gated) if (row.drop) dropById.set(row.item.id, row.drop);
  for (const row of judged) if (row.drop) dropById.set(row.item.id, row.drop);
  for (const item of held) dropById.set(item.id, item.publishedAt ? "未打开" : "没有日期");
  const windowCounts = {
    outside: [...dropById.values()].filter((reason) => reason === "过了时间窗").length,
    noDate: [...dropById.values()].filter((reason) => reason === "没有日期").length,
    offTopic: [...dropById.values()].filter((reason) => reason === "和主题对不上").length,
  };
  run.charge("聚类");
  run.emit();
  const grouped = await assignEventKeys(kept, deps.model);
  const storedItems: SnapshotFile["items"] = gathered.map((item) => {
    const drop = dropById.get(item.id);
    const stored: SnapshotFile["items"][number] = {
      ...(revised.get(item.id) ?? item),
      eventId: drop ? `drop:${item.id}` : grouped.eventKeyById.get(item.id) ?? `solo:${item.id}`,
    };
    if (drop) stored.drop = drop;
    return stored;
  });
  const events = buildEvents(storedItems.filter((item) => !item.drop));
  const collectedAt = formatIso(deps.now(), deps.timeZone);
  const currentPlatforms = results.map((result) => ({
    command: result.command,
    transport: result.transport,
    status: result.status,
    error: result.error,
    itemCount: result.status === "success" ? result.items.length : 0,
    loginState: result.loginState,
  }));
  const selection = kind === "track" || kind === "morning"
    ? selectHotspots({
        now: deps.now(),
        timeWindow: theme.timeWindow,
        itemCount: theme.itemCount,
        mustInclude: theme.mustInclude,
        exclude: theme.exclude,
        candidates: toCandidates(events, storedItems, prior, theme),
        reported: theme.reported,
        mode: kind === "morning" ? "daily" : "hotspot",
      })
    : null;
  const hotspots = selection?.events ?? [];
  const countLead = formatWindowLead(theme.timeWindow, kept.length, windowCounts);
  const sources = (selection
    ? hotspots.map((event) => ({ title: event.title, url: event.url, summary: event.summary, platform: event.platforms[0] ?? "" }))
    : researchSources(events, storedItems, theme.itemCount)
  ).map((source) => ({ ...source, excerpt: pages.get(source.url)?.text ?? "" }));
  run.charge("分析");
  run.emit();
  const explained = sources.length === 0
    ? { lead: "", items: [] as DigestItem[], followups: [] as string[] }
    : await explainItems(deps, sources, { utterance: theme.utterance, audience: theme.audience, assignment: theme.assignment });
  const digest = { ...explained, lead: composeDigestLead(countLead, explained.lead) };
  const body = renderDigest({
    name: theme.utterance,
    date: zonedParts(deps.now(), deps.timeZone).date,
    brief: digest,
  });
  const counts = countVerdicts([], []);
  run.charge("成稿");
  run.emit();
  const taken = new Set(prior.map((snapshot) => snapshot.id));
  const id = snapshotStamp(deps.now(), deps.timeZone, taken);
  const snapshot: SnapshotFile = {
    id,
    topicId,
    collectedAt,
    trigger: kind,
    nominalDate,
    scheduledTime: kind === "morning" ? theme.morningReport.time : null,
    baseline: {
      kind: "none",
      snapshotId: null,
      collectedAt: null,
      comparisonDate: null,
      label: countLead,
    },
    plan: { keywords: theme.keywords, platforms: selected },
    platforms: currentPlatforms,
    items: storedItems,
    events,
    hotspots,
    digests: digest.items,
    digestLead: digest.lead,
    digestFollowups: digest.followups,
    clustering: { degraded: grouped.degraded, truncated: grouped.truncated },
  };
  await writeSnapshot(folder, snapshot);
  await writeBrief(folder, {
    snapshotId: id,
    trigger: kind,
    collectedAt,
    hasVerdicts: false,
    baselineLabel: countLead,
    comparisonDate: null,
    counts,
    verdicts: [],
    newSources: [],
    body,
  });
  if (selection && hotspots.length > 0) {
    theme.reported = mergeReported(theme.reported, hotspots, collectedAt);
    theme.updatedAt = collectedAt;
    await writeTheme(theme);
  }
  return { snapshotId: id, halted: run.halted() };
}

function researchSources(events: SnapshotFile["events"], items: SnapshotFile["items"], limit: number): ExplainSource[] {
  const sources: ExplainSource[] = [];
  for (const event of events) {
    if (sources.length >= limit) break;
    const group = items.filter((item) => event.itemIds.includes(item.id) && /^https?:\/\//i.test(item.url));
    const primary = group[0];
    if (!primary) continue;
    sources.push({
      title: event.title,
      url: primary.url,
      summary: group.map((item) => item.summary).sort((left, right) => right.length - left.length)[0] ?? "",
      platform: primary.platform,
    });
  }
  return sources;
}

function toCandidates(events: SnapshotFile["events"], items: SnapshotFile["items"], prior: SnapshotFile[], theme: ThemeFile): HotspotCandidate[] {
  const candidates: HotspotCandidate[] = [];
  for (const event of events) {
    const group = items.filter((item) => event.itemIds.includes(item.id));
    const http = group.filter((item) => /^https?:\/\//i.test(item.url));
    const primary = http.find((item) => !isCluePlatform(item.platform));
    if (!primary) continue;
    const key = titleKey(event.title);
    const history = prior.filter((snapshot) => snapshot.events.some((item) => titleKey(item.title) === key));
    const previous = history.at(-1);
    const previousCount = previous?.events.find((item) => titleKey(item.title) === key)?.platforms.length ?? 0;
    const reportedStage = theme.reported.find((item) => item.eventKey === key)?.stage ?? null;
    const snapshotStage = [...prior].reverse().flatMap((snapshot) => snapshot.hotspots ?? []).find((item) => item.eventKey === key)?.stage ?? null;
    candidates.push({
      eventKey: key,
      title: event.title,
      url: primary.url,
      summary: group.map((item) => item.summary).sort((left, right) => right.length - left.length)[0] ?? "",
      platforms: [...new Set(group.map((item) => item.platform))],
      publishedAt: group.map((item) => item.publishedAt).sort().at(-1) ?? primary.publishedAt,
      priorAppearances: history.length,
      priorSourceCount: previousCount,
      priorStage: reportedStage ?? snapshotStage,
    });
  }
  return candidates;
}

function mergeReported(current: ThemeFile["reported"], events: HotspotRecord[], reportedAt: string): ThemeFile["reported"] {
  const next = current.filter((item) => !events.some((event) => event.eventKey === item.eventKey));
  for (const event of events) {
    next.push({ eventKey: event.eventKey, title: event.title, stage: event.stage, reportedAt });
  }
  return next;
}

async function collectAdapter(
  deps: AppDeps,
  command: string,
  keywords: string[],
  known: Set<string>,
  steps: JobStep[],
  run: CollectionRun,
): Promise<PlatformResult> {
  if (!known.has(command)) {
    markSteps(steps, command, "failed", run.emit);
    return { command, transport: "adapter", status: "failed", error: "命令不在当前清单。", itemCount: 0, items: [] };
  }
  const items: RawItem[] = [];
  let error = "";
  for (const keyword of keywords) {
    if (!run.beat()) break;
    markOne(steps, command, keyword, "running", run.emit);
    const result = await runSearchCommand(deps, command, keyword);
    if (!result.ok) {
      error = result.message;
      markOne(steps, command, keyword, "failed", run.emit);
      continue;
    }
    const found = genericNormalize(result.data, command);
    items.push(...found);
    if (found.length > 0) run.markProgress();
    markOne(steps, command, keyword, "success", run.emit);
  }
  if (items.length === 0 && error) return { command, transport: "adapter", status: "failed", error, itemCount: 0, items: [] };
  return { command, transport: "adapter", status: "success", itemCount: items.length, items };
}

async function collectBrowsers(
  deps: AppDeps,
  topicId: string,
  selected: string[],
  keywords: string[],
  steps: JobStep[],
  run: CollectionRun,
): Promise<PlatformResult[]> {
  const recipes = selected.flatMap((command) => {
    const recipe = deps.recipes.find((item) => `browser:${item.id}` === command);
    return recipe ? [recipe] : [];
  });
  if (recipes.length === 0) return [];
  const session = `topic-${topicId}`;
  const results: PlatformResult[] = [];
  try {
    for (const recipe of recipes) {
      results.push(await collectRecipe(deps, recipe, keywords, session, steps, run));
    }
  } finally {
    await deps.runner.run(["opencli", "browser", "close", "--session", session], 20_000).catch(() => undefined);
  }
  return results;
}

async function collectRecipe(
  deps: AppDeps,
  recipe: BrowserRecipe,
  keywords: string[],
  session: string,
  steps: JobStep[],
  run: CollectionRun,
): Promise<PlatformResult> {
  const command = `browser:${recipe.id}`;
  const items: RawItem[] = [];
  let error = "";
  for (const keyword of keywords) {
    if (!run.beat()) break;
    markOne(steps, command, keyword, "running", run.emit);
    const url = recipe.searchUrl(keyword);
    const opened = await deps.runner.run(["opencli", "browser", "open", url, "--session", session], 90_000);
    const stated = opened.code === 0 ? await deps.runner.run(["opencli", "browser", "state", "--session", session], 30_000) : opened;
    const text = stated.code === 0 ? await deps.runner.run(["opencli", "browser", "get", "text", "--session", session], 30_000) : stated;
    const envelope = text.code === 0 ? readEnvelope(text.stdout) : { ok: false as const, message: "浏览器没有打开页面。" };
    if (!envelope.ok) {
      error = envelope.message;
      markOne(steps, command, keyword, "failed", run.emit);
      continue;
    }
    const pageText = typeof envelope.data === "string" ? envelope.data : JSON.stringify(envelope.data ?? "");
    try {
      const found = recipe.normalize(pageText, url, command);
      items.push(...found);
      if (found.length > 0) run.markProgress();
    } catch {
      error = "页面没能收成统一条目。";
      markOne(steps, command, keyword, "failed", run.emit);
      continue;
    }
    markOne(steps, command, keyword, "success", run.emit);
  }
  if (items.length === 0 && error) return { command, transport: "browser", status: "failed", error, itemCount: 0, items: [] };
  return { command, transport: "browser", status: "success", itemCount: items.length, items };
}

interface CollectionRun {
  emit: () => void;
  charge: (phase: PhaseName) => void;
  beat: () => boolean;
  markProgress: () => void;
  halted: () => string | null;
}

function createRun(onStep: (steps: JobStep[], phase: PhaseName) => void, steps: JobStep[], deps: AppDeps): CollectionRun {
  const limits = limitsOf(deps);
  const startedMs = Date.now();
  let phase: PhaseName = "采集";
  let used = 0;
  let progressed = false;
  let halted: string | null = null;
  const entered = new Set<PhaseName>();
  const emit = () => onStep(steps, phase);
  const stop = (reason: string) => {
    const error = new BudgetStop(phase, reason);
    if (!progressed) {
      emit();
      throw error;
    }
    halted = error.message;
    emit();
  };
  const charge = (next: PhaseName) => {
    if (halted) return;
    phase = next;
    if (Date.now() - startedMs >= limits.jobWallMs) {
      stop("超过时间上限");
      return;
    }
    if (entered.has(next)) return;
    if (used >= limits.jobSteps) {
      stop("超过步数上限");
      return;
    }
    entered.add(next);
    used += 1;
  };
  const beat = () => {
    if (halted) return false;
    if (Date.now() - startedMs >= limits.jobWallMs) {
      stop("超过时间上限");
      return false;
    }
    return true;
  };
  return { emit, charge, beat, markProgress: () => { progressed = true; }, halted: () => halted };
}

function buildEvents(items: SnapshotFile["items"]): SnapshotFile["events"] {
  const groups = new Map<string, SnapshotFile["items"]>();
  for (const item of items) {
    const list = groups.get(item.eventId) ?? [];
    list.push(item);
    groups.set(item.eventId, list);
  }
  return [...groups.entries()].map(([id, group]) => ({
    id,
    title: group.slice().sort((left, right) => right.title.length - left.title.length)[0]?.title ?? id,
    itemIds: group.map((item) => item.id),
    platforms: [...new Set(group.map((item) => item.platform))],
  }));
}

function markOne(steps: JobStep[], command: string, keyword: string, state: JobStep["state"], emit: () => void) {
  const step = steps.find((item) => item.command === command && item.keyword === keyword);
  if (step) step.state = state;
  emit();
}

function markSteps(steps: JobStep[], command: string, state: JobStep["state"], emit: () => void) {
  for (const step of steps) {
    if (step.command === command) step.state = state;
  }
  emit();
}

function formatIso(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const offset = read("timeZoneName").replace("GMT", "").replace(/^([+-])(\d)$/, "$10$2").replace(/^([+-]\d{2})$/, "$1:00");
  return `${read("year")}-${read("month")}-${read("day")}T${read("hour").padStart(2, "0")}:${read("minute").padStart(2, "0")}:${read("second").padStart(2, "0")}${offset || "Z"}`;
}
