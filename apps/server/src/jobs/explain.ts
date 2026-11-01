import { fallbackDigest, type DigestBrief, type DigestItem } from "@followup/core";
import { extractJson } from "../model/json.js";
import type { AppDeps } from "../types.js";
import { pageExcerpt } from "./pages.js";

export interface ExplainSource {
  title: string;
  url: string;
  summary: string;
  platform: string;
  excerpt?: string;
}

export async function explainItems(deps: AppDeps, sources: ExplainSource[], topic: { utterance: string; audience: string }): Promise<DigestBrief> {
  const kept = sources.filter((item) => /^https?:\/\//i.test(item.url)).slice(0, 7);
  const fallback = { ...fallbackDigest({ name: topic.utterance, sources: kept }), lead: "" };
  if (kept.length === 0 || !deps.model.available) return fallback;
  const packets = await Promise.all(kept.map(async (item) => ({
    ...item,
    excerpt: item.excerpt ?? (await pageExcerpt(deps, item.url)).text,
  })));
  try {
    const reply = await deps.model.complete([
      {
        role: "system",
        content: "你在写一份主题简报。每条只能根据检索摘要和页面摘录写发生了什么、为何值得这个受众关注。摘录里没有的数字、百分比、价格和日期不要写。不要编造链接。lead 只写这些留下条目的局面：这几天里事情怎么样、新进展是哪几条、下一篇值得打开哪一条。不要提丢掉的条目，不要编摘录里没有的数字。跟进建议 2 到 4 条，每条点名上面某一条标题。只输出 JSON：{\"lead\":string,\"items\":[{\"url\":string,\"what\":string,\"why\":string}],\"followups\":string[]}。",
      },
      {
        role: "user",
        content: JSON.stringify({
          topic: topic.utterance,
          audience: topic.audience,
          items: packets.map((item) => ({
            title: item.title,
            url: item.url,
            source: item.platform,
            summary: item.summary,
            excerpt: item.excerpt,
          })),
        }),
      },
    ]);
    return acceptDigest(extractJson(reply), kept, fallback);
  } catch {
    return fallback;
  }
}

function acceptDigest(raw: unknown, sources: ExplainSource[], fallback: DigestBrief): DigestBrief {
  const record = raw && typeof raw === "object" ? raw as { lead?: unknown; items?: unknown; followups?: unknown } : {};
  const allowed = new Set(sources.map((item) => item.url));
  const byUrl = new Map(sources.map((item) => [item.url, item]));
  const items: DigestItem[] = [];
  if (Array.isArray(record.items)) {
    for (const row of record.items) {
      if (!row || typeof row !== "object") continue;
      const item = row as { url?: unknown; what?: unknown; why?: unknown };
      const url = typeof item.url === "string" ? item.url.trim() : "";
      const source = byUrl.get(url);
      const what = typeof item.what === "string" ? item.what.trim() : "";
      const why = typeof item.why === "string" ? item.why.trim() : "";
      if (!source || what.length < 12 || foreignUrl(`${what}\n${why}`, allowed)) continue;
      items.push({
        title: source.title,
        url,
        what,
        why: why || "打开原文看它和主题的关系。",
        source: source.platform,
      });
    }
  }
  if (items.length === 0) return { ...fallback, lead: "" };
  const followups = Array.isArray(record.followups)
    ? record.followups.flatMap((item) => typeof item === "string" && item.trim().length > 4 ? [item.trim()] : []).slice(0, 4)
    : fallback.followups;
  const lead = typeof record.lead === "string" ? record.lead.trim() : "";
  return { lead, items, followups };
}

function foreignUrl(text: string, allowed: Set<string>): boolean {
  const found = text.match(/https?:\/\/[^\s)]+/g) ?? [];
  return found.some((url) => !allowed.has(url.replace(/[。．]+$/u, "")));
}

