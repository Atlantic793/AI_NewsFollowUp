import type { PriceView } from "./types";

export type PriceFilters = { region: string; context: string; cache: string; tier: string; metric: string; unit: string };
export const EMPTY_PRICE_FILTERS: PriceFilters = { region: "", context: "", cache: "", tier: "", metric: "", unit: "" };

export function regionOf(row: PriceView): string {
  const text = row.officialCondition ?? row.condition;
  const labels = ["中国大陆", "北京", "上海", "深圳", "香港", "新加坡", "美国", "欧洲", "全球", "国际"];
  return labels.filter((label) => text.includes(label)).join(" / ") || "未注明";
}

export function contextOf(row: PriceView): string {
  const text = row.officialCondition ?? row.condition;
  return text.split(/[；;·|]/).map((part) => part.trim()).filter((part) => /上下文|context|(?:\d|[≤≥<>])\s*[\d.,]*\s*[kKmM]\b|\d\s*(?:万|百万)?\s*(?:tokens?|词元)/i.test(part)).join("；") || "未注明";
}

export function cacheOf(row: PriceView): string {
  const text = `${row.metric} ${row.officialCondition ?? row.condition}`;
  if (/未命中|cache miss|uncached/i.test(text)) return "未命中";
  if (/写入|cache write/i.test(text)) return "缓存写入";
  if (/存储|cache storage/i.test(text)) return "缓存存储";
  if (/命中|缓存读取|cached input|cache read|cache hit/i.test(text)) return "缓存读取";
  return "未注明缓存";
}

export function filterPrices(rows: PriceView[], filter: PriceFilters): PriceView[] {
  return rows.filter((row) => (!filter.region || regionOf(row) === filter.region) && (!filter.context || contextOf(row) === filter.context) && (!filter.cache || cacheOf(row) === filter.cache) && (!filter.tier || row.tier === filter.tier) && (!filter.metric || row.metric === filter.metric) && (!filter.unit || row.unit === filter.unit));
}

export function priceIn(row: PriceView, currency: "cny" | "original"): PriceView {
  return currency === "cny" ? row : { ...row, price: row.officialPrice ?? row.price, amount: row.officialAmount === undefined ? row.amount : row.officialAmount, currency: row.officialCurrency ?? row.currency };
}

export function priceGroup(row: PriceView): string {
  return `${row.kind === "api" ? "API" : "套餐"} · ${row.metric} · ${row.unit || "未注明单位"} · ${row.currency || "未注明币种"}`;
}

/** 不同单位、计价项或币种分组排序，不能把每月套餐和 token 单价混为一谈。 */
export function sortPrices(rows: PriceView[], order: string): PriceView[] {
  if (order === "default") return rows;
  return [...rows].sort((a, b) => {
    const group = priceGroup(a).localeCompare(priceGroup(b), "zh-CN");
    if (group) return group;
    if (a.amount === null) return b.amount === null ? 0 : 1;
    if (b.amount === null) return -1;
    return (a.amount - b.amount) * (order === "desc" ? -1 : 1);
  });
}
