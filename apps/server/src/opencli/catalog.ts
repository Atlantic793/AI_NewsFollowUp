import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { bad } from "../http-error.js";
import type { AppDeps } from "../types.js";
import { WRITE_VERBS } from "../types.js";
import { genericSupports, keywordArg, needsLogin } from "./normalize.js";
import { parseAuthStatus, parseHelp, parseList, readEnvelope, type LoginState } from "./parse.js";

export interface CatalogEntry {
  command: string;
  site: string;
  description: string;
  access: "read";
  transport: "adapter" | "browser";
  keywordArg: string;
  selectable: boolean;
  disabledReason?: "not-normalizable" | "login-required";
  loginState: LoginState;
}

interface CacheFile {
  version: 2;
  fetchedAt: string;
  entries: CatalogEntry[];
}

const CACHE_MS = 24 * 60 * 60 * 1000;

function siteOf(command: string): string {
  return command.split(/\s+/)[0] ?? command;
}

export async function discoverCatalog(deps: AppDeps, refresh: boolean): Promise<{ fetchedAt: string; commands: CatalogEntry[] }> {
  const cachePath = path.join(deps.dataDir, "catalog-cache.json");
  const cached = await readCache(cachePath);
  const fresh = cached && Date.parse(deps.now().toISOString()) - Date.parse(cached.fetchedAt) < CACHE_MS;
  let entries = !refresh && fresh && cached ? cached.entries.filter((entry) => entry.transport === "adapter") : null;
  if (!entries) {
    try {
      entries = await listAdapters(deps);
      await mkdir(deps.dataDir, { recursive: true });
      await writeFile(cachePath, JSON.stringify({ version: 2, fetchedAt: deps.now().toISOString(), entries } satisfies CacheFile), "utf8");
    } catch (error) {
      if (cached) entries = cached.entries.filter((entry) => entry.transport === "adapter");
      else {
        const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
        if (code === "OPENCLI_MISSING") throw bad(503, "OPENCLI_MISSING", "本机还不能运行 opencli。");
        throw bad(503, "CATALOG_FAILED", "暂时读不到信息源清单。");
      }
    }
  }
  const login = await readLogin(deps, entries.map((entry) => entry.site));
  const withLogin = entries.map((entry) => ({ ...entry, loginState: login.get(entry.site) ?? "unknown" }));
  const recipes = deps.recipes
    .filter((recipe) => !withLogin.some((entry) => entry.selectable && entry.site === recipe.site))
    .map((recipe): CatalogEntry => ({
      command: `browser:${recipe.id}`,
      site: recipe.site,
      description: recipe.label,
      access: "read",
      transport: "browser",
      keywordArg: "query",
      selectable: true,
      loginState: "unknown",
    }));
  return { fetchedAt: cached && !refresh && fresh ? cached.fetchedAt : deps.now().toISOString(), commands: [...withLogin, ...recipes] };
}

async function listAdapters(deps: AppDeps): Promise<CatalogEntry[]> {
  const listed = [];
  let offset = 0;
  for (let page = 0; page < 20; page += 1) {
    const result = await deps.runner.run(["opencli", "list", "search", "--limit", "100", "--offset", String(offset), "-f", "json"], 20_000);
    if (result.code !== 0) throw new Error("list failed");
    const parsed = parseList(result.stdout);
    listed.push(...parsed.commands);
    if (!parsed.nextOffset) break;
    offset = parsed.nextOffset;
  }
  const entries: CatalogEntry[] = [];
  for (const command of listed) {
    if (command.access !== "read") continue;
    const parts = command.command.split(/\s+/);
    if (parts.length !== 2) continue;
    const name = parts[1] ?? "";
    if (WRITE_VERBS.has(name)) continue;
    const helpResult = await deps.runner.run(["opencli", parts[0] ?? "", name, "--help", "-f", "json"], 20_000);
    if (helpResult.code !== 0) continue;
    let help;
    try {
      help = parseHelp(helpResult.stdout);
    } catch {
      continue;
    }
    const arg = keywordArg(help);
    const login = needsLogin(command.description) || needsLogin(help.description) || help.siteSession === true;
    const supported = arg !== null && genericSupports(help) && !login;
    entries.push({
      command: command.command,
      site: siteOf(command.command),
      description: command.description,
      access: "read",
      transport: "adapter",
      keywordArg: arg ?? "query",
      selectable: supported,
      disabledReason: login ? "login-required" : supported ? undefined : "not-normalizable",
      loginState: "unknown",
    });
  }
  return entries;
}

async function readLogin(deps: AppDeps, sites: string[]): Promise<Map<string, LoginState>> {
  const unique = [...new Set(sites)];
  if (unique.length === 0) return new Map();
  try {
    const result = await deps.runner.run(["opencli", "auth", "status", "--site", unique.join(","), "-f", "json"], 20_000);
    if (result.code !== 0 && !result.stdout.trim()) return new Map();
    return parseAuthStatus(result.stdout);
  } catch {
    return new Map();
  }
}

export async function runSearchCommand(deps: AppDeps, command: string, keyword: string): Promise<{ ok: true; data: unknown } | { ok: false; message: string }> {
  const [site, name] = command.split(/\s+/);
  if (!site || !name) return { ok: false, message: "命令不在当前清单。" };
  const result = await deps.runner.run(["opencli", site, name, keyword, "-f", "json"], 90_000);
  const parsed = readEnvelope(result.stdout);
  const envelope = result.code === 0 ? parsed : { ok: false as const, message: parsed.ok ? "命令失败。" : parsed.message };
  if (!envelope.ok) return envelope;
  return { ok: true, data: envelope.data };
}

async function readCache(file: string): Promise<CacheFile | null> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as CacheFile;
    if (!parsed || parsed.version !== 2 || !Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}
