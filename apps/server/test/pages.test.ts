import { describe, expect, it } from "vitest";
import { readPages } from "../src/jobs/pages.js";
import type { AppDeps } from "../src/types.js";

describe("page reading", () => {
  it("opens several pages at once", async () => {
    const previous = process.env.FIRECRAWL_API_KEY;
    delete process.env.FIRECRAWL_API_KEY;
    let active = 0;
    let peak = 0;
    const deps = {
      fetchImpl: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 40));
        active -= 1;
        return new Response("正文", { status: 200, headers: { "content-type": "text/html" } });
      },
    } as AppDeps;
    try {
      const pages = await readPages(deps, ["https://a.example/1", "https://a.example/2", "https://a.example/3", "https://a.example/4"]);
      expect(pages.size).toBe(4);
      expect(peak).toBeGreaterThan(1);
    } finally {
      if (previous === undefined) delete process.env.FIRECRAWL_API_KEY;
      else process.env.FIRECRAWL_API_KEY = previous;
    }
  });
});