import { groundBrief, ruleBrief, type BriefHit, type BriefMode } from "@followup/core";
import type { AppDeps } from "../types.js";

export interface Brief {
  mode: BriefMode;
  text: string;
}

/** 有密钥就让模型抽取、清洗并概括；数字必须能在原文里找到。否则用规则概括。 */
export async function llmBrief(deps: AppDeps, query: string, hits: readonly BriefHit[]): Promise<Brief> {
  const rule = ruleBrief(query, hits);
  const key = process.env.OPENAI_API_KEY ?? "";
  if (!key || hits.length === 0) return { mode: "rule", text: rule };
  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const corpus = hits.map((hit) => hit.excerpt).join("\n");
  const packed = hits.slice(0, 12).map((hit) => `【${hit.sourceId} ${hit.title}】\n${hit.excerpt.slice(0, 1200)}`).join("\n\n");
  try {
    const response = await deps.fetchImpl(`${base}/chat/completions`, {
      method: "POST",
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: "你是数据采集作业的摘录员。只根据给定原文做三件事：抽取和问题相关的字段，去掉导航和套话，用中文概括。价格、分数、百分比必须在原文里逐字出现。原文没有的数字不要写。不要补充常识。",
          },
          { role: "user", content: `问题：${query}\n\n原文：\n${packed}` },
        ],
      }),
    });
    if (!response.ok) return { mode: "rule", text: rule };
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const grounded = groundBrief(data.choices?.[0]?.message?.content ?? "", corpus);
    return grounded ? { mode: "llm", text: grounded } : { mode: "rule", text: rule };
  } catch {
    return { mode: "rule", text: rule };
  }
}
