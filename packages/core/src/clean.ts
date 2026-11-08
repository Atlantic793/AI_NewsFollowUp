import { isoDate, stripMd } from "./parse/text.js";
import type {
  Cleaned,
  CleanedSet,
  EventDraft,
  EventRow,
  Extracted,
  HotDraft,
  HotRow,
  PriceDraft,
  PriceRow,
  RankDraft,
  RankRow,
  Rejected,
} from "./rows.js";
import type { SourceDef } from "./sources.js";

export const KEEP = { rank: 50, hot: 25, event: 20 } as const;

const NAV = /^(skip to (main )?content|sign in|sign up|log ?in|products?|pricing|plans?|documentation|docs|search|home|plugins|copy page|getting started|about|blog|news|contact( sales| us)?|try claude|learn more|get started|explore|menu|next|previous|下一页|上一页|登录|注册|首页|文档|产品|定价|搜索|联系我们|联系销售|立即购买|免费试用)$/i;

export const priceKey = (row: Pick<PriceRow, "product" | "tier" | "metric" | "condition">) => [row.product, row.tier, row.metric, row.condition].join("|");
export const rankKey = (row: Pick<RankRow, "model">) => row.model;
export const hotKey = (row: Pick<HotRow, "url">) => row.url;
export const eventKey = (row: Pick<EventRow, "type" | "title" | "date" | "url">) => (row.type === "status" ? `status|${row.title}|${row.url}` : `${row.type}|${row.title}|${row.date}`);

class Sink<Row> {
  readonly rows: Row[] = [];
  readonly rejected: Rejected[] = [];
  private readonly seen = new Map<string, string>();

  reject(reason: string, excerpt: string): void {
    this.rejected.push({ reason, excerpt: excerpt.slice(0, 600) });
  }

  add(key: string, signature: string, row: Row, excerpt: string, duplicate = "重复"): void {
    const before = this.seen.get(key);
    if (before !== undefined) {
      this.reject(before === signature ? duplicate : "同一项出现两个不同的值，留第一处", excerpt);
      return;
    }
    this.seen.set(key, signature);
    this.rows.push(row);
  }

  done(): Cleaned<Row> {
    return { rows: this.rows, rejected: this.rejected };
  }
}

function tidy(value: string): string {
  return stripMd(value).replace(/\s*\*+$/, "").trim();
}

function joinParts(...parts: string[]): string {
  return parts.map((part) => part.trim()).filter(Boolean).join(" · ");
}

/** 清洗步：按栏目归一字段、校验必填项、去重，丢掉的行带原因。 */
export function clean(source: SourceDef, extracted: Extracted, today: string): CleanedSet {
  switch (extracted.column) {
    case "price":
      return { column: "price", ...cleanPrices(extracted.drafts) };
    case "event":
      return { column: "event", ...cleanEvents(extracted.drafts, today) };
    case "rank":
      return { column: "rank", ...cleanRanks(extracted.drafts) };
    case "hot":
      return { column: "hot", ...cleanHot(extracted.drafts, source.page) };
    default: {
      const unreachable: never = extracted;
      return unreachable;
    }
  }
}

// ---------- 价目 ----------

type Money =
  | { ok: true; amount: number; currency: "USD" | "CNY" | ""; display: string; unitText: string; note: string }
  | { ok: false; reason: string };

function currencyOf(text: string): "USD" | "CNY" | "" {
  if (/\$|USD|美元/.test(text)) return "USD";
  if (/¥|￥|元|CNY|RMB/.test(text)) return "CNY";
  return "";
}

export function parseMoney(raw: string, unitHint: string): Money {
  const text = tidy(raw);
  const hinted = currencyOf(unitHint);
  if (!text || /^[-—–]+$/.test(text)) return { ok: false, reason: "格子是空的" };
  if (/^(free( of charge)?|免费|限时免费|不计费)$/i.test(text)) {
    return { ok: true, amount: 0, currency: hinted, display: /限时/.test(text) ? "限时免费" : "免费", unitText: "", note: "" };
  }
  if (/^目前仅供免费体验/.test(text)) return { ok: true, amount: 0, currency: hinted, display: "仅供免费体验", unitText: "", note: "免费额度用完后不可调用" };
  if (/not available|unavailable|不支持|不提供|^n\/a$/i.test(text)) return { ok: false, reason: "这一档不提供" };
  if (/contact|联系/i.test(text)) return { ok: false, reason: "要联系销售，没有标价" };
  const found = text.match(/(US\$|USD|\$|¥|￥|CNY|RMB)?\s*(\d[\d,]*(?:\.\d+)?)\s*(美元|元|USD|CNY)?/);
  if (!found || found.index === undefined) return { ok: false, reason: "不是价格" };
  const currency = currencyOf(`${found[1] ?? ""}${found[3] ?? ""}`) || hinted;
  if (!currency) return { ok: false, reason: "没有币种" };
  const number = found[2] ?? "";
  const before = text.slice(0, found.index).trim();
  const after = text.slice(found.index + found[0].length).trim();
  const asides = (after.match(/[（(][^）)]*[）)]/g) ?? []).map((aside) => aside.slice(1, -1));
  return {
    ok: true,
    amount: Number(number.replace(/,/g, "")),
    currency,
    display: `${currency === "USD" ? "$" : "¥"}${number}`,
    unitText: after.replace(/[（(][^）)]*[）)]/g, "").trim(),
    note: joinParts(/^(from|起)/i.test(before) ? "起价" : before, ...asides),
  };
}

export function unitName(raw: string, kind: "api" | "plan"): string {
  const text = tidy(raw).toLowerCase();
  if (!text) return kind === "plan" ? "" : "每百万 token";
  if (/mtok|1m tokens|百万\s*tokens?|million tokens|1,000,000 tokens|百万 token/.test(text)) return /hour|小时/.test(text) ? "每百万 token 每小时" : "每百万 token";
  if (/1m characters|百万字符/.test(text)) return "每百万字符";
  if (/万字符/.test(text)) return "每万字符";
  if (/seat|席位/.test(text)) return "每席位每月";
  if (/(user|人).*(month|月)/.test(text)) return "每人每月";
  if (/month|月/.test(text)) return "每月";
  if (/year|annual|年/.test(text)) return "每年";
  if (/minute|分钟/.test(text)) return "每分钟";
  if (/second|秒/.test(text)) return "每秒";
  if (/1,?000\s+(successful\s+)?(requests|calls)|1k calls|千次/.test(text)) return "每千次请求";
  if (/image|张/.test(text)) return "每张";
  if (/request|次/.test(text)) return "每次";
  return tidy(raw);
}

function tierName(tier: string, kind: "api" | "plan"): string {
  const text = tidy(tier);
  if (!text) return kind === "plan" ? "订阅" : "标准";
  if (/^standard$/i.test(text)) return "标准";
  if (/^batch$/i.test(text)) return "批量";
  return text;
}

export function cleanPrices(drafts: readonly PriceDraft[]): Cleaned<PriceRow> {
  const sink = new Sink<PriceRow>();
  for (const draft of drafts) {
    let product = tidy(draft.product);
    let condition = tidy(draft.condition);
    const paren = product.match(/^(.+?)\s*[（(]([^()（）]+)[）)]$/);
    if (paren) {
      product = (paren[1] ?? "").trim();
      condition = joinParts(paren[2] ?? "", condition);
    }
    if (!product) {
      sink.reject("没有产品名", draft.excerpt);
      continue;
    }
    if (NAV.test(product)) {
      sink.reject("导航或按钮文字", draft.excerpt);
      continue;
    }
    const metric = tidy(draft.metric);
    if (!metric) {
      sink.reject("没有计价项", draft.excerpt);
      continue;
    }
    const quota = tidy(draft.quota);
    const money = parseMoney(draft.price, draft.unit);
    if (!money.ok && !(draft.kind === "plan" && quota)) {
      sink.reject(draft.kind === "plan" && !tidy(draft.price) ? "页面没有标价" : money.reason, draft.excerpt);
      continue;
    }
    const row: PriceRow = {
      kind: draft.kind,
      product,
      tier: tierName(draft.tier, draft.kind),
      metric,
      condition: joinParts(condition, money.ok ? money.note : ""),
      price: money.ok ? money.display : "未标价",
      amount: money.ok ? money.amount : null,
      currency: money.ok ? money.currency : "",
      unit: unitName(money.ok && money.unitText ? money.unitText : draft.unit, draft.kind),
      quota,
      reset: tidy(draft.reset),
      excerpt: draft.excerpt,
    };
    sink.add(priceKey(row), `${row.price}|${row.unit}|${row.quota}|${row.reset}`, row, draft.excerpt);
  }
  return sink.done();
}

// ---------- 排名 ----------

export function cleanRanks(drafts: readonly RankDraft[], keep: number = KEEP.rank): Cleaned<RankRow> {
  const sink = new Sink<RankRow>();
  for (const draft of drafts) {
    const rank = Number.parseInt(draft.rank, 10);
    if (!Number.isFinite(rank) || rank < 1) {
      sink.reject("名次不是数字", draft.excerpt);
      continue;
    }
    const model = tidy(draft.model);
    if (!model) {
      sink.reject("没有模型名", draft.excerpt);
      continue;
    }
    if (NAV.test(model)) {
      sink.reject("导航或按钮文字", draft.excerpt);
      continue;
    }
    const scoreValue = Number.parseFloat(draft.score.replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(scoreValue)) {
      sink.reject("分数不是数字", draft.excerpt);
      continue;
    }
    const row: RankRow = { rank, model, org: tidy(draft.org), score: tidy(draft.score), scoreValue, votes: tidy(draft.votes), boardDate: isoDate(draft.boardDate), excerpt: draft.excerpt };
    sink.add(rankKey(row), "", row, draft.excerpt, "同一模型重复上榜，留名次靠前的");
  }
  const result = sink.done();
  const sorted = [...result.rows].sort((left, right) => left.rank - right.rank);
  for (const row of sorted.slice(keep)) result.rejected.push({ reason: `只留前 ${keep} 名`, excerpt: row.excerpt.slice(0, 600) });
  return { rows: sorted.slice(0, keep), rejected: result.rejected };
}

// ---------- 热榜 ----------

const SLUG_HOSTS = new Set(["github.com", "huggingface.co"]);

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function cleanHot(drafts: readonly HotDraft[], page: string, keep: number = KEEP.hot): Cleaned<HotRow> {
  const sink = new Sink<HotRow>();
  const host = hostOf(page);
  for (const draft of drafts) {
    const title = tidy(draft.title);
    if (!title) {
      sink.reject("没有标题", draft.excerpt);
      continue;
    }
    if (NAV.test(title)) {
      sink.reject("导航或按钮文字", draft.excerpt);
      continue;
    }
    if (!/^https?:\/\//.test(draft.url)) {
      sink.reject("没有自己的链接", draft.excerpt);
      continue;
    }
    if (hostOf(draft.url) !== host) {
      sink.reject("链接不在榜单网站上", draft.excerpt);
      continue;
    }
    if (SLUG_HOSTS.has(host) && !/^[\w.-]+\/[\w.-]+$/.test(title)) {
      sink.reject("不是 owner/name 形式的条目", draft.excerpt);
      continue;
    }
    const row: HotRow = { rank: sink.rows.length + 1, title, url: draft.url, heat: tidy(draft.heat), summary: tidy(draft.summary), excerpt: draft.excerpt };
    sink.add(hotKey(row), row.title, row, draft.excerpt);
  }
  const result = sink.done();
  for (const row of result.rows.slice(keep)) result.rejected.push({ reason: `只留前 ${keep} 条`, excerpt: row.excerpt.slice(0, 600) });
  return { rows: result.rows.slice(0, keep).map((row, index) => ({ ...row, rank: index + 1 })), rejected: result.rejected };
}

// ---------- 厂商动态 ----------

const STATUS_WORDS: Array<[RegExp, string]> = [
  [/\boperational\b/i, "正常"],
  [/\bdegraded[ _]performance\b/i, "性能下降"],
  [/\bpartial[ _]outage\b/i, "部分中断"],
  [/\bmajor[ _]outage\b/i, "严重中断"],
  [/\bunder[ _]maintenance\b/i, "维护中"],
  [/^investigating\b/i, "调查中"],
  [/^identified\b/i, "已定位"],
  [/^monitoring\b/i, "观察中"],
  [/^resolved\b/i, "已解决"],
  [/^postmortem\b/i, "已复盘"],
  [/\bimpact none\b/i, "影响：无"],
  [/\bimpact minor\b/i, "影响：轻微"],
  [/\bimpact major\b/i, "影响：较大"],
  [/\bimpact critical\b/i, "影响：严重"],
];

function statusText(value: string): string {
  let text = tidy(value);
  for (const [pattern, name] of STATUS_WORDS) text = text.replace(pattern, name);
  return text;
}

/** 同一句里既写到中国大陆，又写到注册、调用或付款，才算地区政策。 */
export function mentionsMainland(text: string): boolean {
  return text.split(/(?<=[。！？；;!?])\s*|(?<=\.)\s+/).some((sentence) =>
    /中国大陆|中国内地|mainland china|chinese mainland/i.test(sentence)
    && /注册|调用|付款|支付|sign[ -]?up|register|access|available|payment|billing|\bapi\b/i.test(sentence));
}

export function cleanEvents(drafts: readonly EventDraft[], today: string, keep: number = KEEP.event): Cleaned<EventRow> {
  const sink = new Sink<EventRow>();
  for (const draft of drafts) {
    const title = tidy(draft.title).replace(/^[^\p{L}\p{N}]+/u, "");
    if (title.length < 2) {
      sink.reject("没有标题", draft.excerpt);
      continue;
    }
    if (draft.type !== "status" && NAV.test(title)) {
      sink.reject("导航或按钮文字", draft.excerpt);
      continue;
    }
    const date = isoDate(draft.date) || (draft.type === "status" ? today : "");
    if (!date) {
      sink.reject("没有日期", draft.excerpt);
      continue;
    }
    const detail = (draft.type === "status" || draft.type === "incident" ? statusText(draft.detail) : tidy(draft.detail)).slice(0, 400);
    if (draft.type === "status" && !detail) {
      sink.reject("没有状态", draft.excerpt);
      continue;
    }
    const type = draft.type !== "status" && mentionsMainland(`${title} ${detail}`) ? "cn_access" : draft.type;
    const row: EventRow = { type, title, date, detail, url: /^https?:\/\//.test(draft.url) ? draft.url : "", excerpt: draft.excerpt };
    sink.add(eventKey(row), row.detail, row, draft.excerpt);
  }
  const result = sink.done();
  const status = result.rows.filter((row) => row.type === "status");
  const dated = result.rows.filter((row) => row.type !== "status").sort((left, right) => right.date.localeCompare(left.date));
  for (const row of dated.slice(keep)) result.rejected.push({ reason: `只留最近 ${keep} 条`, excerpt: row.excerpt.slice(0, 600) });
  return { rows: [...dated.slice(0, keep), ...status], rejected: result.rejected };
}
