import { describe, expect, it } from "vitest";
import { diffRows, extractEvents, extractPrices, extractRanks, pathAllowed } from "../src/ledger.js";

describe("ledger", () => {
  it("reads a price line and leaves missing quota empty", () => {
    const rows = extractPrices("GPT-4o | input | $2.50 / 1M tokens", "api");
    expect(rows[0]).toMatchObject({ product: "GPT-4o", metric: "input", price: "$2.50", unit: "每百万 token", quota: "" });
  });

  it("reads rank lines", () => {
    const rows = extractRanks("1 Claude Opus 1509\n2 Gemini 1480");
    expect(rows.map((row) => row.model)).toEqual(["Claude Opus", "Gemini"]);
  });

  it("marks a mainland access sentence", () => {
    const rows = extractEvents("说明：中国大陆用户目前无法注册 API。", "news");
    expect(rows[0]?.type).toBe("cn_access");
  });

  it("obeys a star disallow", () => {
    expect(pathAllowed("User-agent: *\nDisallow: /private", "/private/price")).toBe(false);
    expect(pathAllowed("User-agent: *\nDisallow: /private\nAllow: /private/ok", "/private/ok")).toBe(true);
  });

  it("diffs a changed price and a dropped row", () => {
    const diffs = diffRows(
      [{ key: "a", fields: { price: "$1" } }, { key: "b", fields: { price: "$2" } }],
      [{ key: "a", fields: { price: "$3" } }],
    );
    expect(diffs).toEqual([
      { key: "a", field: "price", oldValue: "$1", newValue: "$3" },
      { key: "b", field: "row", oldValue: "在榜", newValue: "掉出" },
    ]);
  });
});
