import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  columnOf,
  extractEvents,
  extractHot,
  extractPrices,
  extractRanks,
  htmlToText,
  pathAllowed,
  type SourceKind,
} from "@followup/core";
import type { AppDeps } from "../types.js";
import { LedgerStore, type SourceRow } from "./store.js";

const GAP_MS = 2_000;

export async function runLedger(deps: AppDeps, store: LedgerStore, onStep: (done: number, total: number) => void): Promise<void> {
  const sources = store.enabledSources();
  const hosts = new Map<string, number>();
  let done = 0;
  for (const source of sources) {
    onStep(done, sources.length);
    await waitHost(hosts, source.url, deps.now);
    await capture(deps, store, source);
    done += 1;
    onStep(done, sources.length);
  }
}

async function waitHost(hosts: Map<string, number>, url: string, now: () => Date): Promise<void> {
  let host = "";
  try {
    host = new URL(url).host;
  } catch {
    return;
  }
  const last = hosts.get(host) ?? 0;
  const delay = GAP_MS - (now().getTime() - last);
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  hosts.set(host, now().getTime());
}

async function capture(deps: AppDeps, store: LedgerStore, source: SourceRow): Promise<void> {
  const startedAt = deps.now().toISOString();
  let pageUrl: URL;
  try {
    pageUrl = new URL(source.url);
  } catch {
    store.recordRun({ sourceId: source.id, startedAt, status: "failed", httpStatus: null, error: "地址无效", bytes: 0, hash: "" });
    return;
  }
  const robots = await readText(deps, `${pageUrl.origin}/robots.txt`);
  if (robots.ok && !pathAllowed(robots.text, pageUrl.pathname)) {
    store.recordRun({ sourceId: source.id, startedAt, status: "skipped", httpStatus: robots.status, error: "robots 不允许", bytes: 0, hash: "" });
    return;
  }
  const page = await readText(deps, source.url);
  if (!page.ok) {
    store.recordRun({ sourceId: source.id, startedAt, status: "failed", httpStatus: page.status, error: page.error, bytes: 0, hash: "" });
    return;
  }
  if (page.finalHost !== pageUrl.host) {
    store.recordRun({ sourceId: source.id, startedAt, status: "failed", httpStatus: page.status, error: "跳到了别的网站", bytes: page.text.length, hash: "" });
    return;
  }
  const text = htmlToText(page.text);
  if (looksBlocked(text)) {
    store.recordRun({ sourceId: source.id, startedAt, status: "blocked", httpStatus: page.status, error: "页面打不开或要登录", bytes: page.text.length, hash: "" });
    return;
  }
  store.saveRaw(source.id, page.finalUrl, startedAt, text.slice(0, 20_000));
  const day = startedAt.slice(0, 10);
  await mkdir(path.join(deps.dataDir, "raw", day), { recursive: true });
  await writeFile(path.join(deps.dataDir, "raw", day, `${source.id}.txt`), text.slice(0, 20_000), "utf8");
  const wrote = writeRows(store, source, page.finalUrl, startedAt, text);
  store.recordRun({
    sourceId: source.id,
    startedAt,
    status: "ok",
    httpStatus: page.status,
    error: wrote === 0 ? "这一页没有抽出字段，上一份还留着" : "",
    bytes: text.length,
    hash: "",
  });
}

function writeRows(store: LedgerStore, source: SourceRow, url: string, fetchedAt: string, text: string): number {
  const column = columnOf(source.kind);
  if (column === "price") {
    const kind = source.kind === "plan" ? "plan" : "api";
    const drafts = extractPrices(text, kind);
    if (drafts.length === 0) return 0;
    store.replacePrices(source.id, source.vendor, url, fetchedAt, drafts, `${source.vendor} ${source.label}`);
    return drafts.length;
  }
  if (column === "rank") {
    const drafts = extractRanks(text);
    if (drafts.length === 0) return 0;
    store.replaceRanks(source.id, source.vendor, url, fetchedAt, drafts, source.vendor);
    return drafts.length;
  }
  if (column === "hot") {
    const drafts = extractHot(text);
    if (drafts.length === 0) return 0;
    store.replaceHot(source.id, source.vendor, fetchedAt, drafts, source.vendor);
    return drafts.length;
  }
  const drafts = extractEvents(text, source.kind);
  if (drafts.length === 0) return 0;
  store.replaceEvents(source.id, source.vendor, url, fetchedAt, drafts, `${source.vendor} ${source.label}`);
  return drafts.length;
}

function looksBlocked(text: string): boolean {
  if (text.length > 800) return false;
  return /sign in|log in|just a moment|unsupported country|not available in your|地区不可用|请登录/i.test(text);
}

interface ReadResult {
  ok: boolean;
  status: number | null;
  text: string;
  finalUrl: string;
  finalHost: string;
  error: string;
}

async function readText(deps: AppDeps, url: string): Promise<ReadResult> {
  try {
    const response = await deps.fetchImpl(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
      headers: { "user-agent": "AI_NewsFollowUp", accept: "text/html,application/json,text/plain" },
    });
    const text = await response.text();
    const finalUrl = response.url || url;
    let finalHost = "";
    try {
      finalHost = new URL(finalUrl).host;
    } catch {
      finalHost = "";
    }
    if (!response.ok) return { ok: false, status: response.status, text: "", finalUrl, finalHost, error: `HTTP ${response.status}` };
    return { ok: true, status: response.status, text, finalUrl, finalHost, error: "" };
  } catch (error) {
    const raw = error instanceof Error ? error.message : "";
    const message = /fetch failed|ENOTFOUND|ECONNREFUSED|timed out|aborted/i.test(raw) ? "没有连上" : (raw || "没有连上");
    return { ok: false, status: null, text: "", finalUrl: url, finalHost: "", error: message };
  }
}

export function isSourceKind(value: string): value is SourceKind {
  return value === "api_price" || value === "plan" || value === "changelog" || value === "news" || value === "status" || value === "model_card" || value === "leaderboard" || value === "hotlist";
}
