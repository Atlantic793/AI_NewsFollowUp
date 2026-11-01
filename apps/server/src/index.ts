import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { localTimeZone } from "@followup/core";
import { createApp } from "./app.js";
import { envModel, rejectSecretArgv } from "./model/client.js";
import { openFolderInExplorer } from "./opencli/runner.js";
import { managedRunner } from "./opencli/managed-runner.js";
import type { AppDeps } from "./types.js";

rejectSecretArgv(process.argv);

const port = Number(process.env.PORT ?? 4177);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const runner = managedRunner();
const deps: AppDeps = {
  dataDir: process.env.FOLLOWUP_DATA_DIR ?? (process.env.APPDATA ? path.join(process.env.APPDATA, "AI_NewsFollowUp") : path.join(os.homedir(), ".ai-newsfollowup")),
  topicsRoot: process.env.FOLLOWUP_TOPICS_ROOT ?? path.join(os.homedir(), "AI_NewsFollowUp", "topics"),
  runner,
  model: envModel(),
  now: () => new Date(),
  timeZone: localTimeZone(),
  openFolder: openFolderInExplorer,
  pickFolder: pickWindowsFolder,
  recipes: [],
  fetchImpl: fetch,
};

const app = createApp(deps);
const dist = path.join(repoRoot, "apps/web/dist");
if (existsSync(dist)) {
  app.use("/*", serveStatic({ root: dist }));
  app.get("*", serveStatic({ root: dist, path: "index.html" }));
}

const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, () => {
  console.log(`headline-chaser 已在 http://127.0.0.1:${port}`);
});

void app.tick().catch((error: unknown) => {
  console.error(error);
});
const scheduler = setInterval(() => {
  void app.tick().catch((error: unknown) => {
    console.error(error);
  });
}, 30_000);

for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  clearInterval(scheduler);
  runner.close();
  server.close();
});

async function pickWindowsFolder(): Promise<string | null> {
  const script = "Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; if ($dialog.ShowDialog() -eq 'OK') { Write-Output $dialog.SelectedPath }";
  const child = spawn("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true });
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  await new Promise((resolve) => {
    child.on("close", resolve);
  });
  const picked = stdout.trim();
  return picked || null;
}
