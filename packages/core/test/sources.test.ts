import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { clean, extract, sourceById, type EventRow, type HotRow, type PriceRow, type RankRow, type Rejected } from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (file: string) => readFileSync(path.join(here, "fixtures", file), "utf8");

function pipeline(id: string, file: string) {
  const source = sourceById(id);
  if (!source) throw new Error(`没有来源 ${id}`);
  const extracted = extract(source, fixture(file));
  return { extracted, cleaned: clean(source, extracted, "2026-11-08") };
}

function prices(id: string, file: string): { rows: PriceRow[]; rejected: Rejected[] } {
  const { cleaned } = pipeline(id, file);
  if (cleaned.column !== "price") throw new Error("不是价目");
  return cleaned;
}

function events(id: string, file: string): EventRow[] {
  const { cleaned } = pipeline(id, file);
  if (cleaned.column !== "event") throw new Error("不是动态");
  return cleaned.rows;
}

function ranks(id: string, file: string): RankRow[] {
  const { cleaned } = pipeline(id, file);
  if (cleaned.column !== "rank") throw new Error("不是排名");
  return cleaned.rows;
}

function hot(id: string, file: string): HotRow[] {
  const { cleaned } = pipeline(id, file);
  if (cleaned.column !== "hot") throw new Error("不是热榜");
  return cleaned.rows;
}

const find = (rows: PriceRow[], match: Partial<PriceRow>) =>
  rows.find((row) => Object.entries(match).every(([key, value]) => row[key as keyof PriceRow] === value));

const NAV_WORDS = /^(sign in|sign up|pricing|docs|products?|search|skip to content|登录|注册|首页)$/i;

describe("价目：每个价格格子一行", () => {
  it("OpenAI API 定价：按模型、档位、上下文分开", () => {
    const { rows, rejected } = prices("P01", "P01-openai-pricing.md");
    expect(rows.length).toBeGreaterThan(500);
    const input = rows.find((row) => row.product === "gpt-6-astra" && row.tier === "标准" && row.metric === "输入" && row.condition.includes("短上下文"));
    expect(input).toMatchObject({ price: "$10.00", amount: 10, currency: "USD", unit: "每百万 token" });
    expect(rows.every((row) => row.amount !== null && !NAV_WORDS.test(row.product))).toBe(true);
    expect(new Set(rejected.map((item) => item.reason))).toEqual(new Set(["格子是空的"]));
  });

  it("ChatGPT / Codex 套餐：价格、5 小时额度、重置规则", () => {
    const { rows, rejected } = prices("P02", "P02-chatgpt-pricing.md");
    expect(rows.map((row) => row.product)).toEqual(["Free", "Go", "Plus", "Pro", "Business"]);
    expect(find(rows, { product: "Plus" })).toMatchObject({ price: "$20", unit: "每月", reset: "每 5 小时" });
    expect(find(rows, { product: "Plus" })?.quota).toContain("GPT-6 Astra 5-45");
    expect(find(rows, { product: "Pro" })).toMatchObject({ price: "$100", condition: "起价", reset: "目前没有 5 小时上限" });
    expect(rejected.map((item) => item.reason)).toEqual(["页面没有标价", "页面没有标价", "页面没有标价"]);
  });

  it("Claude API 定价：标准、批量各自成行", () => {
    const { rows } = prices("P03", "P03-claude-pricing.md");
    expect(find(rows, { product: "Claude Fable 5.1", tier: "标准", metric: "输入" })?.price).toBe("$10");
    expect(find(rows, { product: "Claude Fable 5.1", tier: "标准", metric: "5 分钟缓存写入" })?.price).toBe("$12.50");
    expect(rows.some((row) => row.tier === "批量")).toBe(true);
  });

  it("Claude 套餐：按年、按月、席位分开", () => {
    const { rows } = prices("P04", "P04-claude-plans.html");
    expect(rows).toHaveLength(9);
    expect(find(rows, { product: "Pro", condition: "按年付费" })?.price).toBe("$17");
    expect(find(rows, { product: "Team · Premium seat", condition: "按月付费" })).toMatchObject({ price: "$125", unit: "每席位每月" });
  });

  it("Gemini API 定价：同一格里的分段价各成一行，等价换算不当价格", () => {
    const { rows, rejected } = prices("P05", "P05-gemini-pricing.md");
    expect(find(rows, { product: "gemini-4-argon", metric: "输入", condition: "through November 30, 2026" })?.price).toBe("$2.00");
    expect(find(rows, { product: "gemini-4-argon", metric: "输入", condition: "starting December 1, 2026" })?.price).toBe("$4.00");
    expect(rejected).toEqual([]);
  });

  it("DeepSeek：缓存命中 / 未命中 × 低谷 / 高峰", () => {
    const { rows } = prices("P06", "P06-deepseek-pricing.html");
    expect(rows).toHaveLength(14);
    expect(find(rows, { product: "deepseek-flash", metric: "输入（缓存命中）", condition: "低谷时段" })?.price).toBe("$0.003");
    expect(find(rows, { product: "Search API" })).toMatchObject({ price: "$0.75", unit: "每千次请求" });
  });

  it("阿里云百炼：只收中国内地地域，多行表头合并成计价项", () => {
    const { rows } = prices("P07", "P07-aliyun-pricing.html");
    expect(rows.length).toBeGreaterThan(50);
    const max = rows.find((row) => row.product === "qwen3.8-max" && row.metric === "输入");
    expect(max).toMatchObject({ price: "¥12", currency: "CNY" });
    expect(max?.condition).toContain("华北2（北京）");
    expect(rows.some((row) => /新加坡|弗吉尼亚|法兰克福/.test(row.condition))).toBe(false);
    expect(rows.every((row) => !/元/.test(row.unit))).toBe(true);
  });

  it("阿里云 Coding Plan：价格和三种额度的重置规则", () => {
    const { rows } = prices("P08", "P08-aliyun-coding-plan.html");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ product: "Pro 高级套餐", price: "¥200", unit: "每月" });
    expect(rows[0]?.reset).toContain("每周额度");
  });

  it("Kimi：DocTable 里每个模型的输入、输出、缓存", () => {
    const { rows } = prices("P09", "P09-kimi-pricing.html");
    expect(rows).toHaveLength(24);
    expect(find(rows, { product: "kimi-k3.1-pro", metric: "输入" })?.price).toBe("¥13.00");
  });

  it("智谱 API 与 GLM Coding Plan", () => {
    expect(find(prices("P10", "P10-zhipu-pricing.md").rows, { product: "GLM-5.3", metric: "输入" })?.price).toBe("¥8");
    const plans = prices("P11", "P11-glm-coding-plan.md").rows;
    expect(plans.map((row) => row.price)).toEqual(["未标价", "未标价", "未标价"]);
    expect(plans[0]?.quota).toBe("5 小时积分 2,000；每周积分 10,000");
  });
});

describe("厂商动态：一条是一次发布或一条状态", () => {
  it("OpenAI 更新日志按日期倒序、只留最近 20 条", () => {
    const rows = events("N01", "N01-openai-changelog.md");
    expect(rows).toHaveLength(20);
    expect(rows[0]?.date).toBe("2026-11-05");
    expect(rows.every((row) => row.type === "release" && /^\d{4}-\d{2}-\d{2}$/.test(row.date))).toBe(true);
  });

  it("OpenAI 新闻 RSS：标题、日期、自己的链接", () => {
    const rows = events("N02", "N02-openai-news.xml");
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.every((row) => row.url.startsWith("https://openai.com/") && row.date !== "")).toBe(true);
  });

  it("OpenAI 状态：同名组件按组件 id 分开，事故单列", () => {
    const rows = events("N03", "N03-openai-status.json");
    const status = rows.filter((row) => row.type === "status");
    expect(status).toHaveLength(25);
    expect(status.filter((row) => row.title === "Login")).toHaveLength(2);
    expect(new Set(status.map((row) => row.url)).size).toBe(status.length);
    expect(rows.find((row) => row.type === "incident")?.title).toBe("Elevated error rates with some U.S. business Mastercards");
  });

  it("Claude Platform 发布说明：每个要点一条", () => {
    const rows = events("N04", "N04-claude-release-notes.md");
    expect(rows[0]).toMatchObject({ date: "2026-11-05", type: "release" });
    expect(rows[0]?.title).toContain("IP allowlist");
  });

  it("Claude Code 更新日志：版本号 + 日期 + 变更句", () => {
    const first = events("N05", "N05-claude-code-changelog.md")[0];
    expect(first).toMatchObject({ title: "Claude Code 2.1.319", date: "2026-11-06" });
    expect(first?.detail).toMatch(/^\d+ 条变更：Added support for MCP tasks/);
  });

  it("Anthropic 新闻：列表卡和精选卡都认，分类名不当摘要", () => {
    const rows = events("N06", "N06-anthropic-news.html");
    expect(rows.find((row) => row.title === "AI for Science expands to foundations and research institutions")).toMatchObject({
      date: "2026-10-28",
      url: "https://www.anthropic.com/news/ai-for-science-expands-foundations-research-institutions",
    });
    expect(rows.some((row) => /^(Announcements|Science|Product)$/.test(row.detail))).toBe(false);
  });

  it("Claude 状态页 HTML：组件 + 状态", () => {
    const rows = events("N07", "N07-claude-status.html").filter((row) => row.type === "status");
    expect(rows.map((row) => row.title)).toContain("Claude API (api.anthropic.com)");
    expect(rows.every((row) => row.detail === "正常")).toBe(true);
  });

  it("Gemini、DeepMind、DeepSeek、Kimi、智谱", () => {
    expect(events("N08", "N08-gemini-changelog.md")[0]).toMatchObject({ date: "2026-11-06", title: "Gemini Embedding 2 Preview deprecation" });
    expect(events("N09", "N09-deepmind-rss.xml").every((row) => row.url.startsWith("https://deepmind.google/"))).toBe(true);
    expect(events("N10", "N10-deepseek-updates.html").find((row) => row.title === "DeepSeek-V4.1-Flash-1017 Update")?.date).toBe("2026-10-17");
    expect(events("N11", "N11-kimi-changelog.md").find((row) => row.title === "Batch API 支持 Kimi K3.1 Pro 与 Kimi K3")?.date).toBe("2026-10");
    expect(events("N12", "N12-zhipu-releases.md").find((row) => row.title === "GLM-5.3 新一代旗舰模型上线")).toMatchObject({
      date: "2026-08-19",
      url: "https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3",
    });
  });
});

describe("排名：名次、榜上的模型名、分数、榜单日期", () => {
  it("LMArena 官方数据集", () => {
    expect(ranks("R01", "R01-lmarena.json")[0]).toMatchObject({ rank: 1, model: "Gemini 4 Carbon (High)", score: "1539", boardDate: "2026-11-06" });
  });

  it("SWE-bench Verified", () => {
    const rows = ranks("R02", "R02-swebench.html");
    expect(rows[0]).toMatchObject({ rank: 1, score: "79.2%", org: "Sonar" });
    expect(new Set(rows.map((row) => row.model)).size).toBe(rows.length);
  });

  it("Artificial Analysis Intelligence Index", () => {
    const rows = ranks("R03", "R03-artificial-analysis.html");
    expect(rows).toHaveLength(12);
    expect(rows[0]).toMatchObject({ rank: 1, model: "Gemini 4 Carbon (high)", org: "Google", score: "60" });
  });
});

describe("热榜：只要榜上的条目，每条有自己的链接", () => {
  it("GitHub Trending：页头导航不进表", () => {
    expect(fixture("H01-github-trending.html")).toContain("<nav");
    const rows = hot("H01", "H01-github-trending.html");
    expect(rows).toHaveLength(6);
    expect(rows.every((row) => /^[\w.-]+\/[\w.-]+$/.test(row.title) && row.url === `https://github.com/${row.title}`)).toBe(true);
    expect(rows[0]).toMatchObject({ rank: 1, title: "vercel-labs/agent-browser", heat: "190 stars today" });
  });

  it("Hugging Face 模型趋势", () => {
    const rows = hot("H02", "H02-hf-trending.json");
    expect(rows).toHaveLength(25);
    expect(rows[0]).toMatchObject({ title: "speridlabs/idol", url: "https://huggingface.co/speridlabs/idol" });
  });
});
