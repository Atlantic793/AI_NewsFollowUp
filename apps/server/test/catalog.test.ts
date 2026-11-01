import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverCatalog } from "../src/opencli/catalog.js";
import { parseAuthStatus } from "../src/opencli/parse.js";
import type { AppDeps, CommandResult } from "../src/types.js";

const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))); });
const metadata = [{ command: "fixture search", description: "Search fixture", help: { access: "read", browser: true, positionals: [{ name: "query", required: true }], columns: ["title", "url"] } }];
async function fixture() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "followup-catalog-")); folders.push(dataDir);
  const catalog = vi.fn(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); return metadata; });
  const run = vi.fn(async (): Promise<CommandResult> => ({ code: 0, stdout: '{"ok":true,"data":[]}', stderr: "" }));
  const deps: AppDeps = { dataDir, topicsRoot: path.join(dataDir, "topics"), runner: { cacheKey: "test-1", catalog, run }, model: { available: false, complete: async () => "" }, now: () => new Date(), timeZone: "Asia/Shanghai", recipes: [], fetchImpl: fetch, openFolder: async () => {}, pickFolder: async () => null };
  return { deps, catalog, run };
}

describe("catalog cache and login isolation", () => {
  it("coalesces concurrent discovery and refresh, and reuses memory and disk caches", async () => {
    const { deps, catalog } = await fixture();
    const cold = await Promise.all(Array.from({ length: 6 }, () => discoverCatalog(deps, false)));
    expect(catalog).toHaveBeenCalledTimes(1);
    expect(cold[0]?.commands[0]?.selectable).toBe(true);
    await discoverCatalog(deps, false);
    expect(catalog).toHaveBeenCalledTimes(1);
    await discoverCatalog({ ...deps }, false);
    expect(catalog).toHaveBeenCalledTimes(1);
    await Promise.all(Array.from({ length: 6 }, () => discoverCatalog(deps, true)));
    expect(catalog).toHaveBeenCalledTimes(2);
  });

  it("invalidates expired or incompatible caches and preserves the last directory on refresh failure", async () => {
    const { deps, catalog } = await fixture();
    await discoverCatalog(deps, false);
    const later = new Date(Date.now() + 25 * 60 * 60_000);
    await discoverCatalog({ ...deps, now: () => later }, false);
    expect(catalog).toHaveBeenCalledTimes(2);
    await discoverCatalog({ ...deps, runner: { ...deps.runner, cacheKey: "test-2" } }, false);
    expect(catalog).toHaveBeenCalledTimes(3);
    catalog.mockRejectedValueOnce(new Error("offline"));
    const fallback = await discoverCatalog(deps, true);
    expect(fallback.commands[0]?.command).toBe("fixture search");
  });

  it("honors a manual refresh arriving during non-forced discovery", async () => {
    const { deps, catalog } = await fixture();
    const cold = discoverCatalog(deps, false);
    const refreshes = Promise.all(Array.from({ length: 3 }, () => discoverCatalog(deps, true)));
    await Promise.all([cold, refreshes]);
    expect(catalog).toHaveBeenCalledTimes(2);
    expect(catalog).toHaveBeenLastCalledWith(true);
  });

  it("still attempts the manual refresh if concurrent cold discovery fails", async () => {
    const { deps, catalog } = await fixture();
    catalog.mockRejectedValueOnce(new Error("temporary failure"));
    const cold = discoverCatalog(deps, false).catch(() => null);
    const forced = discoverCatalog(deps, true);
    expect(await cold).toBeNull();
    expect((await forced).commands[0]?.command).toBe("fixture search");
    expect(catalog).toHaveBeenCalledTimes(2);
    expect(catalog).toHaveBeenLastCalledWith(true);
  });

  it("returns while login is pending, merges the result later and caches login checks", async () => {
    const { deps, run } = await fixture();
    let finish!: (result: CommandResult) => void;
    run.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const first = await discoverCatalog(deps, false);
    expect(first.loginChecking).toBe(true);
    expect(first.commands[0]?.loginState).toBe("unknown");
    await discoverCatalog(deps, false);
    expect(run).toHaveBeenCalledTimes(1);
    finish({ code: 0, stdout: '{"ok":true,"data":[{"site":"fixture","status":"not_logged_in"}]}', stderr: "" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await discoverCatalog(deps, false);
    expect(second.commands[0]?.loginState).toBe("not-logged-in");
    expect(second.loginChecking).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("normalizes the pinned upstream auth status spelling", () => {
    const states = parseAuthStatus('{"ok":true,"data":[{"site":"a","status":"logged_in"},{"site":"b","status":"not_logged_in"}]}');
    expect([...states.values()]).toEqual(["logged-in", "not-logged-in"]);
  });
});
