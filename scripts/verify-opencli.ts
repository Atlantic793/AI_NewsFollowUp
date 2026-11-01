import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createApp } from "../apps/server/src/app.js";
import { managedRunner } from "../apps/server/src/opencli/managed-runner.js";
import { genericNormalize } from "../apps/server/src/opencli/normalize.js";
import { readEnvelope } from "../apps/server/src/opencli/parse.js";
import type { AppDeps } from "../apps/server/src/types.js";

// 所有主题和缓存使用临时目录；只在 --online 时搜索一次公开 npm 注册表。
const root = await mkdtemp(path.join(os.tmpdir(), "followup-opencli-verify-"));
process.env.PATH = process.platform === "win32" ? `${process.env.SYSTEMROOT}\\System32` : "/usr/bin:/bin";
const runner = managedRunner();
const deps: AppDeps = {
  dataDir: path.join(root, "data"), topicsRoot: path.join(root, "topics"), runner,
  model: { available: false, complete: async () => { throw new Error("验证不调用模型"); } },
  now: () => new Date(), timeZone: "Asia/Shanghai", recipes: [], fetchImpl: fetch,
  openFolder: async () => {}, pickFolder: async () => null,
};
const report: Record<string, unknown> = { root, node: process.version, executablePath: "system directories only; global OpenCLI is unavailable" };
const app = createApp(deps);
async function timedCatalog() {
  const start = performance.now();
  const response = await app.request("/api/catalog");
  assert.equal(response.status, 200);
  const body = await response.json() as { commands: { command: string; selectable: boolean }[]; loginChecking: boolean };
  return { ms: +(performance.now() - start).toFixed(2), ...body };
}
try {
  const cold = await timedCatalog();
  assert(cold.commands.some((entry) => entry.command === "npm search" && entry.selectable));
  const warm = await timedCatalog();
  assert.deepEqual(warm.commands.map((entry) => entry.command), cold.commands.map((entry) => entry.command));
  const start = performance.now();
  const concurrent = await Promise.all(Array.from({ length: 10 }, timedCatalog));
  report.directory = { coldMs: cold.ms, warmMs: warm.ms, concurrent10Ms: +(performance.now() - start).toFixed(2), commands: cold.commands.length, selectable: cold.commands.filter((entry) => entry.selectable).length, concurrentAllSucceeded: concurrent.length === 10 };
  const loginStart = performance.now();
  const login = await runner.run(["opencli", "auth", "status", "--site", "bilibili", "-f", "json"], 3_500);
  report.login = { ms: +(performance.now() - loginStart).toFixed(2), returned: true, code: login.code };
  const refreshStart = performance.now();
  const refreshes = await Promise.all(Array.from({ length: 3 }, () => app.request("/api/catalog/refresh", { method: "POST" })));
  assert(refreshes.every((response) => response.status === 200));
  report.refresh = { concurrent3Ms: +(performance.now() - refreshStart).toFixed(2), allSucceeded: true };
  if (process.argv.includes("--online")) {
    const searchStart = performance.now();
    const result = await runner.run(["opencli", "npm", "search", "typescript", "-f", "json"], 30_000);
    const envelope = readEnvelope(result.stdout);
    assert(envelope.ok, envelope.ok ? "" : envelope.message);
    const normalized = genericNormalize(envelope.data, "npm search");
    assert(normalized.length > 0);
    report.publicSearch = { ms: +(performance.now() - searchStart).toFixed(2), items: normalized.length, validUrls: normalized.every((item) => /^https:\/\//.test(item.url)) };
    const create = await app.request("/api/topics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ utterance: "OpenCLI 集成验证" }) });
    const created = await create.json() as { topic: { id: string; folderPath: string } };
    const url = `/api/topics/${created.topic.id}`;
    const confirm = await app.request(`${url}/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ keywords: ["typescript"], platforms: ["npm search"] }) });
    assert.equal(confirm.status, 200);
    const started = await app.request(`${url}/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"kind":"research"}' });
    assert.equal(started.status, 200);
    let job: { state: string; error?: string; snapshotId?: string } | undefined;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const response = await app.request(`${url}/jobs/current`);
      job = (await response.json() as { job: typeof job }).job;
      if (job?.state !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.equal(job?.state, "succeeded", job?.error);
    const snapshot = JSON.parse(await readFile(path.join(created.topic.folderPath, "快照", `${job?.snapshotId}.json`), "utf8")) as { items: unknown[]; platforms: { status: string }[] };
    assert(snapshot.items.length > 0);
    assert(snapshot.platforms.every((platform) => platform.status === "success"));
    report.research = { succeeded: true, items: snapshot.items.length, snapshotId: job?.snapshotId, modelUsed: false };
  }
  console.log(JSON.stringify(report, null, 2));
  await writeFile(path.join(root, "report.json"), JSON.stringify(report, null, 2), "utf8");
} finally { runner.close(); }
