import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SOURCES, clean, extract, pathAllowed, type CleanedSet, type Extracted, type Rejected, type SourceDef } from "@followup/core";
import type { AppDeps } from "../types.js";
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
  onStep({ done: sources.length, total: sources.length, current: "" });
}

interface Captured {
  run: RunRecord;
  rejected: Rejected[];
}

async function capture(deps: AppDeps, store: LedgerStore, source: SourceDef, lastHit: Map<string, number>, robotsCache: Map<string, RobotsResult>): Promise<Captured> {
  const startedAt = deps.now().toISOString();
  const run: RunRecord = {
    sourceId: source.id, startedAt, status: "failed", httpStatus: null, error: "", bytes: 0, hash: "", rawPath: "",
    extracted: 0, cleaned: 0, stored: 0, changed: 0, rejected: 0, reasons: {},
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
  run.rawPath = await saveRaw(deps.dataDir, startedAt.slice(0, 10), source.id, page.contentType, page.body);

  let extracted: Extracted;
  try {
    extracted = extract(source, page.body);
  } catch (error) {
    store.clear(source);
    return finish("没抽出", `解析失败：${error instanceof Error ? error.message : String(error)}`);
  }
  run.extracted = extracted.drafts.length;

  const cleaned: CleanedSet = clean(source, extracted, startedAt.slice(0, 10));
  run.cleaned = cleaned.rows.length;
  run.rejected = cleaned.rejected.length;
  for (const item of cleaned.rejected) run.reasons[item.reason] = (run.reasons[item.reason] ?? 0) + 1;

  if (cleaned.rows.length === 0) {
    store.clear(source);
    const why = extracted.drafts.length === 0 ? "页面里没有找到这一栏要的表或条目" : `抽到 ${extracted.drafts.length} 条，全部没通过清洗`;
    return { run: { ...run, status: "没抽出", error: why }, rejected: cleaned.rejected };
  }
  run.changed = store.replace(source, cleaned, startedAt);
  run.stored = cleaned.rows.length;
  return { run: { ...run, status: "ok" }, rejected: cleaned.rejected };
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
