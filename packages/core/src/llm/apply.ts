import { groundBrief } from "../brief.js";
import { hasHan } from "../zh.js";
import type { EventRow, HotRow, PriceRow } from "../rows.js";
import { namedIn, numbersIn } from "./gate.js";

export interface PriceGap {
  product: string;
  quota: string;
  reset: string;
  condition: string;
  excerpt: string;
}

export interface GapResult {
  rows: PriceRow[];
  kept: number;
  dropped: number;
}

/** 只填仍为空的额度、重置、条件。已有价格原样留下。 */
export function applyPriceGaps(body: string, rows: readonly PriceRow[], gaps: readonly PriceGap[]): GapResult {
  const next = rows.map((row) => ({ ...row }));
  let kept = 0;
  let dropped = 0;
  for (const gap of gaps) {
    const product = gap.product.trim();
    const excerpt = gap.excerpt.trim();
    const filling = [gap.quota, gap.reset, gap.condition].map((item) => item.trim()).filter(Boolean);
    if (!product || !excerpt || !body.includes(excerpt) || !namedIn(product, excerpt) || filling.length === 0 || filling.some((item) => !numbersIn(item, excerpt))) {
      dropped += 1;
      continue;
    }
    let used = false;
    for (const row of next) {
      if (row.product.toLocaleLowerCase() !== product.toLocaleLowerCase()) continue;
      const comparison = row.comparison ?? { condition: row.condition, quota: row.quota, reset: row.reset };
      const modelFields = new Set(row.provenance?.modelFields ?? []);
      let rowUsed = false;
      if (!row.quota && gap.quota.trim()) {
        row.quota = gap.quota.trim();
        modelFields.add("quota");
        rowUsed = true;
      }
      if (!row.reset && gap.reset.trim()) {
        row.reset = gap.reset.trim();
        modelFields.add("reset");
        rowUsed = true;
      }
      if (!row.condition && gap.condition.trim()) {
        row.condition = gap.condition.trim();
        modelFields.add("condition");
        rowUsed = true;
      }
      if (rowUsed) {
        row.provenance = { extraction: row.provenance?.extraction ?? "unknown", brief: row.provenance?.brief ?? "unknown", modelFields: [...modelFields] };
        row.comparison = { ...comparison, evidence: [...new Set([...(comparison.evidence ?? []), excerpt])] };
        used = true;
        if (!row.excerpt.includes(excerpt)) row.excerpt = `${row.excerpt}\n${excerpt}`.slice(0, 1200);
      }
    }
    if (used) kept += 1;
    else dropped += 1;
  }
  return { rows: next, kept, dropped };
}

/** 概括里的数字必须在该行片段里。对不上就留空，不改 detail。 */
export function eventBriefOf(row: Pick<EventRow, "excerpt" | "detail">, brief: string): string {
  if (row.detail.startsWith("正常")) return "正常";
  return groundedSentence(brief, row.excerpt, 80);
}

/** 热榜简介只复述官方介绍。数字对不上，或句子里还剩英文，就留空。不改名次和热度。 */
export function hotBriefOf(row: Pick<HotRow, "summary" | "excerpt">, brief: string): string {
  const sentence = groundedSentence(brief, row.summary.trim() || row.excerpt, 100);
  if (/-to-|[a-z]{2,}-[a-z]{2,}/i.test(sentence)) return "";
  const letters = sentence.replace(/\b(lora|gguf|api|html|svg|cpu|gpu|bf16|fp8|mcp|json)\b/gi, " ");
  return (letters.match(/[A-Za-z]{4,}/g) ?? []).length > 2 ? "" : sentence;
}

function groundedSentence(brief: string, corpus: string, limit: number): string {
  const grounded = groundBrief(brief, corpus).replace(/\s+/g, " ").trim();
  if (!grounded || !hasHan(grounded)) return "";
  return [...grounded].slice(0, limit).join("");
}
