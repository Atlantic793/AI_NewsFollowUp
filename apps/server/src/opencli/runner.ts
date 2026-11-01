import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import type { CommandResult, CommandRunner } from "../types.js";

let opencliCommand: string[] | null = null;

export function spawnRunner(): CommandRunner {
  return {
    async run(argv, timeoutMs) {
      const [command, ...args] = argv;
      if (!command) throw new Error("缺少命令");
      const resolved = command === "opencli" ? [...await resolveOpenCli(), ...args] : [command, ...args];
      const [file, ...rest] = resolved;
      if (!file) throw new Error("缺少命令");
      return launch(file, rest, timeoutMs);
    },
  };
}

async function resolveOpenCli(): Promise<string[]> {
  if (opencliCommand) return opencliCommand;
  if (process.platform !== "win32") {
    opencliCommand = ["opencli"];
    return opencliCommand;
  }
  const where = await launch("where.exe", ["opencli.cmd"], 5_000);
  const cmd = where.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.toLowerCase().endsWith("opencli.cmd"));
  const entry = cmd
    ? path.join(path.dirname(cmd), "node_modules", "@jackwener", "opencli", "dist", "src", "main.js")
    : "";
  try {
    if (!entry) throw new Error("missing");
    await access(entry);
  } catch {
    throw Object.assign(new Error("本机还不能运行 opencli。"), { code: "OPENCLI_MISSING" });
  }
  opencliCommand = [process.execPath, entry];
  return opencliCommand;
}

export function commandEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...base };
  delete env.OPENAI_API_KEY;
  return env;
}

function launch(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, env: commandEnvironment(process.env) });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      stopChild(child);
      if (settled) return;
      settled = true;
      resolve({ code: 1, stdout, stderr: `${stderr}\ntimeout` });
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (error.code === "ENOENT") {
        reject(Object.assign(new Error("本机还不能运行 opencli。"), { code: "OPENCLI_MISSING" }));
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function stopChild(child: ReturnType<typeof spawn>): void {
  if (process.platform === "win32" && child.pid) {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { shell: false, windowsHide: true });
    return;
  }
  child.kill();
}

export async function openFolderInExplorer(folder: string): Promise<void> {
  await spawnRunner().run(["explorer.exe", folder], 10_000);
}
