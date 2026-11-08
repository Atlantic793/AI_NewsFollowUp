export type SourceKind = "api_price" | "plan" | "changelog" | "news" | "status" | "model_card" | "leaderboard" | "hotlist";

export type ColumnKind = "hot" | "price" | "rank" | "event";

export interface SourceDef {
  id: string;
  vendor: string;
  kind: SourceKind;
  url: string;
  label: string;
}

export const SOURCES: readonly SourceDef[] = [
  { id: "P01", vendor: "OpenAI", kind: "api_price", url: "https://developers.openai.com/api/docs/pricing", label: "API 定价" },
  { id: "P02", vendor: "OpenAI", kind: "plan", url: "https://openai.com/chatgpt/pricing", label: "ChatGPT 套餐" },
  { id: "P03", vendor: "OpenAI", kind: "plan", url: "https://chatgpt.com/codex/pricing/", label: "Codex 套餐" },
  { id: "P04", vendor: "Anthropic", kind: "plan", url: "https://claude.com/pricing", label: "Claude 定价" },
  { id: "P05", vendor: "Google", kind: "api_price", url: "https://aistudio.google.com/docs/pricing", label: "Gemini API 定价" },
  { id: "P06", vendor: "DeepSeek", kind: "api_price", url: "https://api-docs.deepseek.com/quick_start/pricing/", label: "模型与定价" },
  { id: "P07", vendor: "阿里云", kind: "api_price", url: "https://help.aliyun.com/zh/model-studio/models", label: "百炼规格与计费" },
  { id: "N01", vendor: "OpenAI", kind: "changelog", url: "https://developers.openai.com/api/docs/changelog", label: "API 更新日志" },
  { id: "N02", vendor: "OpenAI", kind: "news", url: "https://help.openai.com/en/articles/9624314-model-release-notes", label: "模型发布说明" },
  { id: "N03", vendor: "OpenAI", kind: "news", url: "https://openai.com/news", label: "新闻" },
  { id: "N04", vendor: "OpenAI", kind: "status", url: "https://status.openai.com", label: "状态" },
  { id: "N05", vendor: "Anthropic", kind: "changelog", url: "https://code.claude.com/docs/en/changelog", label: "Claude Code 更新日志" },
  { id: "N06", vendor: "Anthropic", kind: "news", url: "https://www.anthropic.com/news", label: "新闻" },
  { id: "N07", vendor: "Anthropic", kind: "status", url: "https://status.claude.com", label: "状态" },
  { id: "N08", vendor: "Google", kind: "news", url: "https://deepmind.google/blog/", label: "DeepMind 博客" },
  { id: "N09", vendor: "DeepSeek", kind: "model_card", url: "https://www.deepseek.com/harness/", label: "DeepSeek Harness" },
  { id: "R01", vendor: "LMArena", kind: "leaderboard", url: "https://arena.ai/leaderboard/chat", label: "文本榜" },
  { id: "R02", vendor: "SWE-bench", kind: "leaderboard", url: "https://www.swebench.com/", label: "Verified" },
  { id: "R03", vendor: "Artificial Analysis", kind: "leaderboard", url: "https://artificialanalysis.ai/", label: "Intelligence Index" },
  { id: "H01", vendor: "GitHub", kind: "hotlist", url: "https://github.com/trending", label: "Trending" },
  { id: "H02", vendor: "Hugging Face", kind: "hotlist", url: "https://huggingface.co/models?sort=trending", label: "模型趋势" },
  { id: "H03", vendor: "Kaggle", kind: "hotlist", url: "https://www.kaggle.com/competitions", label: "竞赛" },
];

export function columnOf(kind: SourceKind): ColumnKind {
  switch (kind) {
    case "hotlist":
      return "hot";
    case "api_price":
    case "plan":
      return "price";
    case "leaderboard":
      return "rank";
    case "changelog":
    case "news":
    case "status":
    case "model_card":
      return "event";
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

export function sourcesFor(column: ColumnKind): SourceDef[] {
  return SOURCES.filter((source) => columnOf(source.kind) === column);
}

export interface PriceDraft {
  product: string;
  kind: "api" | "plan";
  metric: string;
  price: string;
  unit: string;
  quota: string;
  reset: string;
  excerpt: string;
}

export interface RankDraft {
  rank: string;
  model: string;
  score: string;
  excerpt: string;
}

export interface HotDraft {
  rank: string;
  title: string;
  url: string;
}

export interface EventDraft {
  type: "release" | "status" | "capability" | "cn_access";
  text: string;
}

const MONEY = /(?:USD|US\$|\$|¥|￥)\s?\d+(?:\.\d+)?|\d+(?:\.\d+)?\s?(?:美元|元)/;

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d|article)>/gi, "\n")
    .replace(/<t[dh][^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractPrices(text: string, kind: "api" | "plan"): PriceDraft[] {
  const rows: PriceDraft[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim();
    const money = line.match(MONEY);
    if (!money || line.length > 240) continue;
    const product = line.split("|")[0]?.trim() || "";
    rows.push({
      product: product.slice(0, 80),
      kind,
      metric: metricOf(line),
      price: money[0],
      unit: /1\s?M|百万|million/i.test(line) ? "每百万 token" : "",
      quota: quotaOf(line),
      reset: resetOf(line),
      excerpt: line.slice(0, 240),
    });
    if (rows.length >= 40) break;
  }
  return rows;
}

function metricOf(line: string): string {
  const lower = line.toLowerCase();
  if (/cache\s*write|缓存写入/.test(lower)) return "cache_write";
  if (/cache\s*read|缓存读取|cached/.test(lower)) return "cache_read";
  if (/batch|批量/.test(lower) && /output|输出/.test(lower)) return "batch_output";
  if (/batch|批量/.test(lower)) return "batch_input";
  if (/output|输出/.test(lower)) return "output";
  if (/seat|席位|每月|month/.test(lower)) return "seat";
  if (/quota|额度|次/.test(lower)) return "quota";
  return "input";
}

function quotaOf(line: string): string {
  const found = line.match(/额度[^，。|]{0,24}|quota[^，。|]{0,24}/i);
  return found?.[0]?.trim() ?? "";
}

function resetOf(line: string): string {
  const found = line.match(/(?:每|重置)[^，。|]{0,16}|resets?[^，。|]{0,24}/i);
  return found?.[0]?.trim() ?? "";
}

export function extractRanks(text: string): RankDraft[] {
  const rows: RankDraft[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim();
    const found = line.match(/^(\d{1,3})[.\s|]+(.{2,80}?)(?:\s+|｜|\|)(\d+(?:\.\d+)?)%?$/);
    if (!found) continue;
    rows.push({ rank: found[1] ?? "", model: (found[2] ?? "").trim(), score: found[3] ?? "", excerpt: line.slice(0, 240) });
    if (rows.length >= 30) break;
  }
  return rows;
}

export function extractHot(text: string): HotDraft[] {
  const rows: HotDraft[] = [];
  const seen = new Set<string>();
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (line.length < 6 || line.length > 120) continue;
    if (/cookie|sign in|privacy|导航|登录/i.test(line)) continue;
    const key = line.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ rank: String(rows.length + 1), title: line, url: "" });
    if (rows.length >= 20) break;
  }
  return rows;
}

export function extractEvents(text: string, kind: SourceKind): EventDraft[] {
  const compact = text.replace(/\s+/g, " ").trim();
  if (/中国大陆|中国内地/.test(compact) && /注册|调用|付款|不可用|可用/.test(compact)) {
    return [{ type: "cn_access", text: sentenceAround(compact, "中国") }];
  }
  const heading = text.split("\n").map((line) => line.trim()).find((line) => line.length > 8 && line.length < 140);
  if (!heading) return [];
  const type = eventType(kind);
  return [{ type, text: heading.replace(/^#+\s*/, "") }];
}

function eventType(kind: SourceKind): EventDraft["type"] {
  switch (kind) {
    case "status":
      return "status";
    case "model_card":
      return "capability";
    case "changelog":
    case "news":
      return "release";
    case "api_price":
    case "plan":
    case "leaderboard":
    case "hotlist":
      return "release";
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function sentenceAround(text: string, token: string): string {
  const at = text.indexOf(token);
  const start = Math.max(0, at - 20);
  return text.slice(start, start + 160);
}

export function pathAllowed(robots: string, pathname: string): boolean {
  const groups = robots.split(/\n\s*\n/);
  let disallows: string[] = [];
  let allows: string[] = [];
  for (const group of groups) {
    const lines = group.split(/\r?\n/).map((line) => line.replace(/#.*$/, "").trim()).filter(Boolean);
    const agents = lines.filter((line) => /^user-agent:/i.test(line)).map((line) => line.split(":")[1]?.trim() ?? "");
    if (!agents.some((agent) => agent === "*")) continue;
    disallows = lines.filter((line) => /^disallow:/i.test(line)).map((line) => line.split(":").slice(1).join(":").trim());
    allows = lines.filter((line) => /^allow:/i.test(line)).map((line) => line.split(":").slice(1).join(":").trim());
  }
  const ruleHits = (rule: string) => rule !== "" && (rule === "/" || pathname.startsWith(rule));
  if (allows.some(ruleHits)) return true;
  return !disallows.some(ruleHits);
}

export interface ComparedRow {
  key: string;
  fields: Record<string, string>;
}

export interface FieldDiff {
  key: string;
  field: string;
  oldValue: string;
  newValue: string;
}

export function diffRows(previous: readonly ComparedRow[], next: readonly ComparedRow[]): FieldDiff[] {
  const before = new Map(previous.map((row) => [row.key, row]));
  const after = new Map(next.map((row) => [row.key, row]));
  const diffs: FieldDiff[] = [];
  for (const [key, row] of after) {
    const prior = before.get(key);
    if (!prior) {
      diffs.push({ key, field: "row", oldValue: "", newValue: "新增" });
      continue;
    }
    for (const [field, value] of Object.entries(row.fields)) {
      const oldValue = prior.fields[field] ?? "";
      if (oldValue !== value) diffs.push({ key, field, oldValue, newValue: value });
    }
  }
  for (const key of before.keys()) {
    if (!after.has(key)) diffs.push({ key, field: "row", oldValue: "在榜", newValue: "掉出" });
  }
  return diffs;
}

export function watchHits(name: string, haystack: string): boolean {
  const needle = name.trim().toLocaleLowerCase();
  if (!needle) return false;
  return haystack.toLocaleLowerCase().includes(needle);
}
