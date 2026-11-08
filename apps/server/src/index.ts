import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.js";
import { loadEnvFile } from "./env-file.js";
import type { AppDeps } from "./types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnvFile(repoRoot);

const port = Number(process.env.PORT ?? 4177);
const deps: AppDeps = {
  dataDir: process.env.FOLLOWUP_DATA_DIR ?? (process.env.APPDATA ? path.join(process.env.APPDATA, "AI_NewsFollowUp") : path.join(os.homedir(), ".ai-newsfollowup")),
  now: () => new Date(),
  fetchImpl: fetch,
};

const app = createApp(deps);
const dist = path.join(repoRoot, "apps/web/dist");
if (existsSync(dist)) {
  app.use("/*", serveStatic({ root: dist }));
  app.get("*", serveStatic({ root: dist, path: "index.html" }));
}

serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, () => {
  console.log(`headline-chaser 已在 http://127.0.0.1:${port}`);
});
