import { describe, expect, it } from "vitest";
import { applyPriceGaps, cleanPrices, cleanRanks, comparePrice, diffRows, gatePriceDrafts, gateRankDrafts, watchHits, type PriceDraft, type RankDraft } from "../src/index.js";

const price = (patch: Partial<PriceDraft> = {}): PriceDraft => ({
  kind: "api", product: "model-x", tier: "标准", metric: "输入", condition: "", price: "$20", unit: "每百万 token", quota: "", reset: "",
  excerpt: "model-x 输入 $20 / 1M tokens", ...patch,
});
const rank = (patch: Partial<RankDraft> = {}): RankDraft => ({
  rank: "", model: "model-x", org: "", score: "80", votes: "", boardDate: "", basis: "sorted", excerpt: "model-x 80", ...patch,
});

describe("模型字段必须有逐行依据", () => {
  it.each([
    { product: "invented-model" }, { quota: "999999 次" }, { reset: "每 888 小时" }, { condition: "999 天内" }, { unit: "每次" },
  ])("价目拒绝没有依据的字段 %j", (patch) => {
    const draft = price(patch);
    expect(gatePriceDrafts(draft.excerpt, [draft]).drafts).toHaveLength(0);
  });

  it("单位支持原文的中英文写法，原文缺少单位时不猜", () => {
    const valid = price();
    expect(gatePriceDrafts(valid.excerpt, [valid]).drafts).toHaveLength(1);
    const missing = price({ excerpt: "model-x 输入 $20", unit: "" });
    expect(gatePriceDrafts(missing.excerpt, [missing]).drafts).toHaveLength(0);
  });

  it("数字不能用另一个数字的子串作为依据", () => {
    const draft = rank({ score: "80", excerpt: "model-x 180" });
    expect(gateRankDrafts(draft.excerpt, [draft]).drafts).toHaveLength(0);
  });

  it.each([{ score: "9999" }, { model: "invented-model" }, { votes: "999999" }])("排名拒绝没有依据的字段 %j", (patch) => {
    const draft = rank(patch);
    expect(gateRankDrafts(draft.excerpt, [draft]).drafts).toHaveLength(0);
  });

  it("没有印出名次时按分数重排，允许 rank 留空", () => {
    const drafts = [rank({ model: "low", excerpt: "low 80" }), rank({ model: "high", score: "90", excerpt: "high 90" })];
    const gated = gateRankDrafts(drafts.map((row) => row.excerpt).join("\n"), drafts);
    expect(cleanRanks(gated.drafts).rows.map((row) => [row.model, row.rank, row.basis])).toEqual([["high", 1, "sorted"], ["low", 2, "sorted"]]);
  });

  it("保留官网印出的并列名次", () => {
    const drafts = [rank({ rank: "1", basis: "printed", excerpt: "1 model-x 80" }), rank({ model: "model-y", rank: "1", basis: "printed", excerpt: "1 model-y 80" })];
    expect(gateRankDrafts(drafts.map((row) => row.excerpt).join("\n"), drafts).drafts.map((row) => [row.rank, row.basis])).toEqual([["1", "printed"], ["1", "printed"]]);
  });

  it("模型名称里的版本号不当作印出的名次", () => {
    const draft = rank({ rank: "2", model: "model-2", basis: "printed", excerpt: "model-2 score 80" });
    expect(gateRankDrafts(draft.excerpt, [draft]).drafts[0]).toMatchObject({ rank: "1", basis: "sorted" });
  });
});

describe("模型补充不制造官网变化", () => {
  it("补额度时也核对完整数字和完整产品名", () => {
    const rows = cleanPrices([price()]).rows;
    const body = "model-x 每月 180 次";
    expect(applyPriceGaps(body, rows, [{ product: "model-x", quota: "80 次", reset: "", condition: "", excerpt: body }]).kept).toBe(0);
    const other = "other-model-x 每月 100 次";
    expect(applyPriceGaps(other, rows, [{ product: "model-x", quota: "100 次", reset: "", condition: "", excerpt: other }]).kept).toBe(0);
  });

  it("模型补充条件不改变行标识，官网改价仍能检测", () => {
    const base = cleanPrices([price({ quota: "100 次", reset: "每 5 小时" })]).rows;
    const body = "model-x 每月 100 次，每 5 小时重置，限时活动";
    const enriched = applyPriceGaps(body, base, [{ product: "model-x", quota: "100 次", reset: "每 5 小时", condition: "限时活动", excerpt: body }]);
    expect(enriched.rows[0]).toMatchObject({ condition: "限时活动", quota: "100 次", reset: "每 5 小时" });
    expect(diffRows(base.map(comparePrice), enriched.rows.map(comparePrice))).toEqual([]);
    expect(diffRows(enriched.rows.map(comparePrice), base.map(comparePrice))).toEqual([]);
    const changed = cleanPrices([price({ price: "$22", quota: "100 次", reset: "每 5 小时" })]).rows;
    expect(diffRows(enriched.rows.map(comparePrice), changed.map(comparePrice))).toMatchObject([{ field: "价格", oldValue: "$20", newValue: "$22" }]);
  });
});

describe("定制追踪不遗漏标题中的完整名字", () => {
  it("匹配标题中间的完整模型名，避免短词和相似名称误匹配", () => {
    expect(watchHits("deepseek-chat", "Introducing deepseek-chat today")).toBe(true);
    expect(watchHits("deepseek-chat", "Introducing deepseek-chat-v2 today")).toBe(false);
    expect(watchHits("deepseek-chat", "otherdeepseek-chat")).toBe(false);
    expect(watchHits("flash", "deepseek-flash")).toBe(false);
    expect(watchHits("pro", "Pro 套餐")).toBe(false);
  });
});
