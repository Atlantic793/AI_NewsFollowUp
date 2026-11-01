import { describe, expect, it } from "vitest";
import {
  buildQueries,
  takeToOpen,
  topicDrop,
  screenByWindow,
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
    expect(queries).toContain("模型 OpenAI");
    expect(queries).toContain("llm OpenAI");
    expect(queries).not.toContain("模型");
    expect(queries).not.toContain("llm");
    expect(queries).not.toContain("OpenAI");
    expect(queries).not.toContain("DeepSeek");
    expect(queries).not.toContain("Mistral");
    expect(queries).not.toContain("模型 模型");
    expect(queries.length).toBeLessThanOrEqual(15);
  });

  it("scores a new single-source event as 爆发 and drops noise", () => {
    const selected = selectHotspots({
      now,
      timeWindow: 1,
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
    expect(selected.windowLabel).toBe("过去 1 天");
  });

  it("keeps the whole day count and does not shrink seven days to 24 hours", () => {
    const fresh = Array.from({ length: 6 }, (_, index) => candidate({
      title: `今天的事${index}`,
      eventKey: `今天${index}`,
      platforms: ["alpha search"],
    }));
    const older = candidate({
      title: "三天前的事",
      platforms: ["alpha search", "beta search", "gamma search", "delta search"],
      publishedAt: "2026-10-24T08:00:00Z",
    });
    const week = selectHotspots({
      now,
      timeWindow: 7,
      itemCount: 6,
      mustInclude: [],
      exclude: [],
      reported: [],
      mode: "hotspot",
      candidates: [...fresh, older],
    });
    expect(week.windowLabel).toBe("过去 7 天");
    expect(week.events.map((event) => event.title)).toContain("三天前的事");
    expect(week.events.find((event) => event.title === "三天前的事")?.stage).toBe("爆发");

    const day = selectHotspots({
      now,
      timeWindow: 1,
      itemCount: 6,
      mustInclude: [],
      exclude: [],
      reported: [],
      mode: "hotspot",
      candidates: [...fresh, older],
    });
    expect(day.windowLabel).toBe("过去 1 天");
    expect(day.events.map((event) => event.title)).not.toContain("三天前的事");

    const faded = selectHotspots({
      now,
      timeWindow: 1,
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
      timeWindow: 1,
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
      timeWindow: 1,
      itemCount: 6,
      mustInclude: [],
      exclude: [],
      reported: [],
      mode: "hotspot",
      candidates: [candidate({ title: "只看到这一件", platforms: ["alpha search"], url: "https://example.test/only" })],
    });
    expect(hot.events[0]).toMatchObject({ url: "https://example.test/only", stage: "爆发" });
  });

  it("drops undated, stale, excluded, and off-topic items before a brief", () => {
    const screened = screenByWindow({
      now,
      days: 7,
      keywords: ["模型"],
      mustInclude: ["OpenAI"],
      exclude: ["广告"],
      items: [
        { title: "OpenAI 发布", summary: "新模型", publishedAt: "2026-10-27T06:00:00Z" },
        { title: "本地模型", summary: "一周内", publishedAt: "2026-10-22T08:00:00Z" },
        { title: "模型广告", summary: "推广", publishedAt: "2026-10-27T06:00:00Z" },
        { title: "没有日子", summary: "模型", publishedAt: "" },
        { title: "太早的模型", summary: "OpenAI", publishedAt: "2026-10-01T08:00:00Z" },
        { title: "跑题", summary: "别的行业", publishedAt: "2026-10-27T06:00:00Z" },
      ],
    });
    expect(screened.kept.map((item) => item.title)).toEqual(["OpenAI 发布"]);
    expect(screened.marked.map((row) => row.drop ?? null)).toEqual([
      null,
      "和主题对不上",
      "和主题对不上",
      "没有日期",
      "过了时间窗",
      "和主题对不上",
    ]);
    expect(screened.counts).toEqual({ outside: 1, noDate: 1, offTopic: 3 });

    const open = screenByWindow({
      now,
      days: 7,
      keywords: [],
      mustInclude: [],
      exclude: [],
      items: [{ title: "什么都没写", summary: "也没有词", publishedAt: "2026-10-27T06:00:00Z" }],
    });
    expect(open.kept).toHaveLength(1);
  });

  it("keeps a plain title when the body matches and drops a headline that the body does not support", () => {
    expect(topicDrop({
      title: "今天的消息",
      summary: "短讯",
      body: "正文讨论本地模型怎么部署",
      keywords: ["本地模型"],
      mustInclude: [],
      exclude: [],
    })).toBeNull();
    expect(topicDrop({
      title: "本地模型震惊",
      summary: "本地模型",
      body: "全文是天气预报",
      keywords: ["本地模型"],
      mustInclude: [],
      exclude: [],
    })).toBe("和主题对不上");
    expect(topicDrop({
      title: "本地模型",
      summary: "",
      body: "",
      keywords: ["本地模型"],
      mustInclude: [],
      exclude: [],
    })).toBeNull();
    expect(topicDrop({
      title: "饭圈争论",
      summary: "",
      body: "全文都在骂樊振东",
      keywords: ["樊振东", "世界排名", "交手记录"],
      mustInclude: ["樊振东"],
      exclude: [],
    })).toBe("和主题对不上");
    expect(topicDrop({
      title: "排名更新",
      summary: "",
      body: "樊振东世界排名升到第一",
      keywords: ["樊振东", "世界排名", "交手记录"],
      mustInclude: ["樊振东"],
      exclude: [],
    })).toBeNull();
    expect(takeToOpen([1, 2, 3], 2)).toEqual({ open: [1, 2], held: [3] });
  });
});
