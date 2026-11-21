import { parseMoney } from "../clean.js";
import { isoDate } from "../parse/text.js";
import type { EventDraft, HotDraft, PriceDraft, RankDraft } from "../rows.js";

export interface GateDrop {
  reason: string;
  excerpt: string;
}

export interface Gated<Draft> {
  drafts: Draft[];
  dropped: GateDrop[];
}

const MONEY = /[$¥￥]\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s*(?:美元|元|USD|CNY)/g;
const PERCENT = /\d[\d,]*(?:\.\d+)?%/g;
const DECIMAL = /\d+\.\d+/g;

function hasRank(excerpt: string, rank: string): boolean {
  if (!/^\d+$/.test(rank)) return false;
  return new RegExp(`(?:^|\\D)${rank}(?:\\D|$)`).test(excerpt);
}

function compact(text: string): string {
  return text.replace(/\s/g, "");
}

function tokens(text: string): string[] {
  return [...text.matchAll(MONEY), ...text.matchAll(PERCENT), ...text.matchAll(DECIMAL)].map((match) => compact(match[0]));
}

function numbersIn(text: string, excerpt: string): boolean {
  const body = compact(excerpt);
  return tokens(text).every((token) => body.includes(token));
}

function moneyCount(text: string): number {
  return text.match(/[$¥￥]\s?\d[\d,]*(?:\.\d+)?/g)?.length ?? 0;
}

export function isLoginWall(body: string): boolean {
  return body.length < 800 && /sign in|log in|access denied|请登录|登录/i.test(body);
}

function excerptIn(body: string, excerpt: string): boolean {
  return excerpt.trim().length > 0 && body.includes(excerpt);
}

function dateOk(field: string, excerpt: string): boolean {
  if (!field.trim()) return true;
  const fromField = isoDate(field);
  if (!fromField) return false;
  const fromExcerpt = isoDate(excerpt);
  if (excerpt.includes(field.trim())) return !fromExcerpt || fromExcerpt === fromField || fromField.startsWith(fromExcerpt) || fromExcerpt.startsWith(fromField);
  return fromExcerpt === fromField;
}

export function gatePriceDrafts(body: string, drafts: readonly PriceDraft[]): Gated<PriceDraft> {
  const kept: PriceDraft[] = [];
  const dropped: GateDrop[] = [];
  for (const draft of drafts) {
    if (!excerptIn(body, draft.excerpt)) {
      dropped.push({ reason: "片段不是这次原文的子串", excerpt: draft.excerpt });
      continue;
    }
    if (moneyCount(draft.excerpt) >= 2) {
      dropped.push({ reason: "同一片段里有两个价格", excerpt: draft.excerpt });
      continue;
    }
    if (!numbersIn(`${draft.price} ${draft.quota} ${draft.reset}`, draft.excerpt)) {
      dropped.push({ reason: "金额或数字不在片段里", excerpt: draft.excerpt });
      continue;
    }
    const money = parseMoney(draft.price, draft.unit);
    if (money.ok && !compact(draft.excerpt).includes(compact(money.display)) && !draft.excerpt.includes(String(money.amount))) {
      dropped.push({ reason: "展示价不在片段里", excerpt: draft.excerpt });
      continue;
    }
    kept.push(draft);
  }
  return { drafts: kept, dropped };
}

export function gateRankDrafts(body: string, drafts: readonly RankDraft[]): Gated<RankDraft> {
  const kept: RankDraft[] = [];
  const dropped: GateDrop[] = [];
  for (const draft of drafts) {
    if (!excerptIn(body, draft.excerpt)) {
      dropped.push({ reason: "片段不是这次原文的子串", excerpt: draft.excerpt });
      continue;
    }
    if (!numbersIn(draft.score, draft.excerpt)) {
      dropped.push({ reason: "分数不在片段里", excerpt: draft.excerpt });
      continue;
    }
    const rank = draft.rank.trim();
    const printed = draft.basis !== "sorted" && hasRank(draft.excerpt, rank);
    const boardDate = draft.boardDate && dateOk(draft.boardDate, draft.excerpt) ? draft.boardDate : "";
    kept.push({ ...draft, basis: printed ? "printed" : "sorted", boardDate });
  }
  return { drafts: kept, dropped };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function gateHotDrafts(body: string, page: string, drafts: readonly HotDraft[]): Gated<HotDraft> {
  const kept: HotDraft[] = [];
  const dropped: GateDrop[] = [];
  const host = hostOf(page);
  for (const draft of drafts) {
    if (!excerptIn(body, draft.excerpt)) {
      dropped.push({ reason: "片段不是这次原文的子串", excerpt: draft.excerpt });
      continue;
    }
    if (!/^https?:\/\//.test(draft.url) || hostOf(draft.url) !== host) {
      dropped.push({ reason: "链接不在榜单网站上", excerpt: draft.excerpt });
      continue;
    }
    kept.push(draft);
  }
  return { drafts: kept, dropped };
}

const EVENT_TYPES = new Set(["release", "news", "status", "incident"]);

export function gateEventDrafts(body: string, drafts: readonly EventDraft[]): Gated<EventDraft> {
  const kept: EventDraft[] = [];
  const dropped: GateDrop[] = [];
  for (const draft of drafts) {
    if (!EVENT_TYPES.has(draft.type)) {
      dropped.push({ reason: "类型不在允许范围内", excerpt: draft.excerpt });
      continue;
    }
    if (!excerptIn(body, draft.excerpt)) {
      dropped.push({ reason: "片段不是这次原文的子串", excerpt: draft.excerpt });
      continue;
    }
    if (!dateOk(draft.date, draft.excerpt) && draft.type !== "status") {
      dropped.push({ reason: "日期不在片段里", excerpt: draft.excerpt });
      continue;
    }
    if (!numbersIn(`${draft.title} ${draft.detail}`, draft.excerpt)) {
      dropped.push({ reason: "数字不在片段里", excerpt: draft.excerpt });
      continue;
    }
    kept.push(draft);
  }
  return { drafts: kept, dropped };
}
