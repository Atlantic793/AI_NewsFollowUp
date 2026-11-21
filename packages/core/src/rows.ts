/** 抽取步的输出：照页面原样摘出的字段，还没有归一。excerpt 是这一行在原文里的那一段。 */
export interface PriceDraft {
  kind: "api" | "plan";
  product: string;
  tier: string;
  metric: string;
  condition: string;
  price: string;
  unit: string;
  quota: string;
  reset: string;
  excerpt: string;
}

export interface RankDraft {
  rank: string;
  model: string;
  org: string;
  score: string;
  votes: string;
  boardDate: string;
  /** printed：榜上印了名次。sorted：页面没有名次，按分数从高到低排。 */
  basis?: "printed" | "sorted";
  excerpt: string;
}

export interface HotDraft {
  rank: string;
  title: string;
  url: string;
  heat: string;
  summary: string;
  excerpt: string;
}

export interface EventDraft {
  type: "release" | "news" | "status" | "incident";
  title: string;
  date: string;
  detail: string;
  url: string;
  excerpt: string;
}

export interface Provenance {
  extraction: "rule" | "model" | "unknown";
  modelFields: string[];
  brief: "rule" | "model" | "unknown";
}

interface TracedRow { provenance?: Provenance }

/** 清洗步的输出：字段已归一、去重、校验过必填项。 */
export interface PriceRow extends TracedRow {
  kind: "api" | "plan";
  product: string;
  tier: string;
  metric: string;
  condition: string;
  price: string;
  amount: number | null;
  currency: "USD" | "CNY" | "";
  unit: string;
  quota: string;
  reset: string;
  excerpt: string;
  brief: string;
  /** 模型补充前的规则字段与依据，用于稳定差分和复用已核对的补充。 */
  comparison?: { condition: string; quota: string; reset: string; evidence?: string[] };
}

export interface RankRow extends TracedRow {
  rank: number;
  model: string;
  org: string;
  score: string;
  scoreValue: number;
  votes: string;
  boardDate: string;
  basis: "printed" | "sorted";
  excerpt: string;
  brief: string;
}

export interface HotRow extends TracedRow {
  rank: number;
  title: string;
  url: string;
  heat: string;
  summary: string;
  excerpt: string;
  brief: string;
}

export type EventType = EventDraft["type"] | "cn_access";

export interface EventRow extends TracedRow {
  type: EventType;
  title: string;
  date: string;
  detail: string;
  url: string;
  excerpt: string;
  brief: string;
}

export interface Rejected {
  reason: string;
  excerpt: string;
}

export interface Cleaned<Row> {
  rows: Row[];
  rejected: Rejected[];
}

export type Extracted =
  | { column: "price"; drafts: PriceDraft[] }
  | { column: "event"; drafts: EventDraft[] }
  | { column: "rank"; drafts: RankDraft[] }
  | { column: "hot"; drafts: HotDraft[] };

export type CleanedSet =
  | { column: "price"; rows: PriceRow[]; rejected: Rejected[] }
  | { column: "event"; rows: EventRow[]; rejected: Rejected[] }
  | { column: "rank"; rows: RankRow[]; rejected: Rejected[] }
  | { column: "hot"; rows: HotRow[]; rejected: Rejected[] };
