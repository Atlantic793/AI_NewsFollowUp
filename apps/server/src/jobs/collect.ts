import {
  blockedByExclude,
  buildQueries,
  countVerdicts,
  dedupeByUrl,
  isCluePlatform,
  renderDigest,
  selectHotspots,
  titleKey,
  zonedParts,
  type DigestItem,
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
): Promise<string> {
  const theme = await readTheme(folder);
  if (theme.status !== "confirmed") throw bad(409, "PLAN_NOT_CONFIRMED", "请先同意调研方案。");
  const prior = await listSnapshots(folder);
  if ((kind === "track" || kind === "morning") && prior.length === 0) {
    throw bad(409, "NO_SNAPSHOT", "请先完成一次调研。");
  }
  const selected = theme.platforms.filter((platform) => platform.selected).map((platform) => platform.command);
  const queries = buildQueries({ keywords: theme.keywords, keywordsEn: theme.keywordsEn, mustInclude: theme.mustInclude });
  const catalog = await discoverCatalog(deps, true);
  const known = new Set(catalog.commands.map((entry) => entry.command));
  const steps: JobStep[] = [];
  for (const command of selected) {
    for (const keyword of queries) steps.push({ command, keyword, state: "pending" });
  }
  const run = createRun(onStep, steps, deps);
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
  const browsed = await collectBrowsers(deps, topicId, selected, queries, steps, run);
  results.push(...browsed);
  for (const result of browsed) {
    await appendTrace(deps, topicId, { action: "search", phase: "采集", command: result.command, count: result.itemCount, note: result.status });
  }

  run.charge("清洗去重");
  run.emit();
  const gathered = dedupeByUrl(results.flatMap((result) => result.items)).map((item, index) => ({
    ...item,
    id: `i${index + 1}`,
  }));
  const sourceItems = kind === "track" || kind === "morning"
    ? gathered.filter((item) => !blockedByExclude(item.title, item.summary, theme.exclude))
    : gathered;
  run.charge("聚类");
  run.emit();
  const grouped = await assignEventKeys(sourceItems, deps.model);
  const storedItems = sourceItems.map((item) => ({ ...item, eventId: grouped.eventKeyById.get(item.id) ?? `solo:${item.id}` }));
  const events = buildEvents(storedItems);
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
  const label = selection
    ? (selection.quiet ? "这个时间窗里没有新进展。" : `时间窗：${selection.windowLabel}。`)
    : "这次调研不按时间窗裁剪。";
  const sources = selection
    ? hotspots.map((event) => ({ title: event.title, url: event.url, summary: event.summary, platform: event.platforms[0] ?? "" }))
    : researchSources(events, storedItems, theme.itemCount);
  run.charge("分析");
  run.emit();
  const digest = sources.length === 0
    ? { lead: label, items: [] as DigestItem[], followups: [] as string[] }
    : await explainItems(deps, sources, { utterance: theme.utterance, audience: theme.audience });
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
      label,
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
    baselineLabel: label,
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
  return id;
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
  for (const keyword of keywords) {
    run.charge("采集");
    markOne(steps, command, keyword, "running", run.emit);
    const result = await runSearchCommand(deps, command, keyword);
    if (!result.ok) {
      markSteps(steps, command, "failed", run.emit);
      return { command, transport: "adapter", status: "failed", error: result.message, itemCount: 0, items: [] };
    }
    items.push(...genericNormalize(result.data, command));
    markOne(steps, command, keyword, "success", run.emit);
  }
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
  for (const keyword of keywords) {
    run.charge("采集");
    markOne(steps, command, keyword, "running", run.emit);
    const url = recipe.searchUrl(keyword);
    const opened = await deps.runner.run(["opencli", "browser", "open", url, "--session", session], 90_000);
    const stated = opened.code === 0 ? await deps.runner.run(["opencli", "browser", "state", "--session", session], 30_000) : opened;
    const text = stated.code === 0 ? await deps.runner.run(["opencli", "browser", "get", "text", "--session", session], 30_000) : stated;
    const envelope = text.code === 0 ? readEnvelope(text.stdout) : { ok: false as const, message: "浏览器没有打开页面。" };
    if (!envelope.ok) {
      markSteps(steps, command, "failed", run.emit);
      return { command, transport: "browser", status: "failed", error: envelope.message, itemCount: 0, items: [] };
    }
    const pageText = typeof envelope.data === "string" ? envelope.data : JSON.stringify(envelope.data ?? "");
    try {
      items.push(...recipe.normalize(pageText, url, command));
    } catch {
      markSteps(steps, command, "failed", run.emit);
      return { command, transport: "browser", status: "failed", error: "页面没能收成统一条目。", itemCount: 0, items: [] };
    }
    markOne(steps, command, keyword, "success", run.emit);
  }
  return { command, transport: "browser", status: "success", itemCount: items.length, items };
}

interface CollectionRun {
  emit: () => void;
  charge: (phase: PhaseName) => void;
}

function createRun(onStep: (steps: JobStep[], phase: PhaseName) => void, steps: JobStep[], deps: AppDeps): CollectionRun {
  const limits = limitsOf(deps);
  const startedMs = Date.now();
  let phase: PhaseName = "采集";
  let used = 0;
  const emit = () => onStep(steps, phase);
  const charge = (next: PhaseName) => {
    phase = next;
    if (used >= limits.jobSteps) {
      emit();
      throw new BudgetStop(phase, "超过步数上限");
    }
    if (Date.now() - startedMs >= limits.jobWallMs) {
      emit();
      throw new BudgetStop(phase, "超过时间上限");
    }
    used += 1;
  };
  return { emit, charge };
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
