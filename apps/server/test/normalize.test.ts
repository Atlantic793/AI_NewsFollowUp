import { describe, expect, it } from "vitest";
import { genericNormalize, genericSupports, keywordArg, needsLogin } from "../src/opencli/normalize.js";

describe("search normalization", () => {
  it("accepts a web result that has a snippet but no publish time", () => {
    const help = {
      positionals: [{ name: "keyword", required: true }],
      command_options: [{ name: "limit", required: false, default: 10 }],
      columns: ["title", "url", "snippet"],
    };
    expect(keywordArg(help)).toBe("keyword");
    expect(genericSupports(help)).toBe(true);
    expect(genericNormalize({
      items: [{ title: "OpenAI 公告", url: "https://openai.com/index/gpt", snippet: "更快的办公模型，价格约为前代一半。" }],
    }, "google search")).toEqual([
      {
        title: "OpenAI 公告",
        url: "https://openai.com/index/gpt",
        platform: "google search",
        publishedAt: "",
        summary: "更快的办公模型，价格约为前代一半。",
      },
    ]);
  });

  it("keeps a paper by turning authors and category into the summary line", () => {
    const items = genericNormalize([{
      title: "WizardLM",
      url: "https://arxiv.org/abs/2304.12244",
      authors: "Can Xu",
      published: "2023-04-24",
      primary_category: "cs.CL",
    }], "arxiv search");
    expect(items[0]?.summary).toBe("Can Xu · cs.CL");
    expect(items[0]?.publishedAt.startsWith("2023-04-24")).toBe(true);
  });

  it("accepts a single optional keyword", () => {
    expect(keywordArg({
      positionals: [{ name: "query", required: false }],
      command_options: [{ name: "city", required: false, default: "北京" }],
      columns: ["name", "url"],
    })).toBe("query");
  });

  it("leaves login-only commands out", () => {
    expect(needsLogin("一亩三分地 站内关键字搜索（需要登录）")).toBe(true);
    expect(needsLogin("Search Google")).toBe(false);
  });
});
