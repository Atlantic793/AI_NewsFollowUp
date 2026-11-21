import {
  applyPriceGaps,
  clean,
  capabilitySentence,
  eventBriefOf,
  eventBriefPrompt,
  eventSentence,
  extractPrompt,
  gapPrompt,
  hotBriefOf,
  hotBriefPrompt,
  hotPurpose,
  gateEventDrafts,
  gateHotDrafts,
  gatePriceDrafts,
  gateRankDrafts,
  shanghaiDate,
  withLocalBriefs,
  type CleanedSet,
  type EventDraft,
  type EventRow,
  type HotDraft,
  type HotRow,
  type PriceDraft,
  type PriceGap,
  type PriceRow,
  type RankDraft,
  type SourceDef,
} from "@followup/core";
import type { AppDeps } from "../types.js";
import { clipBody, completeJson } from "./deepseek.js";

export interface AssistOutcome {
  set: CleanedSet;
  drafts: number;
  kept: number;
  dropped: number;
  note: string;
}

export async function assist(deps: AppDeps, source: SourceDef, body: string, cleaned: CleanedSet, previous: CleanedSet): Promise<AssistOutcome> {
  if (cleaned.rows.length === 0) {
    const filled = await fillFromModel(deps, source, body, cleaned);
    if (filled.set.rows.length === 0) return filled;
    const polished = await polish(deps, source, body, filled.set, previous);
    return {
      set: polished.set,
      drafts: filled.drafts + polished.drafts,
      kept: filled.kept + polished.kept,
      dropped: filled.dropped + polished.dropped,
      note: [filled.note, polished.note].filter(Boolean).join("。"),
    };
  }
  return polish(deps, source, body, cleaned, previous);
}

async function fillFromModel(deps: AppDeps, source: SourceDef, body: string, cleaned: CleanedSet): Promise<AssistOutcome> {
  if (!process.env.OPENAI_API_KEY) return { set: cleaned, drafts: 0, kept: 0, dropped: 0, note: "" };
  const clipped = clipBody(body);
  const prompt = extractPrompt(source.column, source.page, clipped.text);
  const completion = await completeJson(deps, prompt.system, prompt.user);
  const note = [clipped.truncated ? "规则已读完整页。正文超过 24000 字，送给模型时只带了开头和结尾" : "", completion.error].filter(Boolean).join("。");
  if (!completion.ok) return { set: cleaned, drafts: 0, kept: 0, dropped: 0, note: note || "模型没有返回可用结果" };
  const drafts = draftsFrom(source.column, completion.value);
  const gated = gateColumn(source, body, drafts);
  const day = shanghaiDate(deps.now());
  const set = gated.drafts.length === 0 ? cleaned : clean(source, toExtracted(source.column, gated.drafts), day);
  const kept = set.rows.length;
  const dropped = gated.dropped.length;
  if (kept === 0) {
    const reason = gated.dropped.length > 0 || drafts.length > 0 ? "模型抽出的字段对不上原文" : "模型没有返回可用结果";
    return { set: cleaned, drafts: drafts.length, kept: 0, dropped, note: [note, reason].filter(Boolean).join("。") };
  }
  return { set: withLocalBriefs(source, set), drafts: drafts.length, kept, dropped, note };
}

async function polish(deps: AppDeps, source: SourceDef, body: string, cleaned: CleanedSet, previous: CleanedSet): Promise<AssistOutcome> {
  switch (cleaned.column) {
    case "price":
      return polishPrices(deps, source, body, cleaned, previous);
    case "event":
      return polishEvents(deps, source, cleaned, previous);
    case "rank":
      return { set: withLocalBriefs(source, cleaned), drafts: 0, kept: 0, dropped: 0, note: "" };
    case "hot":
      return polishHot(deps, cleaned, previous);
    default: {
      const unreachable: never = cleaned;
      return unreachable;
    }
  }
}

async function polishPrices(deps: AppDeps, source: SourceDef, body: string, cleaned: CleanedSet & { column: "price" }, previous: CleanedSet): Promise<AssistOutcome> {
  cleaned = { ...cleaned, rows: carryPriceGaps(body, cleaned.rows, previous) };
  const needs = cleaned.rows.some((row) => !row.quota || !row.reset || !row.condition);
  if (!needs || !process.env.OPENAI_API_KEY) return { set: withLocalBriefs(source, cleaned), drafts: 0, kept: 0, dropped: 0, note: "" };
  const clipped = clipBody(body);
  const products = [...new Set(cleaned.rows.map((row) => row.product))].slice(0, 40);
  const prompt = gapPrompt(clipped.text, products);
  const completion = await completeJson(deps, prompt.system, prompt.user);
  const note = [clipped.truncated ? "规则已读完整页。正文超过 24000 字，送给模型时只带了开头和结尾" : "", completion.error].filter(Boolean).join("。");
  if (!completion.ok) return { set: withLocalBriefs(source, cleaned), drafts: 0, kept: 0, dropped: 0, note };
  const gaps = gapsFrom(completion.value);
  const applied = applyPriceGaps(body, cleaned.rows.map((row) => ({ ...row, brief: "" })), gaps);
  const set = withLocalBriefs(source, { column: "price", rows: applied.rows, rejected: cleaned.rejected });
  return { set, drafts: gaps.length, kept: applied.kept, dropped: applied.dropped, note };
}

/** 原文依据仍在时，保留已核对的补充；模型暂不可用不会把额度或条件抹掉。 */
function carryPriceGaps(body: string, rows: readonly PriceRow[], previous: CleanedSet): PriceRow[] {
  if (previous.column !== "price") return rows.map((row) => ({ ...row }));
  return rows.map((row) => {
    const old = previous.rows.find((item) => item.product === row.product && item.tier === row.tier && item.metric === row.metric && (item.comparison?.condition ?? item.condition) === row.condition);
    const basis = old?.comparison;
    if (!old || !basis?.evidence?.length || !basis.evidence.every((excerpt) => body.includes(excerpt))) return { ...row };
    const next = { ...row };
    if (!row.quota && old.quota !== basis.quota) next.quota = old.quota;
    if (!row.reset && old.reset !== basis.reset) next.reset = old.reset;
    if (!row.condition && old.condition !== basis.condition) next.condition = old.condition;
    if (next.quota !== row.quota || next.reset !== row.reset || next.condition !== row.condition) {
      next.comparison = { condition: row.condition, quota: row.quota, reset: row.reset, evidence: basis.evidence };
      next.excerpt = [...new Set([row.excerpt, ...basis.evidence])].join("\n").slice(0, 1200);
    }
    return next;
  });
}

async function polishEvents(deps: AppDeps, source: SourceDef, cleaned: CleanedSet & { column: "event" }, previous: CleanedSet): Promise<AssistOutcome> {
  const carried = carryBriefs(cleaned.rows, previous);
  const localAll = () => withLocalBriefs(source, { column: "event", rows: carried, rejected: cleaned.rejected });
  if (!process.env.OPENAI_API_KEY) return { set: localAll(), drafts: 0, kept: 0, dropped: 0, note: "" };
  const batch = carried.filter((row) => !row.brief && !row.detail.startsWith("正常")).slice(0, 15);
  if (batch.length === 0) return { set: localAll(), drafts: 0, kept: 0, dropped: 0, note: "" };
  const prompt = eventBriefPrompt(batch.map((row) => ({ title: row.title, excerpt: row.excerpt.slice(0, 800) })));
  const completion = await completeJson(deps, prompt.system, prompt.user);
  if (!completion.ok) return { set: localAll(), drafts: 0, kept: 0, dropped: 0, note: completion.error };
  const returned = briefsFrom(completion.value);
  let kept = 0;
  let dropped = 0;
  const briefed = new Map<string, string>();
  for (const row of batch) {
    const match = returned.find((item) => item.excerpt === row.excerpt) ?? returned.find((item) => item.excerpt.length > 20 && row.excerpt.includes(item.excerpt));
    const brief = match ? eventBriefOf(row, match.brief) : "";
    briefed.set(`${row.title}\n${row.excerpt}`, brief);
    if (brief) kept += 1;
    else dropped += 1;
  }
  const rest = carried.filter((row) => !briefed.has(`${row.title}\n${row.excerpt}`));
  const local = withLocalBriefs(source, { column: "event", rows: rest, rejected: cleaned.rejected });
  if (local.column !== "event") return { set: cleaned, drafts: returned.length, kept, dropped, note: "" };
  const localBrief = new Map(local.rows.map((row) => [`${row.title}\n${row.excerpt}`, row.brief]));
  const rows = carried.map((row) => {
    const key = `${row.title}\n${row.excerpt}`;
    if (briefed.has(key)) return { ...row, brief: briefed.get(key) ?? "" };
    return { ...row, brief: localBrief.get(key) || row.brief };
  });
  return { set: { column: "event", rows, rejected: cleaned.rejected }, drafts: returned.length, kept, dropped, note: "" };
}

async function polishHot(deps: AppDeps, cleaned: CleanedSet & { column: "hot" }, previous: CleanedSet): Promise<AssistOutcome> {
  const carried = carryHotBriefs(cleaned.rows.map((row) => ({ ...row, brief: localHotBrief(row.summary) })), previous);
  const ready = (): CleanedSet => ({ column: "hot", rows: carried, rejected: cleaned.rejected });
  if (!process.env.OPENAI_API_KEY) return { set: ready(), drafts: 0, kept: 0, dropped: 0, note: "" };
  const batch = carried.filter((row) => !row.brief).slice(0, 25);
  if (batch.length === 0) return { set: ready(), drafts: 0, kept: 0, dropped: 0, note: "" };
  const prompt = hotBriefPrompt(batch.map((row) => ({ title: row.title, excerpt: (row.summary || row.excerpt).slice(0, 800) })));
  const completion = await completeJson(deps, prompt.system, prompt.user);
  if (!completion.ok) return { set: ready(), drafts: 0, kept: 0, dropped: 0, note: completion.error };
  const returned = briefsFrom(completion.value);
  let kept = 0;
  let dropped = 0;
  const briefed = new Map<string, string>();
  for (const row of batch) {
    const sourceText = (row.summary || row.excerpt).slice(0, 800);
    const match = returned.find((item) => item.excerpt === sourceText) ?? returned.find((item) => item.excerpt.length > 20 && sourceText.includes(item.excerpt));
    const brief = match ? hotBriefOf(row, match.brief) : "";
    briefed.set(`${row.title}\n${row.excerpt}`, brief);
    if (brief) kept += 1;
    else dropped += 1;
  }
  const rows = carried.map((row) => {
    const key = `${row.title}\n${row.excerpt}`;
    if (!briefed.has(key)) return row;
    return { ...row, brief: briefed.get(key) || localHotBrief(row.summary) };
  });
  return { set: { column: "hot", rows, rejected: cleaned.rejected }, drafts: returned.length, kept, dropped, note: "" };
}

function localHotBrief(summary: string): string {
  if (hotPurpose(summary) || capabilitySentence(summary)) return hotPurpose(summary) || capabilitySentence(summary);
  const parts = summary.split(" · ").map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((part) => !/\s/.test(part)) ? "模型卡没有写出具体能做什么。" : "";
}

function carryHotBriefs(rows: readonly HotRow[], previous: CleanedSet): HotRow[] {
  if (previous.column !== "hot") return rows.map((row) => ({ ...row }));
  return rows.map((row) => {
    if (row.brief) return { ...row };
    const old = previous.rows.find((item) => item.excerpt === row.excerpt && item.title === row.title && usableHotBrief(item.brief));
    return old ? { ...row, brief: old.brief } : { ...row };
  });
}

function usableHotBrief(brief: string): boolean {
  if (!brief || brief.startsWith("热榜第") || brief.includes("无功能") || brief.includes("片段仅")) return false;
  if (/-to-|[a-z]{2,}-[a-z]{2,}/i.test(brief)) return false;
  const letters = brief.replace(/\b(lora|gguf|api|html|svg|cpu|gpu|bf16|fp8|mcp|json)\b/gi, " ");
  return /\p{Script=Han}/u.test(brief) && (letters.match(/[A-Za-z]{4,}/g) ?? []).length <= 2;
}

function carryBriefs(rows: readonly EventRow[], previous: CleanedSet): EventRow[] {
  if (previous.column !== "event") return rows.map((row) => ({ ...row }));
  return rows.map((row) => {
    // 规则降级生成的概括不能当作模型缓存，模型恢复后应重新尝试。
    const old = previous.rows.find((item) => item.excerpt === row.excerpt && item.title === row.title && item.brief && item.brief !== eventSentence(item));
    if (old) return { ...row, brief: old.brief };
    if (row.detail.startsWith("正常")) return { ...row, brief: eventSentence(row) };
    return { ...row, brief: row.brief === eventSentence(row) ? "" : row.brief };
  });
}

function records(value: unknown, key: string): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object") return [];
  const items = (value as Record<string, unknown>)[key];
  if (!Array.isArray(items)) return [];
  return items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

function field(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

type DraftSet = PriceDraft[] | EventDraft[] | RankDraft[] | HotDraft[];

function draftsFrom(column: SourceDef["column"], value: unknown): DraftSet {
  const items = records(value, "rows");
  switch (column) {
    case "price":
      return items.map((item) => ({
        kind: field(item, "kind") === "plan" ? "plan" : "api",
        product: field(item, "product"),
        tier: field(item, "tier"),
        metric: field(item, "metric"),
        condition: field(item, "condition"),
        price: field(item, "price"),
        unit: field(item, "unit"),
        quota: field(item, "quota"),
        reset: field(item, "reset"),
        excerpt: field(item, "excerpt"),
      }));
    case "event": {
      const drafts: EventDraft[] = [];
      for (const item of items) {
        const type = field(item, "type");
        if (type !== "release" && type !== "news" && type !== "status" && type !== "incident") continue;
        drafts.push({ type, title: field(item, "title"), date: field(item, "date"), detail: field(item, "detail"), url: field(item, "url"), excerpt: field(item, "excerpt") });
      }
      return drafts;
    }
    case "rank":
      return items.map((item) => ({
        rank: field(item, "rank"),
        model: field(item, "model"),
        org: field(item, "org"),
        score: field(item, "score"),
        votes: field(item, "votes"),
        boardDate: field(item, "boardDate"),
        basis: field(item, "basis") === "sorted" ? "sorted" as const : "printed" as const,
        excerpt: field(item, "excerpt"),
      }));
    case "hot":
      return items.map((item) => ({
        rank: field(item, "rank"),
        title: field(item, "title"),
        url: field(item, "url"),
        heat: field(item, "heat"),
        summary: field(item, "summary"),
        excerpt: field(item, "excerpt"),
      }));
    default: {
      const unreachable: never = column;
      return unreachable;
    }
  }
}

function gateColumn(source: SourceDef, body: string, drafts: DraftSet): { drafts: DraftSet; dropped: Array<{ reason: string; excerpt: string }> } {
  switch (source.column) {
    case "price":
      return gatePriceDrafts(body, drafts as PriceDraft[]);
    case "event":
      return gateEventDrafts(body, drafts as EventDraft[]);
    case "rank":
      return gateRankDrafts(body, drafts as RankDraft[]);
    case "hot":
      return gateHotDrafts(body, source.page, drafts as HotDraft[]);
    default: {
      const unreachable: never = source;
      return unreachable;
    }
  }
}

function toExtracted(column: SourceDef["column"], drafts: DraftSet): Parameters<typeof clean>[1] {
  switch (column) {
    case "price":
      return { column: "price", drafts: drafts as PriceDraft[] };
    case "event":
      return { column: "event", drafts: drafts as EventDraft[] };
    case "rank":
      return { column: "rank", drafts: drafts as RankDraft[] };
    case "hot":
      return { column: "hot", drafts: drafts as HotDraft[] };
    default: {
      const unreachable: never = column;
      return unreachable;
    }
  }
}

function gapsFrom(value: unknown): PriceGap[] {
  return records(value, "gaps").map((item) => ({
    product: field(item, "product"),
    quota: field(item, "quota"),
    reset: field(item, "reset"),
    condition: field(item, "condition"),
    excerpt: field(item, "excerpt"),
  }));
}

function briefsFrom(value: unknown): Array<{ excerpt: string; brief: string }> {
  return records(value, "briefs").map((item) => ({ excerpt: field(item, "excerpt"), brief: field(item, "brief") }));
}
