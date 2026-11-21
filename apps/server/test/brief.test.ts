import { afterEach, describe, expect, it } from "vitest";
import { llmBrief } from "../src/ledger/brief.js";
import type { AppDeps } from "../src/types.js";

const KEY = "OPENAI_API_KEY";

afterEach(() => {
  delete process.env[KEY];
});

describe("搜索概括", () => {
  it("没有密钥时用规则概括，不请求模型", async () => {
    delete process.env[KEY];
    let called = false;
    const deps = { dataDir: "", now: () => new Date(), kaggle: null, fetchImpl: (async () => { called = true; return new Response(""); }) as typeof fetch } satisfies AppDeps;
    const brief = await llmBrief(deps, "flash", [{ sourceId: "P06", title: "deepseek-flash", excerpt: "输入 $0.14" }]);
    expect(brief.mode).toBe("rule");
    expect(brief.text).toContain("$0.14");
    expect(called).toBe(false);
  });

  it("模型写出的价格不在原文里就丢掉那一句", async () => {
    process.env[KEY] = "test-only";
    const deps = {
      dataDir: "",
      now: () => new Date(),
      kaggle: null,
      fetchImpl: (async () => new Response(JSON.stringify({ choices: [{ message: { content: "Plus 是 $20。另一个是 $99。" } }] }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch,
    } satisfies AppDeps;
    const brief = await llmBrief(deps, "Plus", [{ sourceId: "P02", title: "Plus", excerpt: "price=\"$20\"" }]);
    expect(brief.mode).toBe("llm");
    expect(brief.text).toContain("$20");
    expect(brief.text).not.toContain("$99");
  });
});
