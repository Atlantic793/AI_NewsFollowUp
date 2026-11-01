import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import type { Audience, HeatStage } from "@followup/core";
import { bad } from "../http-error.js";
import { DIR_BRIEF, DIR_MATERIAL, DIR_NOTE, DIR_SNAPSHOT, THEME_FILE, type AppDeps } from "../types.js";

export type ThemeAudience = Audience;

export interface ReportedEvent {
  eventKey: string;
  title: string;
  stage: HeatStage;
  reportedAt: string;
}

export interface ThemeCardInput {
  keywordsEn?: string[];
  mustInclude?: string[];
  exclude?: string[];
  timeWindow?: string | number;
  itemCount?: number;
  audience?: string;
}

export interface ThemeFile {
  id: string;
  status: "pending" | "confirmed";
  utterance: string;
  keywords: string[];
  keywordsEn: string[];
  mustInclude: string[];
  exclude: string[];
  timeWindow: number;
  itemCount: number;
  audience: ThemeAudience;
  language: "简体中文";
  reported: ReportedEvent[];
  platforms: { command: string; selected: boolean }[];
  morningReport: { enabled: boolean; time: string | null };
  folderPath: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
}

export interface TopicRecord {
  id: string;
  folderPath: string;
  createdAt: string;
}

interface Registry {
  version: 1;
  topics: TopicRecord[];
}

export interface PendingNote {
  url?: string;
  materialPath?: string;
  preview: string;
}

export interface PendingAction {
  type: "collect" | "research" | "track" | "update-plan" | "agree-plan" | "organize";
  keywords: string[];
  platforms: string[];
  createdAt: string;
  card?: ThemeCardInput;
  note?: PendingNote;
}

export async function ensureLayout(deps: AppDeps): Promise<void> {
  await mkdir(deps.dataDir, { recursive: true });
  await mkdir(path.join(deps.dataDir, "topics"), { recursive: true });
  await mkdir(deps.topicsRoot, { recursive: true });
  const registryPath = path.join(deps.dataDir, "index.json");
  try {
    const registry = JSON.parse(await readFile(registryPath, "utf8")) as Registry;
    if (registry.version !== 1) throw new Error(`未知的登记表版本：${String(registry.version)}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("未知的登记表")) throw error;
    await writeAtomic(registryPath, JSON.stringify({ version: 1, topics: [] } satisfies Registry, null, 2));
  }
}

export async function readRegistry(deps: AppDeps): Promise<Registry> {
  await ensureLayout(deps);
  return JSON.parse(await readFile(path.join(deps.dataDir, "index.json"), "utf8")) as Registry;
}

export async function writeRegistry(deps: AppDeps, registry: Registry): Promise<void> {
  await writeAtomic(path.join(deps.dataDir, "index.json"), JSON.stringify(registry, null, 2));
}

export function serializeTheme(theme: ThemeFile): string {
  return `---\n${stringify(theme).trim()}\n---\n\n${theme.utterance.trim()}\n`;
}

export function parseTheme(text: string): ThemeFile {
  const matched = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!matched?.[1]) throw bad(422, "ARCHIVE_UNREADABLE", "档案无法读取。");
  const parsed = parse(matched[1]) as ThemeFile;
  if (!parsed?.id || !parsed.folderPath) throw bad(422, "ARCHIVE_UNREADABLE", "档案无法读取。");
  return coerceTheme(parsed);
}

export function blankThemeCard(): Pick<ThemeFile, "keywordsEn" | "mustInclude" | "exclude" | "timeWindow" | "itemCount" | "audience" | "language" | "reported"> {
  return {
    keywordsEn: [],
    mustInclude: [],
    exclude: [],
    timeWindow: 7,
    itemCount: 6,
    audience: "随便看看",
    language: "简体中文",
    reported: [],
  };
}

export function applyThemeCard(theme: ThemeFile, card?: ThemeCardInput): ThemeFile {
  if (!card) return coerceTheme(theme);
  return coerceTheme({
    ...theme,
    keywordsEn: card.keywordsEn ?? theme.keywordsEn,
    mustInclude: card.mustInclude ?? theme.mustInclude,
    exclude: card.exclude ?? theme.exclude,
    timeWindow: card.timeWindow === undefined ? theme.timeWindow : coerceTimeWindow(card.timeWindow, theme.timeWindow),
    itemCount: card.itemCount ?? theme.itemCount,
    audience: audienceOf(card.audience, theme.audience),
  });
}

export function coerceTheme(theme: ThemeFile): ThemeFile {
  const card = blankThemeCard();
  const stages = new Set<HeatStage>(["爆发", "高峰", "衰退", "长尾"]);
  const audiences = new Set<ThemeAudience>(["学生", "从业者", "管理层", "随便看看"]);
  theme.keywords ??= [];
  theme.keywordsEn = wordList(theme.keywordsEn ?? card.keywordsEn);
  theme.mustInclude = wordList(theme.mustInclude ?? card.mustInclude);
  theme.exclude = wordList(theme.exclude ?? card.exclude);
  theme.timeWindow = coerceTimeWindow(theme.timeWindow);
  const count = Number(theme.itemCount);
  theme.itemCount = count >= 5 && count <= 7 ? Math.round(count) : card.itemCount;
  theme.audience = audiences.has(theme.audience) ? theme.audience : card.audience;
  theme.language = "简体中文";
  theme.reported = (theme.reported ?? []).flatMap((row) => {
    if (!row || typeof row.eventKey !== "string" || !stages.has(row.stage)) return [];
    return [{ eventKey: row.eventKey, title: String(row.title ?? ""), stage: row.stage, reportedAt: String(row.reportedAt ?? "") }];
  });
  theme.platforms ??= [];
  theme.morningReport ??= { enabled: false, time: null };
  return theme;
}

function audienceOf(value: string | undefined, fallback: ThemeAudience): ThemeAudience {
  switch (value) {
    case "学生":
    case "从业者":
    case "管理层":
    case "随便看看":
      return value;
    default:
      return fallback;
  }
}

export function coerceTimeWindow(value: unknown, fallback = 7): number {
  const parsed = readTimeWindow(value);
  return clampDays(parsed ?? fallback);
}

function readTimeWindow(value: unknown): number | null {
  if (value === "1d") return 1;
  if (value === "7d") return 7;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const text = value.trim();
    if (text !== "" && Number.isFinite(Number(text))) return Number(text);
  }
  return null;
}

function clampDays(value: number): number {
  if (!Number.isFinite(value)) return 7;
  return Math.min(90, Math.max(1, Math.round(value)));
}

function wordList(values: readonly string[]): string[] {
  const words: string[] = [];
  for (const raw of values) {
    const word = raw.trim();
    if (!word || word.length > 40 || words.includes(word) || words.length >= 20) continue;
    words.push(word);
  }
  return words;
}

export async function readTheme(folder: string): Promise<ThemeFile> {
  try {
    return parseTheme(await readFile(path.join(folder, THEME_FILE), "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ARCHIVE_UNREADABLE") throw error;
    throw bad(422, "ARCHIVE_UNREADABLE", "档案无法读取。");
  }
}

export async function writeTheme(theme: ThemeFile): Promise<void> {
  await writeAtomic(path.join(theme.folderPath, THEME_FILE), serializeTheme(theme));
}

export async function createTopicFolder(folder: string): Promise<void> {
  await mkdir(folder, { recursive: true });
  for (const dir of [DIR_BRIEF, DIR_SNAPSHOT, DIR_NOTE, DIR_MATERIAL]) {
    await mkdir(path.join(folder, dir), { recursive: true });
  }
}

export function topicChatPath(deps: AppDeps, id: string): string {
  return path.join(deps.dataDir, "topics", id, "chat.jsonl");
}

export function topicPendingPath(deps: AppDeps, id: string): string {
  return path.join(deps.dataDir, "topics", id, "pending-action.json");
}

export async function readPending(deps: AppDeps, id: string): Promise<PendingAction | null> {
  try {
    return JSON.parse(await readFile(topicPendingPath(deps, id), "utf8")) as PendingAction;
  } catch {
    return null;
  }
}

export async function writePending(deps: AppDeps, id: string, action: PendingAction): Promise<void> {
  await mkdir(path.dirname(topicPendingPath(deps, id)), { recursive: true });
  await writeAtomic(topicPendingPath(deps, id), JSON.stringify(action, null, 2));
}

export async function clearPending(deps: AppDeps, id: string): Promise<void> {
  await rm(topicPendingPath(deps, id), { force: true });
}

async function writeAtomic(file: string, content: string): Promise<void> {
  const temporary = `${file}.tmp`;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(temporary, content, "utf8");
  await rename(temporary, file);
}
