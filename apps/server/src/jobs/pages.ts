import { dateInText } from "@followup/core";
import type { AppDeps } from "../types.js";

const FIRECRAWL_SCRAPE = "https://api.firecrawl.dev/v2/scrape";
const EXCERPT_CAP = 3_500;

export function firecrawlKey(env: NodeJS.ProcessEnv = process.env): string {
  return env.FIRECRAWL_API_KEY?.trim() ?? "";
}

const PAGE_CONCURRENCY = 4;

export interface PageText {
  text: string;
  publishedAt: string;
}

export async function readPages(deps: AppDeps, urls: readonly string[]): Promise<Map<string, PageText>> {
  const excerpts = new Map<string, PageText>();
  const pending = [...new Set(urls)];
  let cursor = 0;
  const worker = async () => {
    while (cursor < pending.length) {
      const url = pending[cursor];
      cursor += 1;
      if (!url) return;
      excerpts.set(url, await readPage(deps, url));
    }
  };
  await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, pending.length) }, () => worker()));
  return excerpts;
}

export async function readPage(deps: AppDeps, url: string): Promise<PageText> {
  const key = firecrawlKey();
  if (key) {
    const scraped = await firecrawlMarkdown(deps, url, key);
    if (scraped.text) return { text: scraped.text.slice(0, EXCERPT_CAP), publishedAt: scraped.publishedAt };
  }
  return pageExcerpt(deps, url);
}

async function firecrawlMarkdown(deps: AppDeps, url: string, key: string): Promise<PageText> {
  try {
    const response = await deps.fetchImpl(FIRECRAWL_SCRAPE, {
      method: "POST",
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
    });
    if (!response.ok) return { text: "", publishedAt: "" };
    const payload = await response.json() as { data?: { markdown?: unknown; metadata?: Record<string, unknown> } };
    const markdown = payload.data?.markdown;
    return {
      text: typeof markdown === "string" ? markdown.trim() : "",
      publishedAt: dateFromMeta(payload.data?.metadata ?? {}),
    };
  } catch {
    return { text: "", publishedAt: "" };
  }
}

export async function pageExcerpt(deps: AppDeps, url: string): Promise<PageText> {
  if (skipFetch(url)) return { text: "", publishedAt: "" };
  try {
    const response = await deps.fetchImpl(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
      headers: { "user-agent": "AI_NewsFollowUp" },
    });
    if (!response.ok) return { text: "", publishedAt: "" };
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("text") && !type.includes("xml") && !type.includes("json")) return { text: "", publishedAt: "" };
    const html = await response.text();
    return { text: stripHtml(html).slice(0, EXCERPT_CAP), publishedAt: dateFromHtml(html) };
  } catch {
    return { text: "", publishedAt: "" };
  }
}

function dateFromMeta(meta: Record<string, unknown>): string {
  const raw = meta.publishedTime ?? meta.published_time ?? meta["article:published_time"] ?? meta["og:published_time"] ?? meta.date;
  return clockFromUnknown(raw);
}

function dateFromHtml(html: string): string {
  const patterns = [
    /<meta[^>]+(?:property|name)=["'](?:article:published_time|og:published_time|publishdate|pubdate|date)["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:article:published_time|og:published_time|publishdate|pubdate|date)["']/i,
  ];
  for (const pattern of patterns) {
    const found = pattern.exec(html);
    const clock = clockFromUnknown(found?.[1]);
    if (clock) return clock;
  }
  return "";
}

function clockFromUnknown(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return "";
  if (!Number.isNaN(Date.parse(raw))) return new Date(raw).toISOString();
  return dateInText(raw) ?? "";
}

function skipFetch(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".test");
  } catch {
    return true;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
