import { describe, expect, it } from "vitest";
import {
  buildQueries,
  selectHotspots,
  type HotspotCandidate,
} from "@followup/core";

const now = new Date("2026-10-27T08:00:00Z");

function candidate(partial: Partial<HotspotCandidate> & Pick<HotspotCandidate, "title" | "platforms">): HotspotCandidate {
  return {
    eventKey: partial.eventKey ?? partial.title,
    url: partial.url ?? "https://example.test/item",
    summary: partial.summary ?? "摘要",
    publishedAt: partial.publishedAt ?? "2026-10-27T06:00:00Z",
    priorAppearances: partial.priorAppearances ?? 0,
    priorSourceCount: partial.priorSourceCount ?? 0,
    priorStage: partial.priorStage ?? null,
    ...partial,
  };
}

describe("hotspot selection", () => {
  it("keeps the original keyword and caps expanded queries at 15", () => {
    expect(buildQueries({ keywords: ["本地模型"], keywordsEn: [], mustInclude: [] })).toEqual(["本地模型"]);
    const queries = buildQueries({
      keywords: ["模型", "发布"],
      keywordsEn: ["llm"],
      mustInclude: ["OpenAI", "DeepSeek", "Anthropic", "Google", "Meta", "Mistral"],
    });
    expect(queries).toContain("模型");
    expect(queries).toContain("llm");
    expect(queries.length).toBeLessThanOrEqual(15);
  });

  it("scores a new single-source event as 爆发 and drops noise", () => {
    const selected = selectHotspots({
      now,
      timeWindow: "1d",
      itemCount: 6,
      mustInclude: ["OpenAI"],
      exclude: ["广告"],
      reported: [],
      mode: "hotspot",
      candidates: [
        candidate({ title: "OpenAI 发布", platforms: ["gov-policy search"] }),
        candidate({ title: "转载广告", platforms: ["gov-policy search"], summary: "广告" }),
        candidate({ title: "社区闲聊", platforms: ["bilibili search"] }),
      ],
    });
    expect(selected.events.map((event) => event.title)).toEqual(["OpenAI 发布"]);
    expect(selected.events[0]).toMatchObject({ score: 67, stage: "爆发" });
    expect(selected.windowLabel).toBe("最近 24 小时");
  });

  it("widens to 7 days when the last day is short, and marks a shrinking event as 衰退", () => {
    const widened = selectHotspots({
      now,
      timeWindow: "7d",
      itemCount: 6,
      mustInclude: [],
      exclude: [],
      reported: [],
      mode: "hotspot",
      candidates: [candidate({ title: "三天前的事", publishedAt: "2026-10-25T08:00:00Z", platforms: ["alpha search"] })],
    });
    expect(widened.windowLabel).toBe("最近 7 天");
    expect(widened.events[0]?.stage).toBe("爆发");

    const faded = selectHotspots({
      now,
      timeWindow: "1d",
      itemCount: 6,
      mustInclude: [],
      exclude: [],
      reported: [{ eventKey: "同一件事", stage: "高峰" }],
      mode: "hotspot",
      candidates: [candidate({
        title: "同一件事",
        eventKey: "同一件事",
        platforms: ["alpha search"],
        priorAppearances: 1,
        priorSourceCount: 2,
        priorStage: "高峰",
      })],
    });
    expect(faded.events[0]?.stage).toBe("衰退");
  });

  it("skips an unchanged event in the daily selection", () => {
    const daily = selectHotspots({
      now,
      timeWindow: "1d",
      itemCount: 6,
      mustInclude: [],
      exclude: [],
      reported: [{ eventKey: "同一件事", stage: "爆发" }],
      mode: "daily",
      candidates: [candidate({ title: "同一件事", eventKey: "同一件事", platforms: ["alpha search"] })],
    });
    expect(daily.quiet).toBe(true);
    expect(daily.events).toEqual([]);
  });

  it("keeps the source link on a selected hotspot", () => {
    const hot = selectHotspots({
      now,
      timeWindow: "1d",
      itemCount: 6,
      mustInclude: [],
      exclude: [],
      reported: [],
      mode: "hotspot",
      candidates: [candidate({ title: "只看到这一件", platforms: ["alpha search"], url: "https://example.test/only" })],
    });
    expect(hot.events[0]).toMatchObject({ url: "https://example.test/only", stage: "爆发" });
  });
});
