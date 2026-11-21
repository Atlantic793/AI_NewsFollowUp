import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clean, sourceById, type PriceDraft } from "@followup/core";
import { mountLedger } from "../src/ledger/http.js";
import { HttpError } from "../src/http-error.js";
import { runLedger } from "../src/ledger/run.js";
import { assist } from "../src/ledger/assist.js";
import { isNetworkFailure, type LedgerStore, type RunRecord } from "../src/ledger/store.js";
import type { AppDeps } from "../src/types.js";

const resources: Array<{ store: LedgerStore; dataDir: string }> = [];
function setup() {
  vi.stubEnv("OPENAI_API_KEY", "");
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "hc-improvements-"));
  const requested: string[] = [];
  const deps: AppDeps = { dataDir, now: () => new Date("2026-11-22T04:00:00Z"), gapMs: 0, kaggle: null, fetchImpl: (async (input) => { requested.push(String(input)); return new Response("", { status: 404 }); }) as typeof fetch };
  const app = new Hono();
  app.onError((error, c) => error instanceof HttpError ? c.json({ error: { message: error.message } }, error.status) : c.json({ error: { message: error.message } }, 500));
  const store = mountLedger(app, deps);
  resources.push({ store, dataDir });
  return { app, store, dataDir, deps, requested };
}
afterEach(() => {
  for (const { store, dataDir } of resources.splice(0)) { store.close(); rmSync(dataDir, { recursive: true, force: true }); }
  vi.unstubAllEnvs();
});
const post = (app: Hono, url: string, body: unknown) => app.request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
function runRecord(sourceId: string, status: RunRecord["status"], startedAt = "2026-11-22T12:00:00+08:00"): RunRecord {
  return { sourceId, status, startedAt, httpStatus: status === "ok" ? 200 : null, error: "", bytes: 0, hash: "", rawPath: "", extracted: 0, cleaned: 0, stored: 0, changed: 0, rejected: 0, reasons: {}, llmDrafts: 0, llmKept: 0, llmDropped: 0, durationMs: 1200 };
}
function seedPrice(store: LedgerStore, price = "$2") {
  const source = sourceById("P06")!;
  const draft: PriceDraft = { kind: "api", product: "model-x", tier: "标准", metric: "输入", condition: "中国大陆 · 短上下文 <= 200K", price, unit: "每百万 token", quota: "", reset: "", excerpt: `model-x Input ${price} / 1M tokens` };
  const set = clean(source, { column: "price", drafts: [draft] }, "2026-11-22");
  set.rows[0].provenance = { extraction: "rule", modelFields: ["condition"], brief: "rule" };
  store.replace(source, set, "2026-11-22T12:00:00+08:00");
}

describe("现有功能改善接口", () => {
  it("首页只摘要今天的变化，最后成功时间不被失败记录覆盖", async () => {
    const { app, store } = setup();
    seedPrice(store);
    store.recordRun(runRecord("P06", "ok", "2026-11-21T12:00:00+08:00"), []);
    store.recordRun({ ...runRecord("P06", "failed"), failureKind: "network" }, []);
    seedPrice(store, "$3");
    const body = await (await app.request("/api/ledger/home")).json();
    expect(body.freshness).toMatchObject({ latestSuccessAt: "2026-11-21T12:00:00+08:00", failed: 1 });
    expect(body.highlights).toMatchObject([{ sourceId: "P06", field: "价格", oldValue: "$2", newValue: "$3" }]);
    const sources = await (await app.request("/api/ledger/sources")).json();
    expect(sources.sources.find((source: { id: string }) => source.id === "P06")).toMatchObject({ lastSuccessAt: "2026-11-21T12:00:00+08:00", retryable: true, run: { durationMs: 1200 } });
  });

  it("官网价格和溯源字段与人民币显示同时保留", async () => {
    const { app, store } = setup();
    seedPrice(store);
    const body = await (await app.request("/api/ledger/column/price")).json();
    expect(body.rows[0]).toMatchObject({ price: "¥14.4", amount: 14.4, currency: "CNY", officialPrice: "$2", officialAmount: 2, officialCurrency: "USD", provenance: { extraction: "rule", modelFields: ["condition"], brief: "rule" } });
    expect(store.prices()[0]).toMatchObject({ price: "$2", amount: 2, currency: "USD" });
  });

  it("关注可从现有模型中选择，并解释未命中原因", async () => {
    const { app, store } = setup();
    seedPrice(store);
    for (const name of ["model-x", "pro", "missing-model"]) await post(app, "/api/ledger/watch", { name });
    const body = await (await app.request("/api/ledger/watch")).json();
    expect(body.candidates).toContainEqual({ name: "model-x", columns: ["价目表"] });
    expect(body.hits[0]).toMatchObject({ noMatchReason: "", prices: [{ product: "model-x" }] });
    expect(body.hits[1].noMatchReason).toContain("通用档位词");
    expect(body.hits[2].noMatchReason).toContain("未匹配到完整名称");
  });

  it("Plus 等套餐名带厂商关注后，能命中报价与后续差分", async () => {
    const { app, store } = setup();
    const source = sourceById("P02")!;
    const body = readFileSync("packages/core/test/fixtures/P02-chatgpt-pricing.md", "utf8");
    const { extract } = await import("@followup/core");
    store.replace(source, clean(source, extract(source, body), "2026-11-22"), "2026-11-22T12:00:00+08:00");
    const column = await (await app.request("/api/ledger/column/price")).json();
    const plus = column.rows.find((row: { product: string }) => row.product === "Plus");
    expect(plus.watchName).toBe("OpenAI Plus");
    await post(app, "/api/ledger/watch", { name: plus.watchName });
    store.replace(source, clean(source, extract(source, body.replace('price="$20"', 'price="$22"')), "2026-11-22"), "2026-11-22T12:01:00+08:00");
    const watch = await (await app.request("/api/ledger/watch")).json();
    expect(watch.hits[0]).toMatchObject({ noMatchReason: "", prices: [{ product: "Plus" }], diffs: [{ field: "价格" }] });
  });

  it("已核对的模型补充和概括保留来源，复用后不会变成规则结果", async () => {
    const { store, deps } = setup();
    const source = sourceById("P06")!;
    const excerpt = "model-x $2，限时活动，每月 100 次，每 5 小时重置";
    const set = clean(source, { column: "price", drafts: [{ kind: "api", product: "model-x", tier: "标准", metric: "输入", condition: "", price: "$2", unit: "每百万 token", quota: "", reset: "", excerpt }] }, "2026-11-22");
    set.rows[0].provenance = { extraction: "rule", modelFields: [], brief: "unknown" };
    vi.stubEnv("OPENAI_API_KEY", "test-only");
    const modelDeps = { ...deps, fetchImpl: (async () => Response.json({ choices: [{ message: { content: JSON.stringify({ gaps: [{ product: "model-x", condition: "限时活动", quota: "100 次", reset: "每 5 小时", excerpt }] }) } }] })) as typeof fetch };
    const result = await assist(modelDeps, source, excerpt, set, { column: "price", rows: [], rejected: [] });
    store.replace(source, result.set, "2026-11-22T12:00:00+08:00");
    expect(store.prices()[0].provenance).toMatchObject({ extraction: "rule", brief: "rule", modelFields: expect.arrayContaining(["condition", "quota", "reset"]) });
    vi.stubEnv("OPENAI_API_KEY", "");
    const carried = await assist(deps, source, excerpt, set, store.snapshot(source));
    expect(carried.set.rows[0].provenance?.modelFields).toHaveLength(3);
    const news = sourceById("N02")!;
    const event = clean(news, { column: "event", drafts: [{ type: "news", title: "Introducing model-x", date: "2026-11-22", detail: "A new model is available.", url: news.page, excerpt: "A new model is available." }] }, "2026-11-22");
    event.rows[0].provenance = { extraction: "rule", modelFields: [], brief: "unknown" };
    vi.stubEnv("OPENAI_API_KEY", "test-only");
    const eventDeps = { ...deps, fetchImpl: (async () => Response.json({ choices: [{ message: { content: JSON.stringify({ briefs: [{ excerpt: event.rows[0].excerpt, brief: "新模型已上线。" }] }) } }] })) as typeof fetch };
    const polished = await assist(eventDeps, news, event.rows[0].excerpt, event, { column: "event", rows: [], rejected: [] });
    expect(polished.set.rows[0].provenance?.brief).toBe("model");
    const reused = await assist(deps, news, event.rows[0].excerpt, event, polished.set);
    expect(reused.set.rows[0].provenance?.brief).toBe("model");
  });

  it("只重试已启用的网络失败，不重跑权限、解析、凭据和主动停用项", async () => {
    const { app, store, requested } = setup();
    store.recordRun({ ...runRecord("P06", "failed"), failureKind: "network" }, []);
    store.recordRun({ ...runRecord("P03", "failed"), failureKind: "access", httpStatus: 403 }, []);
    store.recordRun({ ...runRecord("N04", "没抽出"), failureKind: "parse" }, []);
    store.recordRun({ ...runRecord("H03", "skipped"), failureKind: "credentials" }, []);
    store.recordRun({ ...runRecord("R03", "skipped"), failureKind: "network" }, []);
    store.setEnabled("R03", false);
    expect((await post(app, "/api/ledger/run", { retryNetworkOnly: true })).status).toBe(200);
    await vi.waitFor(async () => expect((await (await app.request("/api/ledger/sources")).json()).run.state).toBe("idle"));
    expect(requested).toEqual(["https://api-docs.deepseek.com/robots.txt", sourceById("P06")!.url]);
    const body = await (await app.request("/api/ledger/sources")).json();
    expect(body.run).toMatchObject({ done: 1, total: 1 });
    expect(body.run.durationMs).toBeGreaterThanOrEqual(0);
  });

  it.each([400, 403, 404])("HTTP %s 不进入网络失败重试", (httpStatus) => {
    expect(isNetworkFailure({ ...runRecord("P06", "failed"), httpStatus })).toBe(false);
  });
  it.each([408, 429, 503])("HTTP %s 可重试", (httpStatus) => {
    expect(isNetworkFailure({ ...runRecord("P06", "failed"), httpStatus })).toBe(true);
  });

  it("采集记录真实耗时与规则抽取方式", async () => {
    const { store, deps } = setup();
    const html = readFileSync("packages/core/test/fixtures/P06-deepseek-pricing.html", "utf8");
    await runLedger({ ...deps, fetchImpl: (async (url) => new Response(String(url).endsWith("robots.txt") ? "" : html)) as typeof fetch }, store, ["P06"], () => undefined);
    expect(store.sources().find((source) => source.id === "P06")?.run?.durationMs).toBeGreaterThanOrEqual(0);
    expect(store.prices()[0].provenance).toEqual({ extraction: "rule", modelFields: [], brief: "rule" });
  });

  it("简报可按日期列出、查看和原样下载，日期边界返回 400/404", async () => {
    const { app, dataDir } = setup();
    expect(await (await app.request("/api/ledger/digests")).json()).toEqual({ digests: [] });
    mkdirSync(path.join(dataDir, "digests"));
    const text = "# 价格变化\n- model-x：$2 → $3\n";
    writeFileSync(path.join(dataDir, "digests", "2026-11-22.md"), text);
    writeFileSync(path.join(dataDir, "digests", "ignored.txt"), "ignore");
    const list = await (await app.request("/api/ledger/digests")).json();
    expect(list.digests).toHaveLength(1);
    expect(list.digests[0].day).toBe("2026-11-22");
    expect((await (await app.request("/api/ledger/digests/2026-11-22")).json()).text).toBe(text);
    const download = await app.request("/api/ledger/digests/2026-11-22?download=1");
    expect(download.headers.get("content-disposition")).toContain("attachment;");
    expect(await download.text()).toBe(text);
    expect((await app.request("/api/ledger/digests/2026-11-21")).status).toBe(404);
    for (const day of ["2026-13-01", "2026-02-30", "2026-1-1", "abc"]) expect((await app.request(`/api/ledger/digests/${day}`)).status).toBe(400);
  });
});
