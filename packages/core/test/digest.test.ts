import { describe, expect, it } from "vitest";
import { composeDigestLead, fallbackDigest, formatWindowLead, renderDigest } from "@followup/core";

describe("digest brief", () => {
  it("uses the search snippet when a written summary is unavailable", () => {
    const brief = fallbackDigest({
      name: "大模型",
      sources: [{ title: "WizardLM", url: "https://arxiv.org/abs/2304.12244", summary: "让大模型跟着复杂指令走。", platform: "arxiv search" }],
    });
    const text = renderDigest({ name: "大模型", date: "2026-10-28", brief });
    expect(text).toContain("让大模型跟着复杂指令走。");
    expect(text).toContain("为何关注：");
    expect(text).toContain("[原文](https://arxiv.org/abs/2304.12244)");
    expect(text).toContain("【跟进建议】");
  });

  it("puts the count sentence first and skips reasons that are zero", () => {
    const lead = formatWindowLead(7, 3, { outside: 8, noDate: 2, offTopic: 2 });
    expect(lead).toBe("过去 7 天留下 3 条。丢掉 12 条：过了时间窗 8，没有日期 2，和主题对不上 2。");
    expect(formatWindowLead(7, 3, { outside: 0, noDate: 0, offTopic: 0 })).toBe("过去 7 天留下 3 条。");
    expect(formatWindowLead(1, 0, { outside: 0, noDate: 2, offTopic: 0 })).toBe("过去 1 天留下 0 条。丢掉 2 条：没有日期 2。");
    expect(composeDigestLead(lead, "这几天主要是发布。")).toBe(`${lead}这几天主要是发布。`);
    expect(composeDigestLead(lead, "  ")).toBe(lead);
  });
});
