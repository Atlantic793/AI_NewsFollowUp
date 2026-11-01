import type { CommandHelp } from "./parse.js";
import type { RawItem } from "../types.js";

const TITLE_KEYS = ["title", "name", "headline", "subject", "label", "fullName", "package", "gem", "artifactId", "image", "venue", "desc", "text", "content"];
const URL_KEYS = ["url", "link", "href", "item_url", "profile_url", "uri", "projectUrl", "sourceUrl"];
const TIME_KEYS = [
  "pubdate_ts", "pubdate", "published_at", "publishedAt", "published", "publishedOn", "publish_time", "publish_date",
  "postTime", "time", "date", "created_at", "createdAt", "created", "created_utc", "creation_date", "datetime",
  "updated", "updatedAt", "updated_at", "issueDate", "pdate", "premiered", "lastPublished",
];
const SUMMARY_KEYS = ["desc", "description", "summary", "snippet", "abstract", "content", "selftext", "text", "intro", "preview", "info", "bio"];
const CONTEXT_KEYS = ["authors", "author", "journal", "venue", "source", "primary_category", "section"];
const KEYWORD_ARGS = new Set(["query", "keyword", "q", "keywords"]);

function hasKey(columns: readonly string[], keys: readonly string[]): boolean {
  return keys.some((key) => columns.includes(key));
}

function pick(row: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key];
  }
  return undefined;
}

export function keywordArg(help: CommandHelp): string | null {
  const positionals = help.positionals ?? [];
  const requiredOptions = (help.command_options ?? []).filter((item) => item.required && item.default === undefined);
  if (requiredOptions.length > 0) return null;
  const requiredPositionals = positionals.filter((item) => item.required && item.default === undefined);
  if (requiredPositionals.length > 1) return null;
  const candidate = requiredPositionals.length === 1 ? requiredPositionals[0] : positionals.length === 1 ? positionals[0] : undefined;
  const name = candidate?.name ?? "";
  return KEYWORD_ARGS.has(name) ? name : null;
}

export function needsLogin(description: string | undefined): boolean {
  return /需要登录|logged-in|log in to|sign in/i.test(description ?? "");
}

export function genericSupports(help: CommandHelp): boolean {
  const columns = help.columns ?? [];
  return hasKey(columns, TITLE_KEYS) && hasKey(columns, URL_KEYS);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function rowsOf(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.flatMap((row) => {
    const record = asRecord(row);
    return record ? [record] : [];
  });
  const record = asRecord(data);
  if (!record) return [];
  for (const key of ["items", "rows", "results"]) {
    if (Array.isArray(record[key])) return rowsOf(record[key]);
  }
  return [];
}

function publishedAt(row: Record<string, unknown>): string | null {
  const raw = pick(row, TIME_KEYS);
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw >= 1900 && raw <= 2100) return new Date(Date.UTC(raw, 0, 1)).toISOString();
    const millis = raw > 1e12 ? raw : raw * 1000;
    return new Date(millis).toISOString();
  }
  if (typeof raw === "string" && !Number.isNaN(Date.parse(raw))) return new Date(raw).toISOString();
  return null;
}

function asText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string").join("、").trim();
  return "";
}

function summaryOf(row: Record<string, unknown>): string {
  const direct = asText(pick(row, SUMMARY_KEYS));
  if (direct) return direct;
  const bits = CONTEXT_KEYS.flatMap((key) => {
    const text = asText(row[key]);
    return text ? [text] : [];
  });
  return bits.join(" · ").slice(0, 400);
}

export function genericNormalize(data: unknown, platform: string): RawItem[] {
  const items: RawItem[] = [];
  for (const row of rowsOf(data)) {
    const title = asText(pick(row, TITLE_KEYS));
    const url = asText(pick(row, URL_KEYS));
    const time = publishedAt(row);
    if (!title) continue;
    if (!/^https?:\/\//i.test(url)) continue;
    items.push({
      title,
      url,
      platform,
      publishedAt: time ?? "",
      summary: summaryOf(row),
    });
  }
  return items;
}
