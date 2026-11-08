import { flat, loadHtml, tableGrid } from "../parse/html.js";
import { excerptOf } from "../parse/text.js";
import type { RankDraft } from "../rows.js";

// ---------- LMArena：官方数据集 lmarena-ai/leaderboard-dataset 的 latest 切分 ----------

interface ArenaRow {
  model_name?: string;
  organization?: string;
  rating?: number;
  vote_count?: number;
  rank?: number;
  category?: string;
  leaderboard_publish_date?: string;
}

export function lmarenaRanks(json: string): RankDraft[] {
  const data = JSON.parse(json) as { rows?: Array<{ row?: ArenaRow }> };
  return (data.rows ?? [])
    .map((item) => item.row ?? {})
    .filter((row) => row.category === "overall")
    .map((row) => ({
      rank: String(row.rank ?? ""),
      model: row.model_name ?? "",
      org: row.organization ?? "",
      score: typeof row.rating === "number" ? String(Math.round(row.rating)) : "",
      votes: typeof row.vote_count === "number" ? String(row.vote_count) : "",
      boardDate: row.leaderboard_publish_date ?? "",
      excerpt: JSON.stringify(row),
    }));
}

// ---------- SWE-bench：首页 <script id="leaderboard-data"> 里的 Verified 榜 ----------

interface SweResult {
  name?: string;
  resolved?: number;
  date?: string;
  tags?: string[];
  model_org?: string;
  checked?: unknown;
}

export function swebenchVerified(html: string): RankDraft[] {
  const $ = loadHtml(html);
  const raw = $("script#leaderboard-data").text();
  if (!raw.trim()) return [];
  const boards = JSON.parse(raw) as Array<{ name?: string; results?: SweResult[] }>;
  const results = [...(boards.find((board) => board.name === "Verified")?.results ?? [])]
    .filter((result) => typeof result.resolved === "number")
    .sort((left, right) => (right.resolved ?? 0) - (left.resolved ?? 0));
  const boardDate = results.map((result) => result.date ?? "").sort().at(-1) ?? "";
  return results.map((result, index) => ({
    rank: String(index + 1),
    model: result.name ?? "",
    org: (result.tags ?? []).find((tag) => tag.startsWith("Org: "))?.slice(5) ?? result.model_org ?? "",
    score: `${result.resolved}%`,
    votes: "",
    boardDate,
    excerpt: JSON.stringify({ name: result.name, resolved: result.resolved, date: result.date, tags: result.tags, checked: result.checked }),
  }));
}

// ---------- Artificial Analysis：模型榜表格里的 Intelligence Index 列 ----------

export function artificialAnalysisRanks(html: string): RankDraft[] {
  const $ = loadHtml(html);
  const table = $("table").filter((_, element) => /Intelligence Index/i.test($(element).find("thead").text())).get(0);
  if (!table) return [];
  const grid = tableGrid($, table).map((row) => row.map(flat));
  const headAt = grid.findIndex((row) => row.some((cell) => /Intelligence Index/i.test(cell)) && row.some((cell) => /^Model$/i.test(cell)));
  if (headAt < 0) return [];
  const head = grid[headAt] ?? [];
  const modelAt = head.findIndex((cell) => /^Model$/i.test(cell));
  const orgAt = head.findIndex((cell) => /^Creator$/i.test(cell));
  const scoreAt = head.findIndex((cell) => /Intelligence Index/i.test(cell));
  const rows = grid.slice(headAt + 1)
    .map((row) => ({ row, value: Number.parseFloat(row[scoreAt] ?? "") }))
    .filter((item) => Number.isFinite(item.value))
    .sort((left, right) => right.value - left.value);
  return rows.map(({ row }, index) => ({
    rank: String(index + 1),
    model: row[modelAt] ?? "",
    org: orgAt >= 0 ? row[orgAt] ?? "" : "",
    score: row[scoreAt] ?? "",
    votes: "",
    boardDate: "",
    excerpt: excerptOf(head.join(" | "), row.join(" | ")),
  }));
}
