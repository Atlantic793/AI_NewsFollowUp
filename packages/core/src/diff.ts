import { eventKey, hotKey, priceKey, rankKey } from "./clean.js";
import type { CleanedSet, EventRow, HotRow, PriceRow, RankRow } from "./rows.js";

export interface ComparedRow {
  key: string;
  label: string;
  fields: Record<string, string>;
}

export interface FieldDiff {
  key: string;
  label: string;
  field: string;
  oldValue: string;
  newValue: string;
}

export const comparePrice = (row: PriceRow): ComparedRow => ({
  key: priceKey({ ...row, condition: row.comparison?.condition ?? row.condition }),
  label: [row.product, row.tier, row.metric, row.comparison?.condition ?? row.condition].filter(Boolean).join(" · "),
  fields: { 价格: row.price, 单位: row.unit, 额度: row.quota, 重置: row.reset },
});

export const compareRank = (row: RankRow): ComparedRow => ({ key: rankKey(row), label: row.model, fields: { 名次: String(row.rank), 分数: row.score } });

export const compareHot = (row: HotRow): ComparedRow => ({ key: hotKey(row), label: row.title, fields: { 名次: String(row.rank) } });

export const compareEvent = (row: EventRow): ComparedRow => ({
  key: eventKey(row),
  label: row.title,
  fields: row.type === "status" ? { 状态: row.detail } : {},
});

export function comparable(set: CleanedSet): ComparedRow[] {
  switch (set.column) {
    case "price":
      return set.rows.map(comparePrice);
    case "rank":
      return set.rows.map(compareRank);
    case "hot":
      return set.rows.map(compareHot);
    case "event":
      return set.rows.map(compareEvent);
    default: {
      const unreachable: never = set;
      return unreachable;
    }
  }
}

/** 和上一轮比：新出现的行、字段变了的行；removals 为 true 时也记掉出的行。 */
export function diffRows(previous: readonly ComparedRow[], next: readonly ComparedRow[], removals = true): FieldDiff[] {
  const before = new Map(previous.map((row) => [row.key, row]));
  const after = new Map(next.map((row) => [row.key, row]));
  const diffs: FieldDiff[] = [];
  for (const [key, row] of after) {
    const prior = before.get(key);
    if (!prior) {
      diffs.push({ key, label: row.label, field: "row", oldValue: "", newValue: "新增" });
      continue;
    }
    for (const [field, value] of Object.entries(row.fields)) {
      const oldValue = prior.fields[field] ?? "";
      if (oldValue !== value) diffs.push({ key, label: row.label, field, oldValue, newValue: value });
    }
  }
  if (removals) {
    for (const [key, row] of before) {
      if (!after.has(key)) diffs.push({ key, label: row.label, field: "row", oldValue: "在表", newValue: "掉出" });
    }
  }
  return diffs;
}

const WATCH_GENERIC = new Set(["pro", "plus", "free", "max", "mini", "chat", "code", "plan", "opus", "go", "ultra", "team"]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 整段匹配：名字等于产品名或模型名，或是「 · 」分开的一整段，
 * 或是不少于 6 个字符、两侧都有名称边界的完整名字。pro、opus、4 这种短词不算。
 */
export function watchHits(name: string, haystack: string): boolean {
  const needle = name.trim().toLocaleLowerCase();
  if (needle.length < 3 || WATCH_GENERIC.has(needle)) return false;
  const field = haystack.trim().toLocaleLowerCase();
  if (!field) return false;
  if (field === needle || field.split(/\s*·\s*/).some((segment) => segment === needle)) return true;
  if (needle.length < 6) return false;
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_.-])${escapeRegExp(needle)}(?=$|[^\\p{L}\\p{N}_.-])`, "u").test(field);
}
