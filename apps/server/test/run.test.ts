import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runLedger } from "../src/ledger/run.js";
import { LedgerStore } from "../src/ledger/store.js";
import type { AppDeps } from "../src/types.js";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../packages/core/test/fixtures");
const fixture = (file: string) => readFileSync(path.join(fixtures, file), "utf8");

interface Reply { status: number; body: string; type: string }

function setup(pages: Record<string, Reply>) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "hc-run-"));
  const asked: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    asked.push(url);
    const reply = pages[url] ?? { status: 404, body: "not found", type: "text/plain" };
    return new Response(reply.body, { status: reply.status, headers: { "content-type": reply.type } });
  }) as typeof fetch;
  const deps: AppDeps = { dataDir, now: () => new Date("2026-11-08T08:00:00Z"), fetchImpl, kaggle: null, gapMs: 0 };
  const store = new LedgerStore(path.join(dataDir, "headline.sqlite"));
  return { dataDir, deps, store, asked };
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("采集一轮：抓取 → 抽取 → 清洗 → 入库", () => {
  it("每一步的数量都记下，原始响应整页存盘", async () => {
    const { dataDir, deps, store } = setup({
      "https://github.com/trending/": { status: 200, body: fixture("H01-github-trending.html"), type: "text/html; charset=utf-8" },
      "https://api-docs.deepseek.com/quick_start/pricing/": { status: 200, body: fixture("P06-deepseek-pricing.html"), type: "text/html" },
    });
    dirs.push(dataDir);
    await runLedger(deps, store, ["H01", "P06"], () => undefined);

    expect(store.hot().map((row) => row.title)).toEqual(store.hot().map((row) => row.title).filter((title) => /^[\w.-]+\/[\w.-]+$/.test(title)));
    expect(store.hot()).toHaveLength(6);
    expect(store.prices()).toHaveLength(14);
    const run = store.sources().find((source) => source.id === "H01")?.run;
    expect(run).toMatchObject({ status: "ok", httpStatus: 200, extracted: 6, cleaned: 6, stored: 6, changed: 0 });
    expect(readFileSync(run?.rawPath ?? "", "utf8")).toBe(fixture("H01-github-trending.html"));
    store.close();
  });

  it("这一页一条都对不上：记没抽出，清掉上一轮的旧行", async () => {
    const pages: Record<string, Reply> = { "https://github.com/trending/": { status: 200, body: fixture("H01-github-trending.html"), type: "text/html" } };
    const { dataDir, deps, store } = setup(pages);
    dirs.push(dataDir);
    await runLedger(deps, store, ["H01"], () => undefined);
    expect(store.hot()).toHaveLength(6);

    pages["https://github.com/trending/"] = { status: 200, body: "<html><header><nav><a href='/login'>Sign in</a></nav></header></html>", type: "text/html" };
    await runLedger(deps, store, ["H01"], () => undefined);
    expect(store.hot()).toHaveLength(0);
    expect(store.sources().find((source) => source.id === "H01")?.run).toMatchObject({ status: "没抽出", extracted: 0, stored: 0 });
    store.close();
  });

  it("清洗丢掉的行带原因和原文样本", async () => {
    const { dataDir, deps, store } = setup({
      "https://learn.chatgpt.com/docs/pricing.md": { status: 200, body: fixture("P02-chatgpt-pricing.md"), type: "text/markdown" },
    });
    dirs.push(dataDir);
    await runLedger(deps, store, ["P02"], () => undefined);
    expect(store.sources().find((source) => source.id === "P02")?.run?.reasons).toEqual({ 页面没有标价: 3 });
    expect(store.rejects("P02")[0]?.excerpt).not.toBe("");
    store.close();
  });

  it("robots.txt 不允许就不抓页面；Kaggle 没凭据就跳过", async () => {
    const { dataDir, deps, store, asked } = setup({
      "https://github.com/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /trending", type: "text/plain" },
    });
    dirs.push(dataDir);
    await runLedger(deps, store, ["H01", "H03"], () => undefined);
    expect(asked).toEqual(["https://github.com/robots.txt"]);
    const runs = Object.fromEntries(store.sources().map((source) => [source.id, source.run]));
    expect(runs.H01).toMatchObject({ status: "skipped", error: "robots.txt 不允许抓这个路径" });
    expect(runs.H03?.status).toBe("skipped");
    store.close();
  });

  it("第二轮才记变化：改价记一条", async () => {
    const markdown = fixture("P02-chatgpt-pricing.md");
    const pages: Record<string, Reply> = { "https://learn.chatgpt.com/docs/pricing.md": { status: 200, body: markdown, type: "text/markdown" } };
    const { dataDir, deps, store } = setup(pages);
    dirs.push(dataDir);
    await runLedger(deps, store, ["P02"], () => undefined);
    pages["https://learn.chatgpt.com/docs/pricing.md"] = { status: 200, body: markdown.replace('price="$20"', 'price="$22"'), type: "text/markdown" };
    await runLedger(deps, store, ["P02"], () => undefined);
    expect(store.diffs(10).map((diff) => [diff.label, diff.field, diff.oldValue, diff.newValue])).toContainEqual(["Plus · 订阅 · 订阅价", "价格", "$20", "$22"]);
    store.close();
  });
});
