import { describe, expect, it } from "vitest";
import {
  clean,
  cleanEvents,
  cleanHot,
  cleanPrices,
  cleanRanks,
  comparePrice,
  compareEvent,
  diffRows,
  extract,
  mentionsMainland,
  parseMoney,
  pathAllowed,
  sourceById,
  type EventDraft,
  type HotDraft,
  type PriceDraft,
  type PriceRow,
} from "../src/index.js";

const price = (input: Partial<PriceDraft>): PriceDraft => ({
  kind: "api", product: "m", tier: "", metric: "输入", condition: "", price: "$1", unit: "", quota: "", reset: "", excerpt: "原文", ...input,
});
const event = (input: Partial<EventDraft>): EventDraft => ({ type: "release", title: "t", date: "2026-11-01", detail: "", url: "https://x.test/a", excerpt: "原文", ...input });
const hot = (input: Partial<HotDraft>): HotDraft => ({ rank: "1", title: "a/b", url: "https://github.com/a/b", heat: "", summary: "", excerpt: "原文", ...input });

describe("价格格子归一", () => {
  it("拆出金额、币种、单位和注记", () => {
    expect(parseMoney("$1.25 / 1M tokens", "")).toMatchObject({ ok: true, amount: 1.25, currency: "USD", display: "$1.25", unitText: "/ 1M tokens" });
    expect(parseMoney("原价6元（限时8折）", "每百万Token")).toMatchObject({ ok: true, amount: 6, currency: "CNY", display: "¥6", note: "原价 · 限时8折" });
    expect(parseMoney("From $100", "")).toMatchObject({ ok: true, amount: 100, note: "起价" });
    expect(parseMoney("Free", "")).toMatchObject({ ok: true, amount: 0, display: "免费" });
  });

  it("空格子、不提供、联系销售都不算价格", () => {
    expect(parseMoney("-", "")).toEqual({ ok: false, reason: "格子是空的" });
    expect(parseMoney("Not available", "")).toEqual({ ok: false, reason: "这一档不提供" });
    expect(parseMoney("Contact sales", "")).toEqual({ ok: false, reason: "要联系销售，没有标价" });
    expect(parseMoney("12", "")).toEqual({ ok: false, reason: "没有币种" });
  });

  it("必填字段缺了就丢，并写明原因；同一格两个值留第一处", () => {
    const { rows, rejected } = cleanPrices([
      price({ product: "" }),
      price({ product: "Pricing" }),
      price({ metric: "" }),
      price({ product: "gpt-x", price: "$2" }),
      price({ product: "gpt-x", price: "$3" }),
      price({ product: "gpt-x (batch)", price: "$1" }),
    ]);
    expect(rows.map((row) => [row.product, row.condition, row.price])).toEqual([["gpt-x", "", "$2"], ["gpt-x", "batch", "$1"]]);
    expect(rejected.map((item) => item.reason)).toEqual(["没有产品名", "导航或按钮文字", "没有计价项", "同一项出现两个不同的值，留第一处"]);
  });
});

describe("排名、热榜、动态的清洗", () => {
  it("排名：分数必须是数字，同一模型只留名次靠前的", () => {
    const { rows, rejected } = cleanRanks([
      { rank: "2", model: "B", org: "", score: "88", votes: "", boardDate: "", excerpt: "" },
      { rank: "1", model: "A", org: "", score: "90", votes: "", boardDate: "", excerpt: "" },
      { rank: "3", model: "A", org: "", score: "80", votes: "", boardDate: "", excerpt: "" },
      { rank: "4", model: "C", org: "", score: "n/a", votes: "", boardDate: "", excerpt: "" },
    ]);
    expect(rows.map((row) => row.model)).toEqual(["A", "B"]);
    expect(rejected.map((item) => item.reason)).toEqual(["同一模型重复上榜，留名次靠前的", "分数不是数字"]);
  });

  it("热榜：导航、没链接、别的网站的链接都不进表", () => {
    const { rows, rejected } = cleanHot([
      hot({ title: "Sign in", url: "https://github.com/login" }),
      hot({ title: "a/b" }),
      hot({ title: "c/d", url: "" }),
      hot({ title: "e/f", url: "https://example.com/e/f" }),
      hot({ title: "Explore GitHub", url: "https://github.com/explore" }),
    ], "https://github.com/trending");
    expect(rows.map((row) => row.title)).toEqual(["a/b"]);
    expect(rejected.map((item) => item.reason)).toEqual(["导航或按钮文字", "没有自己的链接", "链接不在榜单网站上", "不是 owner/name 形式的条目"]);
  });

  it("动态：没有日期的发布丢掉，状态行用当天日期", () => {
    const { rows, rejected } = cleanEvents([
      event({ title: "Copy page", date: "" }),
      event({ title: "Model launch", date: "" }),
      event({ title: "Model launch", date: "November 6, 2026" }),
      event({ type: "status", title: "API", date: "", detail: "operational" }),
    ], "2026-11-08");
    expect(rows.map((row) => [row.type, row.title, row.date, row.detail])).toEqual([
      ["release", "Model launch", "2026-11-06", ""],
      ["status", "API", "2026-11-08", "正常"],
    ]);
    expect(rejected.map((item) => item.reason)).toEqual(["导航或按钮文字", "没有日期"]);
  });

  it("中国大陆政策：同一句里要同时写到中国大陆和注册/调用/付款", () => {
    expect(mentionsMainland("Claude is now available to developers in mainland China. Pricing is unchanged.")).toBe(true);
    expect(mentionsMainland("We opened an office in mainland China. The API now supports batches.")).toBe(false);
    expect(mentionsMainland("中国大陆用户现在可以注册并调用 API。")).toBe(true);
  });

  it("一页里一条都对不上，就是没抽出", () => {
    const source = sourceById("H01");
    if (!source) throw new Error("H01");
    const extracted = extract(source, "<html><header><nav><a href='/login'>Sign in</a><a href='/pricing'>Pricing</a></nav></header></html>");
    expect(clean(source, extracted, "2026-11-08").rows).toEqual([]);
  });
});

describe("robots.txt", () => {
  const robots = [
    "User-agent: *",
    "Disallow: /api/",
    "Allow: /api/v2/summary.json$",
    "Disallow: /*?*authuser=",
    "",
    "User-agent: AI_NewsFollowUp",
    "Disallow: /private",
  ].join("\n");

  it("写了本程序名字的组优先", () => {
    expect(pathAllowed(robots, "/private/x")).toBe(false);
    expect(pathAllowed(robots, "/api/v2/components.json")).toBe(true);
  });

  it("通配组：最长匹配，$ 结尾锚定，* 匹配任意", () => {
    expect(pathAllowed(robots, "/api/v2/summary.json", "other-bot")).toBe(true);
    expect(pathAllowed(robots, "/api/v2/summary.json?x=1", "other-bot")).toBe(false);
    expect(pathAllowed(robots, "/docs?hl=en&authuser=1", "other-bot")).toBe(false);
    expect(pathAllowed(robots, "/docs/pricing.md", "other-bot")).toBe(true);
    expect(pathAllowed("", "/anything")).toBe(true);
  });
});

describe("和上一轮比", () => {
  const row = (priceText: string, product = "gpt-x"): PriceRow => ({
    kind: "api", product, tier: "标准", metric: "输入", condition: "", price: priceText, amount: 1, currency: "USD", unit: "每百万 token", quota: "", reset: "", excerpt: "",
  });

  it("价目记改价、新增和掉出", () => {
    const diffs = diffRows([row("$1"), row("$5", "old")].map(comparePrice), [row("$2"), row("$3", "new")].map(comparePrice));
    expect(diffs.map((diff) => [diff.label, diff.field, diff.oldValue, diff.newValue])).toEqual([
      ["gpt-x · 标准 · 输入", "价格", "$1", "$2"],
      ["new · 标准 · 输入", "row", "", "新增"],
      ["old · 标准 · 输入", "row", "在表", "掉出"],
    ]);
  });

  it("动态只记新出现的和状态变化，旧条目滚出最近 20 条不算变化", () => {
    const before = [{ type: "status" as const, title: "API", date: "2026-11-07", detail: "正常", url: "", excerpt: "" }, { type: "release" as const, title: "old", date: "2026-10-01", detail: "", url: "", excerpt: "" }];
    const after = [{ ...before[0]!, detail: "部分中断" }, { type: "release" as const, title: "new", date: "2026-11-08", detail: "", url: "", excerpt: "" }];
    const diffs = diffRows(before.map(compareEvent), after.map(compareEvent), false);
    expect(diffs.map((diff) => [diff.label, diff.field, diff.newValue])).toEqual([["API", "状态", "部分中断"], ["new", "row", "新增"]]);
  });
});
