import { describe, expect, it } from "vitest";
import { fallbackDigest, renderDigest } from "@followup/core";

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
});
