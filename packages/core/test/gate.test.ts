import { describe, expect, it } from "vitest";
import { applyPriceGaps, eventBriefOf, hotBriefOf } from "../src/llm/apply.js";
import { capabilitySentence, hubBlurb, kaggleCompetitions } from "../src/parsers/hot.js";
import { hotPurpose } from "../src/zh.js";
import { gatePriceDrafts, gateRankDrafts, isLoginWall } from "../src/llm/gate.js";
import { cnyLabel } from "../src/money.js";
import { introText, showIntro, shownText } from "../src/zh.js";
import type { PriceDraft, PriceRow, RankDraft } from "../src/rows.js";

const price = (input: Partial<PriceDraft>): PriceDraft => ({
  kind: "api", product: "deepseek-chat", tier: "标准", metric: "输入", condition: "", price: "$20", unit: "每百万 token", quota: "", reset: "", excerpt: "deepseek-chat 输入 $20", ...input,
});

describe("模型候选核对", () => {
  const body = "价目 deepseek-chat 输入 $20 / 1M tokens。另一行 $8。排名模型甲 91.2 第 3 名。";

  it("片段里有 $20 就留下，只有 $99 就丢掉", () => {
    const kept = gatePriceDrafts(body, [price({ excerpt: "deepseek-chat 输入 $20 / 1M tokens" })]);
    const dropped = gatePriceDrafts(body, [price({ price: "$99", excerpt: "deepseek-chat 输入 $20" })]);
    expect(kept.drafts).toHaveLength(1);
    expect(dropped.drafts).toHaveLength(0);
    expect(dropped.dropped[0]?.reason).toBe("金额或数字不在片段里");
  });

  it("同一片段里有两个价格就整条丢掉", () => {
    const result = gatePriceDrafts(body, [price({ excerpt: "deepseek-chat 输入 $20 / 1M tokens。另一行 $8。" })]);
    expect(result.drafts).toHaveLength(0);
  });

  it("原文没有印出名次时改为按分数排序，并清掉没有出处的日期", () => {
    const draft: RankDraft = { rank: "3", model: "甲", org: "", score: "91.2", votes: "", boardDate: "2020-01-01", basis: "printed", excerpt: "排名模型甲 91.2" };
    const result = gateRankDrafts(body, [draft]);
    expect(result.drafts[0]).toMatchObject({ basis: "sorted", boardDate: "" });
  });

  it("短登录页不当成正文", () => {
    expect(isLoginWall("<html>Sign in</html>")).toBe(true);
    expect(isLoginWall(`${"正文".repeat(500)} Sign in`)).toBe(false);
  });
});

describe("人民币和中文", () => {
  it("美元按 7.2 换算，免费和未标价保持原词", () => {
    expect(cnyLabel("$20", 20, "USD")).toBe("¥144");
    expect(cnyLabel("$0.006", 0.006, "USD")).toBe("¥0.0432");
    expect(cnyLabel("免费", 0, "USD")).toBe("免费");
    expect(cnyLabel("未标价", null, "")).toBe("未标价");
    expect(cnyLabel("¥12", 12, "CNY")).toBe("¥12");
  });

  it("介绍性英文能对上的换成中文，对不上就留空", () => {
    expect(introText("operational")).toBe("正常");
    expect(introText("cache hit")).toBe("缓存命中");
    expect(introText("这是中文说明")).toBe("这是中文说明");
    expect(introText("两小时训出模型。Train your own model from scratch.")).toBe("两小时训出模型。");
    expect(introText("Flagship models · 短上下文 ≤272K")).toBe("旗舰模型，短上下文 ≤272K");
    expect(introText("Multimodal models · Image")).toBe("多模态模型，图像");
    expect(introText("through November 30, 2026")).toBe("截至 2026年11月30日");
    expect(introText("prompts <= 200k tokens")).toBe("提示词不超过 200k token");
    expect(introText("128K<Token≤256K · 华北2（北京）")).toBe("128K<token≤256K，华北2（北京）");
    expect(introText("Specialized models · Search")).toBe("专用模型，搜索");
    expect(introText("<272K context length")).toBe("<272K 上下文长度");
    expect(introText("142 条变更：Added sign-in to the organization console")).toBe("142 条变更");
    expect(introText("热度 1,622 stars today")).toBe("热度 1,622 今日星标");
    expect(introText("A completely unrelated english sentence about weather")).toBe("");
  });
});

describe("补空和概括", () => {
  const row = (priceText: string): PriceRow => ({
    kind: "api", product: "Plus", tier: "订阅", metric: "订阅价", condition: "", price: priceText, amount: 10, currency: "USD", unit: "每月", quota: "", reset: "", excerpt: "Plus $10", brief: "",
  });

  it("已有价格时，模型返回的另一价格不会写进行", () => {
    const body = "Plus 套餐每月 100 万 token，每 5 小时重置。标价 $10。";
    const result = applyPriceGaps(body, [row("$10")], [{ product: "Plus", quota: "100 万 token", reset: "每 5 小时", condition: "", excerpt: "Plus 套餐每月 100 万 token，每 5 小时重置。" }]);
    expect(result.rows[0]?.price).toBe("$10");
    expect(result.rows[0]?.quota).toBe("100 万 token");
    expect(result.rows[0]?.reset).toBe("每 5 小时");
    expect(result.rows[0]?.excerpt).toContain("100 万 token");
  });

  it("英文说明太长时改用中文句，美元金额旁注人民币", () => {
    expect(showIntro("Added sign-in for organizations and several other features", "已支持组织登录", true)).toBe("已支持组织登录");
    expect(shownText("每股83.00美元")).toBe("每股83.00美元（约¥597.6）");
    expect(shownText("热度 1,622 stars today")).toBe("热度 1,622 个今日星标");
  });

  it("概括里的数字对不上片段时留空", () => {
    expect(eventBriefOf({ excerpt: "发布说明没有价格", detail: "released" }, "售价 $99")).toBe("");
    expect(eventBriefOf({ excerpt: "售价 $20", detail: "released" }, "售价 $20，已经上线")).toBe("售价 $20，已经上线");
  });

  it("热榜中文介绍直接使用，英文介绍交给模型，数字对不上就丢掉", () => {
    expect(hotPurpose("两小时从 0 训出你的 64M 大模型")).toBe("两小时从 0 训出你的 64M 大模型");
    expect(hotPurpose("Browser automation CLI for AI agents")).toBe("");
    expect(introText("Read our How to Run Inkling-2-Mini Guide")).toBe("");
    expect(hotBriefOf({ summary: "A single image to a 3D Gaussian splat.", excerpt: "A single image to a 3D Gaussian splat." }, "一张图生成三维高斯点云")).toBe("一张图生成三维高斯点云");
    expect(hotBriefOf({ summary: "没有写价格", excerpt: "没有写价格" }, "售价 $99")).toBe("");
    expect(hotBriefOf({ summary: "image-to-video", excerpt: "image-to-video" }, "图像-to-视频")).toBe("");
  });

  it("模型卡取第一段介绍，竞赛介绍去掉 HTML", () => {
    const markdown = "---\nlicense: apache-2.0\n---\n\n# Idol\n\n<p><b>A single image to a 3D Gaussian splat.</b><br>One picture in, a 3D model out.</p>\n";
    expect(hubBlurb(markdown)).toBe("A single image to a 3D Gaussian splat. One picture in, a 3D model out.");
    const linked = "---\nlicense: apache-2.0\n---\n\nPlayground | Tinker Cookbook | Paper\n\nInkling is a small model that writes and runs short programs.\n";
    expect(hubBlurb(linked)).toBe("Inkling is a small model that writes and runs short programs.");
    expect(capabilitySentence("image-to-video · text-to-video")).toBe("能按图片生成视频，也能按文字生成视频。");
    const rows = kaggleCompetitions(JSON.stringify([{ title: "预测生存", url: "https://www.kaggle.com/competitions/titanic", description: "<p>根据乘客信息预测谁能生还。</p>", reward: "Knowledge", teamCount: 3, deadline: "2030-01-01T00:00:00Z", category: "Getting Started" }]));
    expect(rows[0]).toMatchObject({ title: "预测生存", summary: "根据乘客信息预测谁能生还。", heat: "Knowledge · 3 队 · 截止 2030-01-01" });
  });
});
