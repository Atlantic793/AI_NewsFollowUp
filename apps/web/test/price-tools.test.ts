import { describe, expect, it } from "vitest";
import { EMPTY_PRICE_FILTERS, cacheOf, contextOf, filterPrices, priceIn, regionOf, sortPrices } from "../src/price-tools";
import { highlightParts } from "../src/components/Evidence";
import type { PriceView } from "../src/types";

const row = (patch: Partial<PriceView> = {}): PriceView => ({ id: 1, sourceId: "P06", fetchedAt: "", excerpt: "", brief: "", vendor: "example", page: "", kind: "api", product: "model-x", tier: "标准", metric: "输入", condition: "中国大陆；短上下文 <= 200K", price: "¥14.4", amount: 14.4, currency: "CNY", unit: "每百万 token", quota: "", reset: "", officialPrice: "$2", officialAmount: 2, officialCurrency: "USD", ...patch });

describe("价目过滤、排序与原文核对", () => {
  it("可组合地域、上下文、缓存、档位、计价项和单位，不把未注明当全球", () => {
    const a = row({ metric: "输入（缓存未命中）", tier: "批量" });
    const b = row({ id: 2, metric: "缓存读取", condition: "" });
    const filter = { ...EMPTY_PRICE_FILTERS, region: regionOf(a), context: contextOf(a), cache: cacheOf(a), tier: "批量", metric: a.metric, unit: a.unit };
    expect(filterPrices([a, b], filter)).toEqual([a]);
    expect(cacheOf(a)).toBe("未命中");
    expect(cacheOf(b)).toBe("缓存读取");
    expect(regionOf(b)).toBe("未注明");
  });

  it("币种切换显示官网原价，不改变数据与换算值", () => {
    const a = row();
    expect(priceIn(a, "original")).toMatchObject({ price: "$2", amount: 2, currency: "USD" });
    expect(priceIn(a, "cny")).toMatchObject({ price: "¥14.4", amount: 14.4, currency: "CNY" });
    expect(a.price).toBe("¥14.4");
  });

  it("不同单位和计价项分组排序，未标价在升序和降序中都在末尾", () => {
    const a = row({ id: 1, amount: 2 });
    const b = row({ id: 2, amount: 5 });
    const c = row({ id: 3, amount: null, price: "未标价" });
    const d = row({ id: 4, metric: "输出", amount: 1 });
    expect(sortPrices([c, d, b, a], "asc").filter((item) => item.metric === "输入").map((item) => item.id)).toEqual([1, 2, 3]);
    expect(sortPrices([c, d, b, a], "desc").filter((item) => item.metric === "输入").map((item) => item.id)).toEqual([2, 1, 3]);
  });

  it("高亮只保留原字和完整数字，保持原文字符不变", () => {
    const text = "model-x Input $2 / 1M tokens; score 2.5; 200 tokens";
    const parts = highlightParts(text, "$2");
    expect(parts.map((item) => item.text).join("")).toBe(text);
    expect(parts.filter((item) => item.marked).map((item) => item.text)).toEqual(["$2"]);
    expect(highlightParts("200 1.2 2.5", "2").some((item) => item.marked)).toBe(false);
    expect(highlightParts("model-x $2", "不存在的说明").some((item) => item.marked)).toBe(false);
    expect(highlightParts("Published Fri, 06 Nov 2026 12:00:00 GMT", "2026-11-06").filter((item) => item.marked).map((item) => item.text)).toEqual(["06 Nov 2026"]);
  });
});
