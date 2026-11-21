import type { ReactNode } from "react";
import type { Provenance } from "../types";

export interface EvidenceField { label: string; value: string; key: string }

/** 只标记原片段中确实出现的文字，不把归一后的显示值伪装成引文。 */
export function highlightParts(text: string, value: string): Array<{ text: string; marked: boolean }> {
  const exact = value.trim();
  const date = exact.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const month = date ? ["Jan(?:uary)?", "Feb(?:ruary)?", "Mar(?:ch)?", "Apr(?:il)?", "May", "Jun(?:e)?", "Jul(?:y)?", "Aug(?:ust)?", "Sep(?:tember)?", "Oct(?:ober)?", "Nov(?:ember)?", "Dec(?:ember)?"][Number(date[2]) - 1] : "";
  const dateMatches = date && month ? text.match(new RegExp(`(?:${month}\\s+0?${Number(date[3])},?\\s+${date[1]}|0?${Number(date[3])}\\s+${month}\\s+${date[1]}|${date[1]}年\\s*0?${Number(date[2])}月\\s*0?${Number(date[3])}日)`, "gi")) ?? [] : [];
  const candidates = text.toLocaleLowerCase().includes(exact.toLocaleLowerCase()) && exact.length > 0 ? [exact] : dateMatches.length ? dateMatches : (exact.match(/[$¥￥]?\s*\d[\d,]*(?:\.\d+)?%?/g) ?? []).map((token) => token.trim());
  const ranges: Array<[number, number]> = [];
  for (const token of candidates) {
    if (!token) continue;
    const haystack = text.toLocaleLowerCase();
    let offset = 0;
    while (offset < text.length) {
      const start = haystack.indexOf(token.toLocaleLowerCase(), offset);
      if (start < 0) break;
      const end = start + token.length;
      // 数字必须完整匹配，不能把 2 标在 200 或 1.2 里面。
      const numberBefore = /^\d/.test(token) && (/\d/.test(text[start - 1] ?? "") || /[.,]/.test(text[start - 1] ?? "") && /\d/.test(text[start - 2] ?? ""));
      const numberAfter = /\d$/.test(token) && (/\d/.test(text[end] ?? "") || /[.,]/.test(text[end] ?? "") && /\d/.test(text[end + 1] ?? ""));
      if (!numberBefore && !numberAfter) ranges.push([start, end]);
      offset = end;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const parts: Array<{ text: string; marked: boolean }> = [];
  let end = 0;
  for (const [start, next] of ranges) {
    if (start < end) continue;
    if (start > end) parts.push({ text: text.slice(end, start), marked: false });
    parts.push({ text: text.slice(start, next), marked: true });
    end = next;
  }
  if (end < text.length) parts.push({ text: text.slice(end), marked: false });
  return parts;
}

export function HighlightedExcerpt({ text, value }: { text: string; value: string }) {
  return <>{highlightParts(text, value).map((part, index): ReactNode => part.marked ? <mark key={index}>{part.text}</mark> : part.text)}</>;
}

export function originLabel(origin: Provenance["extraction"] | undefined) {
  return origin === "rule" ? "规则抽取" : origin === "model" ? "模型补抽（已核对）" : "旧数据未记录抽取方式";
}

export function briefLabel(origin: Provenance["brief"] | undefined) {
  return origin === "model" ? "模型概括" : origin === "rule" ? "规则概括" : "概括方式未记录";
}
