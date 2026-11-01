import { describe, expect, it, vi } from "vitest";
import { WorkerClient } from "../src/opencli/worker-client.js";
import { managedRunner } from "../src/opencli/managed-runner.js";

const entry = new URL("./fixtures/opencli-worker.mjs", import.meta.url);
const search = (keyword: string) => ({ operation: "search" as const, command: "fixture search", keyword });
interface Probe { pid: number; hasModelKey: boolean; hasDatabaseSecret: boolean; calls: number }

describe("collector process", () => {
  it("reuses a process and strips the model secret from its environment", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-secret-never-forwarded");
    vi.stubEnv("DATABASE_URL", "test-database-secret");
    const worker = new WorkerClient(entry);
    try {
      const first = await worker.request<Probe>(search("first"), 5_000);
      const next = await worker.request<Probe>(search("next"), 5_000);
      expect(next.pid).toBe(first.pid);
      expect(first.hasModelKey).toBe(false);
      expect(first.hasDatabaseSecret).toBe(false);
    } finally { worker.close(); vi.unstubAllEnvs(); }
  });

  it("kills a hung process without replaying the request and restarts for the next one", async () => {
    const worker = new WorkerClient(entry);
    try {
      const first = await worker.request<Probe>(search("warm"), 5_000);
      await expect(worker.request(search("hang"), 100)).rejects.toThrow("超时");
      const next = await worker.request<Probe>(search("next"), 5_000);
      expect(next.pid).not.toBe(first.pid);
    } finally { worker.close(); }
  });

  it("expires queued work before dispatch without cancelling another active request", async () => {
    const worker = new WorkerClient(entry);
    try {
      await worker.request(search("warm"), 5_000);
      const active = worker.request<Probe>(search("delay"), 1_000);
      await expect(worker.request(search("expired"), 50)).rejects.toThrow("排队超时");
      expect((await active).calls).toBe(2);
      const next = await worker.request<Probe>(search("next"), 5_000);
      expect(next.calls).toBe(3);
    } finally { worker.close(); }
  });

  it("recovers after an active or idle exit and rejects work after shutdown", async () => {
    const worker = new WorkerClient(entry);
    try {
      await expect(worker.request(search("crash"), 5_000)).rejects.toThrow("意外退出");
      const before = await worker.request<Probe>(search("idle-exit"), 5_000);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const after = await worker.request<Probe>(search("next"), 5_000);
      expect(after.pid).not.toBe(before.pid);
      worker.close();
      await expect(worker.request(search("next"), 5_000)).rejects.toThrow("关闭");
    } finally { worker.close(); }
  });

  it("loads the pinned project dependency without a global OpenCLI executable", async () => {
    vi.stubEnv("PATH", process.platform === "win32" ? `${process.env.SYSTEMROOT}\\System32` : "/usr/bin:/bin");
    const runner = managedRunner();
    try {
      const catalog = await runner.catalog!();
      expect(catalog.find((entry) => entry.command === "arxiv search")?.help.columns).toContain("title");
      expect(catalog.every((entry) => entry.help.access === "read")).toBe(true);
      const denied = await runner.run(["opencli", "github", "delete", "x", "-f", "json"], 5_000);
      expect(denied.code).toBe(1);
    } finally { runner.close(); vi.unstubAllEnvs(); }
  }, 20_000);

  it("keeps the collector alive when a separate login process times out", async () => {
    const runner = managedRunner(entry);
    const run = (keyword: string) => runner.run(["opencli", "fixture", "search", keyword, "-f", "json"], 5_000);
    try {
      const first = JSON.parse((await run("warm")).stdout) as { data: Probe };
      const login = runner.run(["opencli", "auth", "status", "--site", "hang", "-f", "json"], 1_000);
      const next = JSON.parse((await run("next")).stdout) as { data: Probe };
      expect(next.data.pid).toBe(first.data.pid);
      expect((await login).code).toBe(1);
      const last = JSON.parse((await run("last")).stdout) as { data: Probe };
      expect(last.data.pid).toBe(first.data.pid);
    } finally { runner.close(); }
  });

  it("runs two searches at once on separate processes", async () => {
    const runner = managedRunner(entry);
    const run = (keyword: string) => runner.run(["opencli", "fixture", "search", keyword, "-f", "json"], 5_000);
    try {
      const [left, right] = await Promise.all([run("delay"), run("delay")]);
      const first = JSON.parse(left.stdout) as { data: Probe };
      const second = JSON.parse(right.stdout) as { data: Probe };
      expect(first.data.pid).not.toBe(second.data.pid);
    } finally { runner.close(); }
  });
});
