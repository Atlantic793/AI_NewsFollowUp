import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { AppDeps } from "../types.js";

export async function appendTrace(
  deps: AppDeps,
  topicId: string,
  row: { action: string; phase: string; command?: string; count?: number; ms?: number; note?: string },
): Promise<void> {
  try {
    const file = path.join(deps.dataDir, "topics", topicId, "trace.jsonl");
    await mkdir(path.dirname(file), { recursive: true });
    const line = JSON.stringify({ at: deps.now().toISOString(), ...row });
    if (line.includes("OPENAI_API_KEY") || line.includes("FIRECRAWL_API_KEY") || /sk-[A-Za-z0-9]{8,}/.test(line) || /Bearer\s+\S+/.test(line)) return;
    await appendFile(file, `${line}\n`, "utf8");
  } catch {
    return;
  }
}
