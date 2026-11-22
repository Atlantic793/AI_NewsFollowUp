import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clean, sourceById, withLocalBriefs, type PriceDraft } from "@followup/core";
import { HttpError } from "../src/http-error.js";
import { mountLedger } from "../src/ledger/http.js";
import { runLedger } from "../src/ledger/run.js";
import { LedgerStore } from "../src/ledger/store.js";
import { assist } from "../src/ledger/assist.js";
import type { AppDeps } from "../src/types.js";

const stores: LedgerStore[] = [];
const dirs: string[] = [];
const fixture = (file: string) => readFileSync(path.resolve("packages/core/test/fixtures", file), "utf8");
function setup() {
  vi.stubEnv("OPENAI_API_KEY", "");
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "hc-regression-"));
  dirs.push(dataDir);
  const pages = new Map<string, string>();
  const deps: AppDeps = {
    dataDir, now: () => new Date("2026-11-21T08:00:00Z"), kaggle: null, gapMs: 0,
    fetchImpl: (async (input) => new Response(pages.get(String(input)) ?? "", { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch,
  };
  const app = new Hono();
  app.onError((error, c) => error instanceof HttpError ? c.json({ error: { code: error.code, message: error.message } }, error.status) : c.json({ error: { message: "失败" } }, 500));
  const store = mountLedger(app, deps);
  stores.push(store);
  return { app, deps, store, pages, dataDir };
}
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true });
  vi.unstubAllEnvs();
});
const post = (app: Hono, url: string, body: unknown) => app.request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("采集结果可追溯且差分稳定", () => {
  it.each([false, true])("规则概括不会阻止之后的真实模型概括，模型概括仍可复用（当前行带规则概括：%s）", async (hasLocalBrief) => {
    const { deps } = setup();
    const source = sourceById("N02")!;
    const excerpt = "A new model is available today.";
    const cleaned = clean(source, { column: "event", drafts: [{ type: "news", title: "Introducing model-x", date: "2026-11-21", detail: excerpt, url: source.page, excerpt }] }, "2026-11-21");
    const rule = await assist(deps, source, excerpt, cleaned, { column: "event", rows: [], rejected: [] });
    vi.stubEnv("OPENAI_API_KEY", "test-only");
    const fetchImpl = vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ briefs: [{ excerpt, brief: "新模型已上线。" }] }) } }] }));
    const modelDeps = { ...deps, fetchImpl: fetchImpl as typeof fetch };
    const model = await assist(modelDeps, source, excerpt, hasLocalBrief ? rule.set : cleaned, rule.set);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(model.set.rows[0].brief).toBe("新模型已上线。");
    await assist(modelDeps, source, excerpt, cleaned, model.set);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("长页补抽被拒绝时，同时保留截断说明和字段核对失败原因", async () => {
    const { deps } = setup();
    vi.stubEnv("OPENAI_API_KEY", "test-only");
    const source = sourceById("N02")!;
    const excerpt = "A new model is available today.";
    const body = `<item><title>Introducing model-x</title><description>${excerpt}</description><pubDate>2026-11-21</pubDate></item>${"正文".repeat(13000)}`;
    const fetchImpl = vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ rows: [{ type: "news", title: "Introducing model-x", date: "2026-11-21", detail: excerpt, url: source.page, excerpt }] }) } }] }));
    const empty = { column: "event" as const, rows: [], rejected: [] };
    const outcome = await assist({ ...deps, fetchImpl: fetchImpl as typeof fetch }, source, body, empty, empty);
    expect(outcome.kept).toBe(0);
    expect(outcome.dropped).toBe(1);
    expect(outcome.note).toContain("正文超过 24000 字");
    expect(outcome.note).toContain("模型抽出的字段对不上原文");
  });

  it("同一天第二轮失败不会覆盖第一轮原文和哈希", async () => {
    const { deps, store, pages } = setup();
    const url = sourceById("H01")!.url;
    const firstBody = fixture("H01-github-trending.html");
    pages.set(url, firstBody);
    await runLedger(deps, store, ["H01"], () => undefined);
    const first = store.sources().find((source) => source.id === "H01")!.run!;
    pages.set(url, "<html>Sign in</html>");
    await runLedger(deps, store, ["H01"], () => undefined);
    const second = store.sources().find((source) => source.id === "H01")!.run!;
    expect(second.rawPath).not.toBe(first.rawPath);
    expect(readFileSync(first.rawPath, "utf8")).toBe(firstBody);
    expect(createHash("sha256").update(readFileSync(first.rawPath)).digest("hex")).toBe(first.hash);
    expect(store.hot().length).toBeGreaterThan(0);
  });

  it("摘要只追加本轮变化，不重复当天以前的改价", async () => {
    const { deps, store, pages, dataDir } = setup();
    const url = sourceById("P02")!.url;
    const body = fixture("P02-chatgpt-pricing.md");
    store.setSetting("push_price", true);
    pages.set(url, body);
    await runLedger(deps, store, ["P02"], () => undefined);
    pages.set(url, body.replace('price="$20"', 'price="$22"'));
    await runLedger(deps, store, ["P02"], () => undefined);
    await runLedger(deps, store, ["P02"], () => undefined);
    const lines = readFileSync(path.join(dataDir, "digests/2026-11-21.md"), "utf8").split("\n");
    expect(lines.filter((line) => line.startsWith("- Plus"))).toHaveLength(1);
  });

  it("入库后仍保留规则字段，模型失败不会制造新增、掉出或额度变化", async () => {
    const { deps, store } = setup();
    const source = sourceById("P06")!;
    const draft: PriceDraft = { kind: "api", product: "model-x", tier: "标准", metric: "输入", condition: "", price: "$20", unit: "每百万 token", quota: "", reset: "", excerpt: "model-x 输入 $20 / 1M tokens" };
    const cleaned = clean(source, { column: "price", drafts: [draft] }, "2026-11-21");
    const body = "model-x 输入 $20 / 1M tokens，每月 100 次，每 5 小时重置，限时活动";
    vi.stubEnv("OPENAI_API_KEY", "test-only");
    const assisted = await assist({ ...deps, fetchImpl: (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ gaps: [{ product: "model-x", quota: "100 次", reset: "每 5 小时", condition: "限时活动", excerpt: body }] }) } }] }))) as typeof fetch }, source, body, cleaned, { column: "price", rows: [], rejected: [] });
    store.replace(source, assisted.set, "2026-11-21T16:00:00+08:00");
    vi.stubEnv("OPENAI_API_KEY", "");
    const fallback = await assist(deps, source, body, cleaned, store.snapshot(source));
    expect(store.replace(source, fallback.set, "2026-11-21T16:01:00+08:00")).toBe(0);
    expect(store.diffs(10)).toEqual([]);
    vi.stubEnv("OPENAI_API_KEY", "test-only");
    const changedBody = body.replace("100 次", "200 次");
    const changed = await assist({ ...deps, fetchImpl: (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ gaps: [{ product: "model-x", quota: "200 次", reset: "每 5 小时", condition: "限时活动", excerpt: changedBody }] }) } }] }))) as typeof fetch }, source, changedBody, cleaned, store.snapshot(source));
    store.replace(source, changed.set, "2026-11-21T16:02:00+08:00");
    expect(store.diffs(10)).toMatchObject([{ field: "额度", oldValue: "100 次", newValue: "200 次" }]);
  });

  it("原文没有改变时，模型首次补齐字段也不会误报官网变化", async () => {
    const { deps, store, pages } = setup();
    const source = sourceById("P06")!;
    const evidence = "deepseek-flash 每月 100 次，每 5 小时重置，限时活动";
    const body = `${fixture("P06-deepseek-pricing.html")}\n<p>${evidence}</p>`;
    pages.set(source.url, body);
    await runLedger(deps, store, [source.id], () => undefined);
    vi.stubEnv("OPENAI_API_KEY", "test-only");
    const modelDeps = { ...deps, fetchImpl: (async (input, init) => init?.method === "POST" ? new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ gaps: [{ product: "deepseek-flash", quota: "100 次", reset: "每 5 小时", condition: "限时活动", excerpt: evidence }] }) } }] })) : deps.fetchImpl(input, init)) as typeof fetch };
    await runLedger(modelDeps, store, [source.id], () => undefined);
    expect(store.prices().some((row) => row.quota === "100 次")).toBe(true);
    expect(store.diffs(10)).toEqual([]);
  });
});

describe("接口展示和参数边界", () => {
  it("英文新闻标题、状态组件名仍可识别和搜索", async () => {
    const { app, store } = setup();
    const source = sourceById("N02")!;
    const set = withLocalBriefs(source, clean(source, { column: "event", drafts: [
      { type: "news", title: "Introducing model-x", date: "2026-11-21", detail: "A new model is available.", url: source.page, excerpt: "Introducing model-x" },
      { type: "status", title: "ChatGPT API", date: "2026-11-21", detail: "operational", url: source.page, excerpt: "ChatGPT API operational" },
    ] }, "2026-11-21"));
    store.replace(source, set, "2026-11-21T16:00:00+08:00");
    const body = await (await app.request("/api/ledger/column/event")).json();
    expect(body.rows.map((row: { title: string }) => row.title)).toContain("Introducing model-x");
    expect(body.rows.map((row: { title: string }) => row.title)).toContain("ChatGPT API");
    const news = body.rows.find((row: { title: string }) => row.title === "Introducing model-x");
    expect(news.brief).toBe("说明见右侧原文");
    expect(news.detail).not.toMatch(/available/i);
    expect(body.rows.find((row: { title: string }) => row.title === "ChatGPT API").brief).toBe("正常");
    await post(app, "/api/ledger/watch", { name: "model-x" });
    const watch = await (await app.request("/api/ledger/watch")).json();
    expect(watch.hits[0].events).toHaveLength(1);
  });

  it.each([
    ["/api/ledger/watch", { name: 123 }], ["/api/ledger/watch", null], ["/api/ledger/watch", []],
    ["/api/ledger/column/price/brief", { query: 123 }],
    ["/api/ledger/column/price/brief", { query: "x", rowId: "1" }],
    ["/api/ledger/column/price/push", { enabled: "false" }], ["/api/ledger/sources/H01", { enabled: "false" }],
  ])("错误请求返回 400：%s %j", async (url, input) => {
    const { app } = setup();
    const response = await post(app, url as string, input);
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBeTruthy();
  });

  it.each(["abc%def", "model%20name", "model/name"])('能删除包含编码字符的追踪名 "%s"', async (name) => {
    const { app, store } = setup();
    await post(app, "/api/ledger/watch", { name });
    const response = await app.request(`/api/ledger/watch/${encodeURIComponent(name)}`, { method: "DELETE" });
    expect(response.status).toBe(200);
    expect(store.watches()).toEqual([]);
  });

  it("分组概括包含选中的所有计价项，并拒绝无效行号", async () => {
    const { app, store } = setup();
    const source = sourceById("P06")!;
    const drafts = Array.from({ length: 13 }, (_, index): PriceDraft => ({ kind: "api", product: "model-x", tier: "标准", metric: `计价项${index}`, condition: "", price: `$${index + 1}`, unit: "每百万 token", quota: "", reset: "", excerpt: `计价项${index} $${index + 1}` }));
    store.replace(source, clean(source, { column: "price", drafts }, "2026-11-21"), "2026-11-21T16:00:00+08:00");
    const ids = store.prices().map((row) => row.id);
    const response = await post(app, "/api/ledger/column/price/brief", { query: "model-x", rowIds: ids });
    const body = await response.json();
    expect(body.hits).toBe(13);
    expect(body.text).toContain("计价项12 $13");
    expect((await post(app, "/api/ledger/column/price/brief", { query: "x", rowIds: ["1"] })).status).toBe(400);
  });
});
