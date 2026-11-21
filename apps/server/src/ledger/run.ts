import { createHash } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SOURCES, clean, displayMoneyText, extract, hubBlurb, isLoginWall, pathAllowed, shanghaiDate, shanghaiStamp, type CleanedSet, type ColumnKind, type Extracted, type HotDraft, type Rejected, type SourceDef } from "@followup/core";
import type { AppDeps } from "../types.js";
import { assist } from "./assist.js";
import type { LedgerStore, RunRecord } from "./store.js";

const GAP_MS = 2_000;
const AGENT = "AI_NewsFollowUp/0.2 (course data-collection project)";

export interface RunProgress {
  done: number;
  total: number;
  current: string;
}

/** 依次跑选中的来源；同一个网站两次请求之间至少隔 GAP_MS。 */
export async function runLedger(deps: AppDeps, store: LedgerStore, ids: readonly string[] | null, onStep: (progress: RunProgress) => void): Promise<void> {
  const enabled = new Map(store.sources().map((source) => [source.id, source.enabled]));
  const sources = SOURCES.filter((source) => (ids ? ids.includes(source.id) : enabled.get(source.id)));
  const lastHit = new Map<string, number>();
  const robotsCache = new Map<string, RobotsResult>();
  for (const [index, source] of sources.entries()) {
    onStep({ done: index, total: sources.length, current: source.id });
    const record = await capture(deps, store, source, lastHit, robotsCache);
    store.recordRun(record.run, record.rejected);
  }
  await writeDigests(deps, store, sources).catch(() => undefined);
  onStep({ done: sources.length, total: sources.length, current: "" });
}

interface Captured {
  run: RunRecord;
  rejected: Rejected[];
}

async function capture(deps: AppDeps, store: LedgerStore, source: SourceDef, lastHit: Map<string, number>, robotsCache: Map<string, RobotsResult>): Promise<Captured> {
  const startedAt = shanghaiStamp(deps.now());
  const day = shanghaiDate(deps.now());
  const run: RunRecord = {
    sourceId: source.id, startedAt, status: "failed", httpStatus: null, error: "", bytes: 0, hash: "", rawPath: "",
    extracted: 0, cleaned: 0, stored: 0, changed: 0, rejected: 0, reasons: {},
    llmDrafts: 0, llmKept: 0, llmDropped: 0,
  };
  const finish = (status: RunRecord["status"], error: string): Captured => ({ run: { ...run, status, error }, rejected: [] });

  if (source.needs === "kaggle" && !deps.kaggle) return finish("skipped", "没有配置 Kaggle 凭据：在项目根目录 .env 写 KAGGLE_USERNAME 和 KAGGLE_KEY");
  const target = new URL(source.url);
  const robots = await robotsFor(deps, target, lastHit, robotsCache);
  if (robots.unreadable) return finish("skipped", robots.unreadable);
  if (!robots.allowed(`${target.pathname}${target.search}`)) return finish("skipped", "robots.txt 不允许抓这个路径");

  await waitHost(lastHit, target.host, deps);
  const page = await fetchText(deps, source.url, source.needs === "kaggle" ? deps.kaggle : null);
  run.httpStatus = page.status;
  if (!page.ok) return finish("failed", page.error);
  if (new URL(page.finalUrl).host !== target.host) return finish("failed", `跳到了别的网站：${new URL(page.finalUrl).host}`);

  run.bytes = Buffer.byteLength(page.body, "utf8");
  run.hash = createHash("sha256").update(page.body).digest("hex");
  run.rawPath = await saveRaw(deps.dataDir, day, source.id, page.contentType, page.body);
  if (isLoginWall(page.body)) return { run: { ...run, status: "没抽出", error: keptLine(store, source, "页面像登录墙，没有正文，不交给模型") }, rejected: [] };

  let extracted: Extracted;
  try {
    extracted = extract(source, page.body);
  } catch (error) {
    return finish("没抽出", keptLine(store, source, `解析失败：${error instanceof Error ? error.message : String(error)}`));
  }
  run.extracted = extracted.drafts.length;
  if (source.parser === "hf_trending" && extracted.column === "hot") {
    extracted = { column: "hot", drafts: await attachHubCards(deps, extracted.drafts, target.host, robots, lastHit) };
  }

  const cleaned: CleanedSet = clean(source, extracted, day);
  run.cleaned = cleaned.rows.length;
  run.rejected = cleaned.rejected.length;
  for (const item of cleaned.rejected) run.reasons[item.reason] = (run.reasons[item.reason] ?? 0) + 1;

  const previous = store.snapshot(source);
  let set: CleanedSet = cleaned;
  try {
    const assisted = await assist(deps, source, page.body, cleaned, previous);
    set = assisted.set;
    run.llmDrafts = assisted.drafts;
    run.llmKept = assisted.kept;
    run.llmDropped = assisted.dropped;
    if (assisted.note) run.error = assisted.note;
  } catch {
    set = cleaned;
  }

  if (set.rows.length === 0) {
    const why = run.error || (extracted.drafts.length === 0 ? "页面里没有找到这一栏要的表或条目" : `抽到 ${extracted.drafts.length} 条，全部没通过清洗`);
    return { run: { ...run, status: "没抽出", error: keptLine(store, source, why) }, rejected: cleaned.rejected };
  }
  run.changed = store.replace(source, set, startedAt);
  run.stored = set.rows.length;
  return { run: { ...run, status: "ok", error: run.error }, rejected: cleaned.rejected };
}

interface RobotsResult {
  unreadable: string;
  allowed: (pathAndQuery: string) => boolean;
}

/** RFC 9309：robots.txt 404 之类当作不限制；5xx 或连不上当作暂时全站不许抓。 */
async function robotsFor(deps: AppDeps, target: URL, lastHit: Map<string, number>, cache: Map<string, RobotsResult>): Promise<RobotsResult> {
  const cached = cache.get(target.origin);
  if (cached) return cached;
  await waitHost(lastHit, target.host, deps);
  const response = await fetchText(deps, `${target.origin}/robots.txt`, null);
  const unreadable = response.status === null || response.status >= 500 ? "robots.txt 读不到，按规范这一轮先不抓" : "";
  const body = response.ok && !/html/i.test(response.contentType) ? response.body : "";
  const result: RobotsResult = { unreadable, allowed: (pathAndQuery) => pathAllowed(body, pathAndQuery) };
  cache.set(target.origin, result);
  return result;
}

async function attachHubCards(deps: AppDeps, drafts: readonly HotDraft[], host: string, robots: RobotsResult, lastHit: Map<string, number>): Promise<HotDraft[]> {
  const head = drafts.slice(0, 25);
  const rest = drafts.slice(25);
  const next: HotDraft[] = [];
  for (const draft of head) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(draft.title)) {
      next.push(draft);
      continue;
    }
    const pathName = `/${draft.title.split("/").map((part) => encodeURIComponent(part)).join("/")}/raw/main/README.md`;
    if (!robots.allowed(pathName)) {
      next.push(draft);
      continue;
    }
    await waitHost(lastHit, host, deps);
    const page = await fetchText(deps, `https://${host}${pathName}`, null);
    let sameHost = false;
    try {
      sameHost = new URL(page.finalUrl).host === host;
    } catch {
      sameHost = false;
    }
    const blurb = page.ok && sameHost ? hubBlurb(page.body) : "";
    next.push(blurb ? { ...draft, summary: blurb, excerpt: blurb } : draft);
  }
  return [...next, ...rest];
}

async function waitHost(lastHit: Map<string, number>, host: string, deps: AppDeps): Promise<void> {
  const gap = deps.gapMs ?? GAP_MS;
  const delay = gap - (deps.now().getTime() - (lastHit.get(host) ?? 0));
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  lastHit.set(host, deps.now().getTime());
}

interface Fetched {
  ok: boolean;
  status: number | null;
  body: string;
  contentType: string;
  finalUrl: string;
  error: string;
}

async function fetchText(deps: AppDeps, url: string, kaggle: AppDeps["kaggle"]): Promise<Fetched> {
  const headers: Record<string, string> = { "user-agent": AGENT, accept: "text/html,application/json,application/xml,text/markdown,text/plain;q=0.9,*/*;q=0.5" };
  if (kaggle) headers.authorization = `Basic ${Buffer.from(`${kaggle.username}:${kaggle.key}`).toString("base64")}`;
  try {
    const response = await deps.fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(30_000), headers });
    const body = await response.text();
    const contentType = response.headers.get("content-type") ?? "";
    const finalUrl = response.url || url;
    if (!response.ok) return { ok: false, status: response.status, body: "", contentType, finalUrl, error: httpReason(response.status) };
    return { ok: true, status: response.status, body, contentType, finalUrl, error: "" };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    return { ok: false, status: null, body: "", contentType: "", finalUrl: url, error: /timeout|aborted/i.test(raw) ? "超过 30 秒没有响应" : "没有连上" };
  }
}

function keptLine(store: LedgerStore, source: SourceDef, why: string): string {
  return store.count(source) > 0 ? `${why}。上次成功的行还留着` : `${why}。库里也没有上一轮的行`;
}

const COLUMN_NAME: Record<ColumnKind, string> = { hot: "热榜", price: "价目", rank: "排名", event: "厂商动态" };

/** 推送开关打开的栏目，把这一轮的变化写进 dataDir/digests。 */
async function writeDigests(deps: AppDeps, store: LedgerStore, sources: readonly SourceDef[]): Promise<void> {
  const day = shanghaiDate(deps.now());
  const columns = [...new Set(sources.map((source) => source.column))];
  const folder = path.join(deps.dataDir, "digests");
  for (const column of columns) {
    if (!store.setting(`push_${column}`, column === "hot")) continue;
    const diffs = store.diffs(300).filter((diff) => diff.column === column && diff.fetchedAt.startsWith(day));
    const lines = diffs.length === 0
      ? [`# ${COLUMN_NAME[column]} ${day}`, "这一栏本轮没有相对上一轮的变化。"]
      : [`# ${COLUMN_NAME[column]} ${day}`, ...diffs.map((diff) => `- ${diff.label}：${diff.field} ${shownDiff(diff.field, diff.oldValue) || "空"} → ${shownDiff(diff.field, diff.newValue)}`)];
    await mkdir(folder, { recursive: true });
    await appendFile(path.join(folder, `${day}.md`), `${lines.join("\n")}\n\n`, "utf8");
  }
}

function shownDiff(field: string, value: string): string {
  return field === "价格" ? displayMoneyText(value) : value;
}

function httpReason(status: number): string {
  if (status === 401 || status === 403) return `HTTP ${status}：网站拒绝访问（要登录或地区受限），不绕过`;
  if (status === 404) return "HTTP 404：地址不存在了";
  if (status === 429) return "HTTP 429：请求太频繁，下轮再试";
  return `HTTP ${status}`;
}

async function saveRaw(dataDir: string, day: string, id: string, contentType: string, body: string): Promise<string> {
  const ext = /json/i.test(contentType) ? "json" : /xml|rss/i.test(contentType) ? "xml" : /markdown/i.test(contentType) ? "md" : /html/i.test(contentType) ? "html" : "txt";
  const folder = path.join(dataDir, "raw", day);
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, `${id}.${ext}`);
  await writeFile(file, body, "utf8");
  return file;
}
