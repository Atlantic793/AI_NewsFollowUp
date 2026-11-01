import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { bad } from "../http-error.js";
import type { AppDeps } from "../types.js";
import { WRITE_VERBS } from "../types.js";
import { genericSupports, keywordArg, needsLogin } from "./normalize.js";
import { parseAuthStatus, parseHelp, parseList, readEnvelope, type LoginState } from "./parse.js";
import type { AdapterCommand } from "./protocol.js";

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
  browser?: boolean;
}

interface CacheFile {
  version: 3;
  runtimeKey: string;
  fetchedAt: string;
  entries: CatalogEntry[];
}

const CACHE_MS = 24 * 60 * 60 * 1000;
const LOGIN_CACHE_MS = 60_000;
interface CatalogState {
  entries?: CatalogEntry[];
  fetchedAt: string;
  refreshing?: Promise<void>;
  refreshForced?: boolean;
  login: Map<string, LoginState>;
  loginExpires: number;
  loginBusy?: Promise<void>;
}
const states = new WeakMap<AppDeps, CatalogState>();

function siteOf(command: string): string {
  return command.split(/\s+/)[0] ?? command;
}

export async function discoverCatalog(deps: AppDeps, refresh: boolean): Promise<{ fetchedAt: string; commands: CatalogEntry[]; loginChecking: boolean }> {
  const cachePath = path.join(deps.dataDir, "catalog-cache.json");
  const runtimeKey = deps.runner.cacheKey ?? "injected-runner";
  let state = states.get(deps);
  if (!state) {
    state = { fetchedAt: "", login: new Map(), loginExpires: 0 };
    states.set(deps, state);
  }
  const current = state;
  if (refresh && current.refreshing && !current.refreshForced) {
    await current.refreshing.catch(() => undefined);
    return discoverCatalog(deps, true);
  }
  const fresh = () => current.entries !== undefined && deps.now().getTime() - Date.parse(current.fetchedAt) < CACHE_MS;
  if (refresh || !fresh()) {
    if (!current.refreshing) {
      current.refreshForced = refresh;
      current.refreshing = (async () => {
        const cached = await readCache(cachePath, runtimeKey);
        if (!current.entries && cached) {
          current.entries = cached.entries;
          current.fetchedAt = cached.fetchedAt;
        }
        if (!refresh && fresh()) return;
        try {
          const entries = deps.runner.catalog
            ? (await deps.runner.catalog(refresh)).map(catalogEntry)
            : await listAdapters(deps);
          const fetchedAt = deps.now().toISOString();
          await mkdir(deps.dataDir, { recursive: true });
          const temporary = `${cachePath}.${crypto.randomUUID()}.tmp`;
          try {
            await writeFile(temporary, JSON.stringify({ version: 3, runtimeKey, fetchedAt, entries } satisfies CacheFile), "utf8");
            await rename(temporary, cachePath);
          } finally {
            await rm(temporary, { force: true });
          }
          current.entries = entries;
          current.fetchedAt = fetchedAt;
        } catch (error) {
          if (!current.entries) {
            const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
            if (code === "OPENCLI_MISSING") throw bad(503, "OPENCLI_MISSING", "本机还不能运行 opencli。");
            throw bad(503, "CATALOG_FAILED", "暂时读不到信息源清单。");
          }
        }
      })().finally(() => { current.refreshing = undefined; current.refreshForced = false; });
    }
    await current.refreshing;
  }
  const entries = current.entries ?? [];
  // 登录状态独立缓存、后台更新，目录读取与采集不等待浏览器。
  if (!current.loginBusy && (refresh || deps.now().getTime() >= current.loginExpires)) {
    current.loginExpires = deps.now().getTime() + LOGIN_CACHE_MS;
    const sites = entries.filter((entry) => entry.selectable && entry.browser).map((entry) => entry.site);
    current.loginBusy = readLogin(deps, sites).then((login) => { current.login = login; })
      .finally(() => { current.loginBusy = undefined; });
  }
  const withLogin = entries.map((entry) => ({ ...entry, loginState: current.login.get(entry.site) ?? "unknown" }));
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
  return { fetchedAt: current.fetchedAt, commands: [...withLogin, ...recipes], loginChecking: Boolean(current.loginBusy) };
}

function catalogEntry({ command, description, help }: AdapterCommand): CatalogEntry {
  const arg = keywordArg(help);
  const login = needsLogin(description) || needsLogin(help.description) || help.siteSession === true;
  const supported = help.access === "read" && !WRITE_VERBS.has(command.split(/\s+/)[1] ?? "") && arg !== null && genericSupports(help) && !login;
  return {
    command, site: siteOf(command), description, access: "read", transport: "adapter",
    keywordArg: arg ?? "query", selectable: supported,
    disabledReason: login ? "login-required" : supported ? undefined : "not-normalizable",
    loginState: "unknown", browser: help.browser === true,
  };
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
    entries.push(catalogEntry({ command: command.command, description: command.description, help: { ...help, access: "read" } }));
  }
  return entries;
}

async function readLogin(deps: AppDeps, sites: string[]): Promise<Map<string, LoginState>> {
  const unique = [...new Set(sites)];
  if (unique.length === 0) return new Map();
  try {
    const result = await deps.runner.run(["opencli", "auth", "status", "--site", unique.join(","), "-f", "json"], 3_500);
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

async function readCache(file: string, runtimeKey: string): Promise<CacheFile | null> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as CacheFile;
    if (!parsed || parsed.version !== 3 || parsed.runtimeKey !== runtimeKey || !Array.isArray(parsed.entries) || !Number.isFinite(Date.parse(parsed.fetchedAt))) return null;
    return parsed;
  } catch {
    return null;
  }
}
