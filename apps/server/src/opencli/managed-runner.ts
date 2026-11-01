import { OPENCLI_VERSION, RUNTIME_KEY, type AdapterCommand } from "./protocol.js";
import { WorkerClient } from "./worker-client.js";
import { spawnRunner } from "./runner.js";
import type { CommandResult, CommandRunner } from "../types.js";

const ok = (data: unknown): CommandResult => ({ code: 0, stdout: JSON.stringify({ ok: true, data }), stderr: "" });

export function managedRunner(workerEntry?: URL): CommandRunner & { close(): void } {
  const collector = new WorkerClient(workerEntry);
  const legacy = spawnRunner();
  const logins = new Set<WorkerClient>();
  return {
    cacheKey: RUNTIME_KEY,
    catalog: (refresh = false) => collector.request<AdapterCommand[]>({ operation: "catalog" }, 15_000, refresh),
    async run(argv, timeoutMs) {
      if (argv[0] !== "opencli") throw new Error("只允许 OpenCLI 采集命令。");
      if (argv.length === 2 && argv[1] === "--version") return { code: 0, stdout: OPENCLI_VERSION, stderr: "" };
      try {
        if (argv[1] === "auth" && argv[2] === "status" && argv[3] === "--site") {
          const sites = (argv[4] ?? "").split(",");
          if (sites.some((site) => !/^[\w-]+$/.test(site))) throw new Error("信息源无效。");
          const login = new WorkerClient(workerEntry);
          logins.add(login);
          try { return ok(await login.request({ operation: "login", sites }, Math.min(timeoutMs, 3_500))); }
          finally { login.close(); logins.delete(login); }
        }
        // 无适配器的浏览器配方保留本地 CLI 路径，仅允许既有的只读动作。
        if (argv[1] === "browser" && (argv[2] === "open" || argv[2] === "state" || argv[2] === "close" || (argv[2] === "get" && argv[3] === "text"))) {
          return legacy.run(argv, timeoutMs);
        }
        if (argv.length !== 6 || argv[4] !== "-f" || argv[5] !== "json") throw new Error("不支持的采集命令。");
        return ok(await collector.request({ operation: "search", command: `${argv[1]} ${argv[2]}`, keyword: argv[3] ?? "" }, timeoutMs));
      } catch (error) {
        return { code: 1, stdout: JSON.stringify({ ok: false, error: { message: error instanceof Error ? error.message : "采集失败。" } }), stderr: "" };
      }
    },
    close() { collector.close(); for (const login of logins) login.close(); logins.clear(); },
  };
}
