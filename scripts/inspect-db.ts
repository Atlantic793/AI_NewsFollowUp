/**
 * 逐栏检查库里的行：每个来源几行、抽样、有没有导航词或缺必填字段。
 * 用法：npx tsx scripts/inspect-db.ts [数据目录]
 */
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const dataDir = process.argv[2] ?? (process.env.APPDATA ? path.join(process.env.APPDATA, "AI_NewsFollowUp") : path.join(os.homedir(), ".ai-newsfollowup"));
const db = new DatabaseSync(path.join(dataDir, "headline.sqlite"), { readOnly: true });
const NAV = /^(skip to (main )?content|sign in|sign up|log ?in|pricing|docs|documentation|products?|search|home|copy page|explore|登录|注册|首页|文档|定价)$/i;

type Row = Record<string, string | number | null>;
const all = (sql: string) => db.prepare(sql).all() as Row[];

console.log("== 最近一轮 ==");
for (const run of all("SELECT source_id, status, http_status, extracted, cleaned, rejected, stored, changed, error FROM runs WHERE id IN (SELECT MAX(id) FROM runs GROUP BY source_id) ORDER BY source_id")) {
  console.log(`${run.source_id} ${String(run.status).padEnd(7)} http=${run.http_status ?? "-"} 抽取=${run.extracted} 清洗=${run.cleaned} 丢弃=${run.rejected} 入库=${run.stored} 变化=${run.changed} ${run.error ?? ""}`);
}

const checks: Array<{ table: string; title: string; required: string[]; show: string[] }> = [
  { table: "prices", title: "product", required: ["product", "metric", "price"], show: ["product", "tier", "metric", "condition", "price", "unit", "quota"] },
  { table: "ranks", title: "model", required: ["model", "score"], show: ["rank_no", "model", "org", "score", "board_date"] },
  { table: "hot", title: "title", required: ["title", "url"], show: ["rank_no", "title", "url", "heat"] },
  { table: "events", title: "title", required: ["title", "date"], show: ["date", "type", "title", "url"] },
];

for (const check of checks) {
  const rows = all(`SELECT * FROM ${check.table} ORDER BY source_id, id`);
  const nav = rows.filter((row) => row.type !== "status" && NAV.test(String(row[check.title] ?? "")));
  const missing = rows.filter((row) => check.required.some((field) => !String(row[field] ?? "").trim()));
  const noExcerpt = rows.filter((row) => !String(row.excerpt ?? "").trim());
  console.log(`\n== ${check.table}：${rows.length} 行；导航词 ${nav.length}；缺必填 ${missing.length}；没有原文片段 ${noExcerpt.length} ==`);
  for (const sourceId of [...new Set(rows.map((row) => String(row.source_id)))]) {
    const own = rows.filter((row) => row.source_id === sourceId);
    console.log(`  ${sourceId}：${own.length} 行`);
    for (const row of own.slice(0, 2)) console.log(`     ${check.show.map((field) => `${field}=${String(row[field] ?? "").slice(0, 60)}`).join(" | ")}`);
  }
  for (const row of [...nav, ...missing].slice(0, 5)) console.log("  !!", JSON.stringify(row).slice(0, 300));
}
