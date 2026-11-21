import type { CleanedSet, EventRow, HotRow, PriceRow, RankRow } from "./rows.js";
import type { SourceDef } from "./sources.js";
import { cnyLabel } from "./money.js";

const HAN = /\p{Script=Han}/u;

export function hasHan(text: string): boolean {
  return HAN.test(text);
}

const MONTHS: Record<string, string> = {
  january: "1", february: "2", march: "3", april: "4", may: "5", june: "6",
  july: "7", august: "8", september: "9", october: "10", november: "11", december: "12",
};

const PHRASES: Array<[RegExp, string]> = [
  [/\boperational\b/gi, "正常"],
  [/\bdegraded performance\b/gi, "性能下降"],
  [/\bpartial outage\b/gi, "部分中断"],
  [/\bmajor outage\b/gi, "严重中断"],
  [/\bunder maintenance\b/gi, "维护中"],
  [/\binvestigating\b/gi, "调查中"],
  [/\bidentified\b/gi, "已定位"],
  [/\bmonitoring\b/gi, "观察中"],
  [/\bresolved\b/gi, "已解决"],
  [/\blimited availability\b/gi, "限时提供"],
  [/\bcache hit\b/gi, "缓存命中"],
  [/\bcache miss\b/gi, "缓存未命中"],
  [/\boff-peak\b/gi, "低谷时段"],
  [/\bpeak hours?\b/gi, "高峰时段"],
  [/\bper million tokens?\b/gi, "每百万 token"],
  [/\bstorage price\b/gi, "存储价"],
  [/\bmultimodal models?\b/gi, "多模态模型"],
  [/\bspecialized models?\b/gi, "专用模型"],
  [/\bflagship models?\b/gi, "旗舰模型"],
  [/\bwhen billed monthly\b/gi, "按月计费"],
  [/\bbilled annually\b/gi, "按年计费"],
  [/\bbilled monthly\b/gi, "按月计费"],
  [/\bper user per month\b/gi, "每人每月"],
  [/\bfull song\b/gi, "全曲"],
  [/\bfine-tuning\b/gi, "微调"],
  [/\btranscription\b/gi, "转写"],
  [/\bfor prompts up to\b/gi, "适用于提示词不超过"],
  [/\bfor prompts over\b/gi, "适用于提示词超过"],
  [/\bprompts?\s*<=\s*/gi, "提示词不超过 "],
  [/\bprompts?\s*>\s*/gi, "提示词超过 "],
  [/\bstars today\b/gi, "今日星标"],
  [/\bper month\b/gi, "每月"],
  [/\bmonthly\b/gi, "每月"],
  [/\binput\b/gi, "输入"],
  [/\boutput\b/gi, "输出"],
  [/\bcontext\b/gi, "上下文"],
  [/\blength\b/gi, "长度"],
  [/\baudio\b/gi, "音频"],
  [/\bimages\b/gi, "图像"],
  [/\bimage\b/gi, "图像"],
  [/\bvideo\b/gi, "视频"],
  [/\btext\b/gi, "文本"],
  [/\bembedding\b/gi, "向量"],
  [/\bmoderation\b/gi, "审核"],
  [/\bsearch\b/gi, "搜索"],
  [/\busers\b/gi, "用户"],
  [/\btokens?\b/gi, "token"],
  [/\breleased\b/gi, "发布"],
  [/\bavailable\b/gi, "可用"],
];

function proseEnglish(text: string): string[] {
  const withoutNames = text.replace(/[\w.-]+\/[\w.-]+/g, " ").replace(/\b[A-Z][A-Za-z0-9.+-]{2,}\b/g, " ").replace(/\btokens?\b/gi, " ");
  return withoutNames.match(/[A-Za-z]{4,}/g) ?? [];
}

function dated(text: string): string {
  const month = (name: string) => MONTHS[name.toLowerCase()] ?? "";
  return text
    .replace(/\bthrough ([A-Za-z]+) (\d{1,2}), (\d{4})\b/gi, (full, name: string, day: string, year: string) => {
      const value = month(name);
      return value ? `截至 ${year}年${value}月${day}日` : full;
    })
    .replace(/\bstarting ([A-Za-z]+) (\d{1,2}), (\d{4})\b/gi, (full, name: string, day: string, year: string) => {
      const value = month(name);
      return value ? `自 ${year}年${value}月${day}日起` : full;
    });
}

function phrasePass(text: string): string {
  let next = dated(text);
  for (const [pattern, name] of PHRASES) next = next.replace(pattern, name);
  return next.replace(/上下文 长度/g, "上下文长度").replace(/\s+/g, " ").trim();
}

/** 介绍文字只留中文分句。纯英文能对上词表就换成中文；对不上、或仍是英文长句，就返回空。 */
export function introText(text: string): string {
  const trimmed = phrasePass(text);
  if (!trimmed) return "";
  const parts = trimmed.split(/(?<=[。！？])\s*|\s*[·；;]\s*|(?<=\p{Script=Han})[:：]\s*/u);
  const kept = parts.map((part) => part.trim()).filter((part) => part && proseEnglish(part).length <= 2 && (hasHan(part) || proseEnglish(part).length === 0));
  const joined = kept.join("，").replace(/，+/g, "，").replace(/^，|，$/g, "").trim();
  if (!hasHan(joined)) {
    const letters = (joined.match(/[A-Za-z]/g) ?? []).length;
    return letters <= 6 && /\d/.test(joined) ? joined : "";
  }
  return joined;
}

export function showIntro(text: string, brief = "", allowBrief = false): string {
  const direct = introText(text);
  const fromBrief = allowBrief ? introText(brief) : "";
  if (fromBrief && (!direct || fromBrief.length > direct.length + 6)) return shownText(fromBrief);
  if (direct) return shownText(direct);
  if (text.trim() || (allowBrief && brief.trim())) return "说明见右侧原文";
  return "";
}

export function shownText(text: string): string {
  const heat = text.replace(/(\d[\d,]*)\s+stars today/gi, "$1 个今日星标");
  return heat.replace(/\$(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s*美元/g, (full, dollar: string | undefined, amount: string | undefined) => {
    const raw = (dollar ?? amount ?? "").replace(/,/g, "");
    const value = Number(raw);
    if (!Number.isFinite(value)) return full;
    const label = cnyLabel(dollar ? `$${raw}` : `${raw}元`, value, "USD");
    return full.includes(label) ? full : `${full}（约${label}）`;
  });
}

function eventTypeName(type: EventRow["type"]): string {
  switch (type) {
    case "release":
      return "发布";
    case "news":
      return "新闻";
    case "status":
      return "状态";
    case "incident":
      return "事故";
    case "cn_access":
      return "中国大陆";
    default: {
      const unreachable: never = type;
      return unreachable;
    }
  }
}

function priceSentence(row: PriceRow): string {
  const bits = [row.metric, cnyLabel(row.price, row.amount, row.currency), row.unit, introText(row.condition), introText(row.quota), introText(row.reset)].filter(Boolean);
  return `${row.product}：${bits.join(" ")}`.slice(0, 180);
}

function rankSentence(row: RankRow, board: string): string {
  const place = row.basis === "printed" ? `第 ${row.rank} 名` : `按分数排序第 ${row.rank}`;
  const date = row.boardDate || "页面未印日期";
  return `${board} · ${place} · ${row.model} · ${row.score} · ${date}`;
}

/** 简介本身已经是中文，并且没有成段英文时，直接拿来给人看。英文介绍留给模型翻译。 */
export function hotPurpose(summary: string): string {
  const trimmed = summary.trim();
  if (!trimmed || proseEnglish(trimmed).length > 2) return "";
  return introText(trimmed).slice(0, 100);
}

export function eventSentence(row: EventRow): string {
  if (row.type === "status" && row.detail.startsWith("正常")) return "正常";
  const detail = introText(row.detail);
  const name = eventTypeName(row.type);
  if (detail) return `${name}：${detail}`.slice(0, 80);
  if (hasHan(row.title)) return `${name}：${row.title}`.slice(0, 80);
  return `${name}，日期 ${row.date}`;
}

/** 规则已经抽出的行：用中文补上给人看的一句。不改价格、名次和原文。已有 brief 的行保持不动。 */
export function withLocalBriefs(source: SourceDef, set: CleanedSet): CleanedSet {
  switch (set.column) {
    case "price":
      return { column: "price", rejected: set.rejected, rows: set.rows.map((row) => localBrief(row, priceSentence(row))) };
    case "rank": {
      const board = `${source.vendor} ${source.label}`;
      return { column: "rank", rejected: set.rejected, rows: set.rows.map((row) => localBrief(row, rankSentence(row, board))) };
    }
    case "hot":
      return { column: "hot", rejected: set.rejected, rows: set.rows.map((row) => localBrief(row, hotPurpose(row.summary))) };
    case "event":
      return { column: "event", rejected: set.rejected, rows: set.rows.map((row) => localBrief(row, eventSentence(row))) };
    default: {
      const unreachable: never = set;
      return unreachable;
    }
  }
}

function localBrief<T extends PriceRow | RankRow | HotRow | EventRow>(row: T, fallback: string): T {
  return { ...row, brief: row.brief || fallback, provenance: { extraction: row.provenance?.extraction ?? "unknown", modelFields: row.provenance?.modelFields ?? [], brief: row.brief ? row.provenance?.brief ?? "unknown" : "rule" } };
}
