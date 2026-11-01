import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  applyGroups,
  catchupNominalDate,
  dateInText,
  dedupeByUrl,
  isInsideFolder,
  validatePlan,
  zonedParts,
} from "@followup/core";

const TZ = "Asia/Shanghai";

describe("url dedupe and groups", () => {
  it("keeps the first item when urls are exactly equal after trim and NFC", () => {
    const first = { id: "1", url: " https://example.test/a\u0301 " };
    const second = { id: "2", url: "https://example.test/\u00e1" };
    expect(dedupeByUrl([first, second]).map((entry) => entry.id)).toEqual(["1"]);
  });

  it("turns three same-group items into one event and two titles into two events", () => {
    const merged = applyGroups(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      [["a", "b", "c"]],
    );
    expect(merged.degraded).toBe(false);
    expect(new Set(merged.assignments.map((row) => row.eventKey)).size).toBe(1);

    const split = applyGroups(
      [
        { id: "a", title: "本地模型发布" },
        { id: "b", title: "城市马拉松改道" },
      ],
      [["a"], ["b"]],
    );
    expect(new Set(split.assignments.map((row) => row.eventKey)).size).toBe(2);
  });

  it("falls back to one item per event when a group id is missing", () => {
    const result = applyGroups([{ id: "a" }, { id: "b" }], [["a"]]);
    expect(result.degraded).toBe(true);
    expect(new Set(result.assignments.map((row) => row.eventKey)).size).toBe(2);
  });
});

describe("schedule and plan guards", () => {
  it("catches up only the latest due nominal date", () => {
    const morning = new Date("2026-10-28T09:00:00+08:00");
    expect(catchupNominalDate(morning, "08:00", [], TZ)).toBe("2026-10-28");
    const beforeSlot = new Date("2026-10-28T07:00:00+08:00");
    expect(catchupNominalDate(beforeSlot, "08:00", [], TZ)).toBe("2026-10-27");
    const early = new Date("2026-10-28T07:40:00+08:00");
    expect(catchupNominalDate(early, "08:00", [], TZ)).toBe("2026-10-28");
    expect(catchupNominalDate(early, "08:00", ["2026-10-28"], TZ)).toBeNull();
    expect(catchupNominalDate(morning, "08:00", ["2026-10-28"], TZ)).toBeNull();
  });

  it("rejects an empty plan and accepts a trimmed one", () => {
    expect(validatePlan({ keywords: ["  "], platforms: [] }, new Set(["alpha search"]))).toEqual({
      ok: false,
    });
    expect(
      validatePlan(
        { keywords: [" 本地模型 ", "本地模型"], platforms: ["alpha search"] },
        new Set(["alpha search"]),
      ),
    ).toEqual({ ok: true, keywords: ["本地模型"], platforms: ["alpha search"] });
  });

  it("rejects paths that escape the topic folder", () => {
    expect(isInsideFolder("D:\\topics\\a", "笔记\\one.md")).toBe(true);
    expect(isInsideFolder("D:\\topics\\a", "..\\secret.txt")).toBe(false);
    expect(isInsideFolder("D:\\topics\\a", "D:\\other\\file.txt")).toBe(false);
  });

  it("formats zoned parts and calendar addition", () => {
    expect(zonedParts(new Date("2026-10-26T01:05:00Z"), TZ)).toEqual({
      date: "2026-10-26",
      hm: "09:05",
    });
    expect(addCalendarDays("2026-10-26", -1)).toBe("2026-10-25");
  });
});

describe("dates written in titles", () => {
  const now = new Date("2026-11-01T08:00:00+08:00");

  it("reads a Chinese clock time and leaves a bare year alone", () => {
    const found = dateInText("新浪斯诺克热点小时报 | 2026年11月01日16时", now);
    expect(found).toBeTruthy();
    expect(new Date(found ?? "").getFullYear()).toBe(2026);
    expect(new Date(found ?? "").getMonth()).toBe(10);
    expect(new Date(found ?? "").getDate()).toBe(1);
    expect(new Date(found ?? "").getHours()).toBe(16);
    expect(dateInText("WTT Series 2024 - Wikipedia", now)).toBeNull();
    expect(dateInText("2 hours ago", now)).toBe(new Date(now.getTime() - 2 * 3_600_000).toISOString());
  });
});
