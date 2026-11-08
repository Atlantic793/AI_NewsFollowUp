import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const OWNED_BY_FILE = ["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL", "FIRECRAWL_API_KEY", "KAGGLE_USERNAME", "KAGGLE_KEY"] as const;

export function applyEnvText(text: string, env: NodeJS.ProcessEnv): void {
  for (const name of OWNED_BY_FILE) delete env[name];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const body = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const eq = body.indexOf("=");
    if (eq <= 0) continue;
    const name = body.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    let value = body.slice(eq + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!value) continue;
    env[name] = value;
  }
}

export function loadEnvFile(root: string, env: NodeJS.ProcessEnv = process.env): void {
  const file = path.join(root, ".env");
  if (!existsSync(file)) return;
  applyEnvText(readFileSync(file, "utf8"), env);
}
