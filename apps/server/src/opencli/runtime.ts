import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getRegistry, type CliCommand } from "@jackwener/opencli/registry";
import { WRITE_VERBS } from "../types.js";
import { genericSupports, keywordArg, needsLogin } from "./normalize.js";
import { OPENCLI_VERSION, type AdapterCommand } from "./protocol.js";

// 仅此文件依赖上游内部布局；升级固定版本时须运行目录与执行兼容测试。
export const openCliEntry = createRequire(import.meta.url).resolve("@jackwener/opencli");
const packageRoot = path.resolve(path.dirname(openCliEntry), "../..");
const internal = (name: string) => pathToFileURL(path.join(packageRoot, "dist/src", `${name}.js`)).href;

interface Discovery {
  discoverClis(...roots: string[]): Promise<void>;
  discoverPlugins(): Promise<void>;
}
interface Execution {
  executeCommand(command: CliCommand, args: Record<string, unknown>, debug: boolean, options: Record<string, unknown>): Promise<unknown>;
}

export class OpenCliRuntime {
  private loading?: Promise<void>;

  constructor(private readonly roots?: string[]) {}

  private load(): Promise<void> {
    this.loading ??= (async () => {
      const pkg = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as { version: string };
      if (pkg.version !== OPENCLI_VERSION) throw new Error("OpenCLI 版本不匹配，请执行 npm ci。");
      const discovery = await import(internal("discovery")) as Discovery;
      await discovery.discoverClis(...(this.roots ?? [path.join(packageRoot, "clis"), path.join(os.homedir(), ".opencli/clis")]));
      if (!this.roots) await discovery.discoverPlugins();
    })();
    return this.loading;
  }

  async catalog(): Promise<AdapterCommand[]> {
    await this.load();
    return [...new Set(getRegistry().values())]
      .filter((cmd) => `${cmd.site} ${cmd.name} ${cmd.description}`.toLowerCase().includes("search") && cmd.access === "read" && !WRITE_VERBS.has(cmd.name) && !/\s/.test(cmd.site + cmd.name))
      .map((cmd): AdapterCommand => ({
        command: `${cmd.site} ${cmd.name}`,
        description: cmd.description,
        help: {
          access: cmd.access, description: cmd.description, browser: cmd.browser,
          siteSession: Boolean(cmd.siteSession), columns: cmd.columns,
          positionals: cmd.args.filter((arg) => arg.positional),
          command_options: cmd.args.filter((arg) => !arg.positional),
        },
      }))
      .sort((a, b) => a.command.localeCompare(b.command));
  }

  async search(command: string, keyword: string): Promise<unknown> {
    const metadata = (await this.catalog()).find((entry) => entry.command === command);
    const help = metadata?.help;
    const arg = help ? keywordArg(help) : null;
    if (!metadata || !help || !arg || !genericSupports(help) || needsLogin(metadata.description) || needsLogin(help.description) || help.siteSession) {
      throw new Error("这个命令不在可采集的只读搜索目录中。");
    }
    if (!keyword.trim() || keyword.length > 80) throw new Error("检索词无效。");
    if (help.browser && !await this.bridgeReady()) throw new Error("请先连接 OpenCLI 浏览器扩展，再使用这个信息源。");
    const cmd = getRegistry().get(command.replace(" ", "/"));
    if (!cmd || cmd.access !== "read" || WRITE_VERBS.has(cmd.name)) throw new Error("只允许只读搜索命令。");
    const { installNodeNetwork } = await import(internal("node-network")) as { installNodeNetwork(): void };
    installNodeNetwork();
    const { executeCommand } = await import(internal("execution")) as Execution;
    return executeCommand(cmd, { [arg]: keyword }, false, { siteSession: "ephemeral", keepTab: "false", windowMode: "background" });
  }

  private async bridgeReady(): Promise<boolean> {
    const { getDaemonHealth } = await import(internal("browser/daemon-transport")) as { getDaemonHealth(options?: unknown): Promise<{ state: string }> };
    return (await getDaemonHealth({ timeout: 300 })).state === "ready";
  }

  async login(sites: string[]): Promise<{ site: string; status: string }[]> {
    // 没有连接时只返回未知，不启动守护进程、不打开网站或触发登录。
    if (!sites.length || !await this.bridgeReady()) return [];
    await this.load();
    const { collectAuthStatus } = await import(internal("commands/auth")) as {
      collectAuthStatus(options: unknown): Promise<{ site: string; status: string }[]>;
    };
    const rows = await collectAuthStatus({ sites: sites.join(","), full: false, concurrency: 1, timeout: 2 });
    return rows.map(({ site, status }) => ({ site, status }));
  }
}
