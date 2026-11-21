/** 搜索概括用的一条原文。excerpt 必须是页面上摘下来的那一段。 */
export interface BriefHit {
  sourceId: string;
  title: string;
  excerpt: string;
}

export type BriefMode = "llm" | "rule";

/** 不调用模型时的概括：只复述对上的标题和原文片段。 */
export function ruleBrief(query: string, hits: readonly BriefHit[]): string {
  if (hits.length === 0) return `没有和「${query}」对上的行。`;
  const lines = hits.slice(0, 8).map((hit) => `- ${hit.title}：${hit.excerpt.replace(/\s+/g, " ").trim().slice(0, 120)}`);
  return [`「${query}」对上 ${hits.length} 行。下面是原文片段，没有另补数字。`, ...lines].join("\n");
}

/**
 * 丢掉含有「原文里没有的价格、百分比或小数」的句子。
 * 年份和普通整数不拦，避免把「20 行」这类计数误删。
 */
export function groundBrief(text: string, corpus: string): string {
  const sentences = text.split(/(?<=[。！？\n])/);
  const kept = sentences.filter((sentence) => {
    const numbers = sentence.match(/[$¥￥]\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?%|\d+\.\d+/g) ?? [];
    return numbers.every((token) => corpus.includes(token.replace(/\s/g, "")));
  });
  return kept.join("").trim();
}
