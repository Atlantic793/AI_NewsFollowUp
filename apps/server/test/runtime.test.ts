import { cli, getRegistry } from "@jackwener/opencli/registry";
import { afterEach, describe, expect, it } from "vitest";
import { OpenCliRuntime } from "../src/opencli/runtime.js";

afterEach(() => {
  for (const key of getRegistry().keys()) if (key.startsWith("fixture/")) getRegistry().delete(key);
});

describe("OpenCLI execution adapter", () => {
  it("uses the real executor with structured keyword arguments and retains runtime state", async () => {
    let calls = 0;
    cli({ site: "fixture", name: "search", description: "Fixture search", access: "read", browser: false,
      args: [{ name: "query", positional: true, required: true }], columns: ["title", "url"],
      func: async (args) => [{ title: String(args.query), url: "https://fixture.test/1", calls: ++calls }],
    });
    const runtime = new OpenCliRuntime([]);
    expect(await runtime.search("fixture search", "a; echo $HOME")).toEqual([{ title: "a; echo $HOME", url: "https://fixture.test/1", calls: 1 }]);
    expect(await runtime.search("fixture search", "second")).toEqual([{ title: "second", url: "https://fixture.test/1", calls: 2 }]);
  }, 15_000);

  it("rejects writes, non-normalizable commands and invalid keywords before execution", async () => {
    let executed = false;
    for (const [name, access, columns] of [["delete", "write", ["title", "url"]], ["search", "read", ["title"]]] as const) {
      cli({ site: "fixture", name, description: "Fixture search", access, browser: false,
        args: [{ name: "query", positional: true }], columns: [...columns], func: async () => { executed = true; return []; },
      });
    }
    const runtime = new OpenCliRuntime([]);
    await expect(runtime.search("fixture delete", "x")).rejects.toThrow("只读");
    await expect(runtime.search("fixture search", "x")).rejects.toThrow("只读");
    expect(executed).toBe(false);
  });
});
