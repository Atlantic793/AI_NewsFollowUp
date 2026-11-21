import type { ColumnKind } from "./sources.js";

export interface BlockedPage {
  column: ColumnKind;
  label: string;
  fallbackId: string;
  note: string;
}

/** 这些地址不进采集队列。页面上说明原因，并指向已经在抓的来源。 */
export const BLOCKED_PAGES: readonly BlockedPage[] = [
  { column: "price", label: "ChatGPT 定价页", fallbackId: "P02", note: "对程序返回 403，不绕过。套餐改看 learn.chatgpt.com。" },
  { column: "rank", label: "arena.ai", fallbackId: "R01", note: "返回 403。改看 LMArena 在 Hugging Face 上的官方数据集。" },
  { column: "event", label: "status.claude.com/api/", fallbackId: "N07", note: "robots.txt 不允许。改看状态页 HTML。" },
];

export function fallbackFor(sourceId: string, reason = ""): { sourceId: string; note: string } | null {
  if (sourceId === "H03" && (reason === "" || reason.includes("凭据"))) return { sourceId: "H01", note: "没有 Kaggle 凭据，不编造竞赛。可改看 GitHub 热榜。" };
  return null;
}
