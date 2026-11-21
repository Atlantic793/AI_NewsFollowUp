import { parseMoney } from "./clean.js";

/** 展示用固定汇率。库里的 price、amount、currency 仍是官网标价，差分也比官网标价。 */
export const USD_TO_CNY = 7.2;

const AS_IS = new Set(["未标价", "免费", "限时免费", "仅供免费体验"]);

export function cnyAmount(amount: number | null, currency: "USD" | "CNY" | ""): number | null {
  if (amount === null) return null;
  if (currency === "CNY") return amount;
  if (currency === "USD") return Math.round(amount * USD_TO_CNY * 10_000) / 10_000;
  return null;
}

function trimNumber(value: number): string {
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

/** 表格和概括里给人看的价格。官网原文仍在 excerpt。 */
export function cnyLabel(price: string, amount: number | null, currency: "USD" | "CNY" | ""): string {
  if (AS_IS.has(price)) return price;
  if (currency === "CNY") {
    if (price.startsWith("¥") || price.startsWith("￥")) return price.replace("￥", "¥");
    return amount === null ? price : `¥${trimNumber(amount)}`;
  }
  const converted = cnyAmount(amount, currency);
  if (converted === null) return price;
  return `¥${trimNumber(converted)}`;
}

/** 把库里记下的官网标价换成页面上的人民币。不是价格的词保持原样。 */
export function displayMoneyText(value: string): string {
  if (!value || AS_IS.has(value)) return value;
  const money = parseMoney(value, /¥|￥|元|CNY|RMB/.test(value) ? "元" : "美元");
  if (!money.ok) return value;
  return cnyLabel(money.display, money.amount, money.currency);
}
