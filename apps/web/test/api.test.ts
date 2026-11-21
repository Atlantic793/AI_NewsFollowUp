import { afterEach, describe, expect, it, vi } from "vitest";
import { request } from "../src/api";

afterEach(() => vi.unstubAllGlobals());

describe("页面请求失败时保留可读的错误", () => {
  it("网络断开时提示连接问题", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(request("/api/ledger/watch")).rejects.toThrow("无法连接服务器");
  });

  it("非 JSON 的服务器错误不会变成 JSON 解析异常", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Bad gateway", { status: 502 })));
    await expect(request("/api/ledger/watch")).rejects.toThrow("请求没有完成。");
  });

  it("保留接口错误文案，并拒绝损坏的成功响应", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ error: { message: "这一轮还没结束。" } }, { status: 409 })).mockResolvedValueOnce(new Response("not-json")));
    await expect(request("/api/ledger/run")).rejects.toThrow("这一轮还没结束。");
    await expect(request("/api/ledger/home")).rejects.toThrow("服务器没有返回可用数据");
  });
});
