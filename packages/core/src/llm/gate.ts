import { parseMoney, unitName } from "../clean.js";
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

function hasRank(excerpt: string, rank: string): boolean {
  if (!/^\d+$/.test(rank)) return false;
  return new RegExp(`第\\s*${rank}\\s*名|(?:^|[^\\p{L}\\p{N}_.-])${rank}(?=$|[^\\p{L}\\p{N}_.-])`, "u").test(excerpt);
}

function compact(text: string): string {
  return text.replace(/\s/g, "");
}

function tokens(text: string): string[] {
  return (text.match(/[$¥￥]?\s*\d[\d,]*(?:\.\d+)?(?:\s*(?:%|美元|元|USD|CNY))?/g) ?? []).map(compact);
}

export function numbersIn(text: string, excerpt: string): boolean {
  const present = new Set(tokens(excerpt));
  return tokens(text).every((token) => present.has(token));
}

function moneyCount(text: string): number {
  return text.match(MONEY)?.length ?? 0;
}

export function namedIn(name: string, excerpt: string): boolean {
  const needle = name.trim();
  if (!needle) return false;
  if (/\p{Script=Han}/u.test(needle)) return compact(excerpt).includes(compact(needle));
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_.-])${escaped}(?=$|[^\\p{L}\\p{N}_.-])`, "iu").test(excerpt);
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
    if (!numbersIn(`${draft.price} ${draft.quota} ${draft.reset} ${draft.condition}`, draft.excerpt)) {
      dropped.push({ reason: "金额或数字不在片段里", excerpt: draft.excerpt });
      continue;
    }
    const money = parseMoney(draft.price, draft.unit);
    if (!namedIn(draft.product, draft.excerpt)) {
      dropped.push({ reason: "产品名不在片段里", excerpt: draft.excerpt });
      continue;
    }
    const unit = unitName(money.ok && money.unitText ? money.unitText : draft.unit, draft.kind);
    if (unit && unitName(draft.excerpt, draft.kind) !== unit && !compact(draft.excerpt).toLowerCase().includes(compact(unit).toLowerCase())) {
      dropped.push({ reason: "计价单位不在片段里", excerpt: draft.excerpt });
      continue;
    }
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
    if (tokens(draft.score).length === 0 || !numbersIn(draft.score, draft.excerpt)) {
      dropped.push({ reason: "分数不在片段里", excerpt: draft.excerpt });
      continue;
    }
    if (!namedIn(draft.model, draft.excerpt) || (draft.org && !namedIn(draft.org, draft.excerpt))) {
      dropped.push({ reason: "模型或机构不在片段里", excerpt: draft.excerpt });
      continue;
    }
    if (!numbersIn(draft.votes, draft.excerpt)) {
      dropped.push({ reason: "票数不在片段里", excerpt: draft.excerpt });
      continue;
    }
    const rank = draft.rank.trim();
    const printed = draft.basis !== "sorted" && hasRank(draft.excerpt, rank);
    const boardDate = draft.boardDate && dateOk(draft.boardDate, draft.excerpt) ? draft.boardDate : "";
    kept.push({ ...draft, basis: printed ? "printed" : "sorted", boardDate });
  }
  if (kept.some((draft) => draft.basis === "sorted")) {
    kept.sort((left, right) => Number.parseFloat(right.score.replace(/[^\d.-]/g, "")) - Number.parseFloat(left.score.replace(/[^\d.-]/g, "")));
    return { drafts: kept.map((draft, index) => ({ ...draft, rank: String(index + 1), basis: "sorted" })), dropped };
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
