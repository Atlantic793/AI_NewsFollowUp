/**
 * 从探测时存下的真实响应里切出测试夹具，写到 packages/core/test/fixtures/。
 * 用法：npx tsx scripts/make-fixtures.ts <探测输出目录>
 * 小文件原样复制；大页面只留解析要用的那几块（结构和文字都是原样的）。
 */
import * as cheerio from "cheerio";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { aliyunContent } from "../packages/core/src/parsers/price.js";

const from = process.argv[2];
if (!from) throw new Error("用法：npx tsx scripts/make-fixtures.ts <探测输出目录>");
const to = path.resolve("packages/core/test/fixtures");
mkdirSync(to, { recursive: true });

const read = (name: string) => readFileSync(path.join(from, `${name}.txt`), "utf8");
const write = (file: string, body: string) => {
  writeFileSync(path.join(to, file), body, "utf8");
  console.log(file.padEnd(28), body.length);
};
const copy = (name: string, file: string) => {
  copyFileSync(path.join(from, `${name}.txt`), path.join(to, file));
  console.log(file.padEnd(28), readFileSync(path.join(to, file), "utf8").length);
};
const lines = (name: string, count: number) => read(name).split(/\r?\n/).slice(0, count).join("\n");
const bare = (html: string) => html.replace(/<svg[\s\S]*?<\/svg>/g, "<svg></svg>").replace(/<(script|style)\b(?![^>]*leaderboard-data)[\s\S]*?<\/\1>/g, "");

copy("P01md", "P01-openai-pricing.md");
copy("P03b", "P02-chatgpt-pricing.md");
copy("P04api", "P03-claude-pricing.md");
copy("P05", "P05-gemini-pricing.md");
copy("P06", "P06-deepseek-pricing.html");
copy("A1", "P08-aliyun-coding-plan.html");
copy("P09bigmodel", "P10-zhipu-pricing.md");
copy("P09plan", "P11-glm-coding-plan.md");
copy("N04json", "N03-openai-status.json");
copy("N10gemini", "N08-gemini-changelog.md");
copy("N08rss", "N09-deepmind-rss.xml");
copy("N09news", "N10-deepseek-updates.html");
copy("N12kimi", "N11-kimi-changelog.md");
copy("N13zhipu", "N12-zhipu-releases.md");
copy("H02api", "H02-hf-trending.json");

// Claude 套餐：留下包住全部 [data-plan] 的那一块
{
  const $ = cheerio.load(read("P04"));
  const plans = $("[data-plan]");
  let box = plans.first().parent();
  while (box.length && box.find("[data-plan]").length < plans.length) box = box.parent();
  write("P04-claude-plans.html", `<html><body>${bare($.html(box))}</body></html>`);
}

// 阿里云：正文在 window.__ICE_PAGE_PROPS__ 的 JSON 里，切前两个大类
{
  const content = aliyunContent(read("P07b"));
  const h2 = [...content.matchAll(/<h2\b/g)].map((match) => match.index ?? 0);
  const cut = content.slice(0, h2[2] ?? content.length);
  write("P07-aliyun-pricing.html", `<html><body><script>window.__ICE_PAGE_PROPS__=${JSON.stringify({ docDetailData: { storeData: { data: { content: cut } } } })};</script></body></html>`);
}

// Kimi：Mintlify 编译后的 DocTable 字面量
{
  const body = read("P08kimi");
  const start = body.indexOf("columns:[");
  const end = body.lastIndexOf("]]}");
  write("P09-kimi-pricing.html", body.slice(Math.max(0, start - 200), end + 3));
}

write("N01-openai-changelog.md", lines("N01md", 260));
{
  const body = read("N03rss");
  const items = [...body.matchAll(/<item>[\s\S]*?<\/item>/g)].slice(0, 25).map((match) => match[0]);
  write("N02-openai-news.xml", `${body.slice(0, body.indexOf("<item>"))}${items.join("\n")}\n</channel>\n</rss>\n`);
}
write("N04-claude-release-notes.md", lines("N11claudeapi", 220));
write("N05-claude-code-changelog.md", lines("N05md", 160));

// Anthropic 新闻：精选卡和列表卡
{
  const $ = cheerio.load(read("N06"));
  const cards: string[] = [];
  const seen = new Set<unknown>();
  $("a[class*='title-link'], a[class*='tileLink']").each((_, anchor) => {
    const card = $(anchor).closest("article, [class*='_summary']");
    const node = card.get(0);
    if (!node || seen.has(node) || cards.length >= 12) return;
    seen.add(node);
    cards.push(bare($.html(card)));
  });
  write("N06-anthropic-news.html", `<html><body><main>${cards.join("\n")}</main></body></html>`);
}

// Claude 状态页：组件、未解决事故、最近几天的历史
{
  const $ = cheerio.load(read("N07html"));
  const parts = [
    ...$(".unresolved-incident").map((_, node) => $.html(node)).get(),
    ...$(".component-inner-container").map((_, node) => $.html(node)).get(),
    ...$(".status-day").slice(0, 7).map((_, node) => $.html(node)).get(),
  ];
  write("N07-claude-status.html", `<html><body>${bare(parts.join("\n"))}</body></html>`);
}

// SWE-bench：只留 Verified 榜前 15 条
{
  const $ = cheerio.load(read("R02"));
  const boards = JSON.parse($("script#leaderboard-data").text()) as Array<{ name?: string; results?: Array<{ resolved?: number }> }>;
  const verified = boards.find((board) => board.name === "Verified");
  const results = [...(verified?.results ?? [])].sort((left, right) => (right.resolved ?? 0) - (left.resolved ?? 0)).slice(0, 15);
  write("R02-swebench.html", `<html><body><script id="leaderboard-data" type="application/json">${JSON.stringify([{ ...verified, results }])}</script></body></html>`);
}

// Artificial Analysis：带 Intelligence Index 的那张表，留前 12 行
{
  const $ = cheerio.load(read("R03"));
  const table = $("table").filter((_, element) => /Intelligence Index/i.test($(element).find("thead").text())).first();
  table.find("tbody tr").slice(12).remove();
  write("R03-artificial-analysis.html", `<html><body>${bare($.html(table))}</body></html>`);
}

// GitHub Trending：页头导航 + 前 6 个仓库
{
  const $ = cheerio.load(read("H01"));
  const nav = $("header nav").first();
  const rows = $("article.Box-row").slice(0, 6).map((_, node) => $.html(node)).get();
  write("H01-github-trending.html", `<html><body><header>${bare($.html(nav))}</header><main>${bare(rows.join("\n"))}</main></body></html>`);
}

write("R01-lmarena.json", read("L6"));
