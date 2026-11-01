import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isInsideFolder } from "@followup/core";
import { BudgetStop, estimateTokens, limitsOf, withDeadline } from "../budget.js";
import { bad } from "../http-error.js";
import { appendTrace } from "../jobs/trace.js";
import { extractJson } from "../model/json.js";
import { createNote, previewNoteTarget } from "../notes/create.js";
import { discoverCatalog } from "../opencli/catalog.js";
import { listBriefs, listSnapshots } from "../topic/archive.js";
import { clearPending, readPending, readTheme, topicChatPath, writePending, type PendingAction, type ThemeAudience, type ThemeFile } from "../topic/store.js";
import type { AppDeps, ChatMessage } from "../types.js";

interface StoredChat {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  citations: ({ type: "file"; path: string } | { type: "url"; url: string })[];
}

interface ModelIntent {
  intent?: string;
  answer?: string;
  citations?: { type?: string; path?: string; url?: string }[];
  keywords?: string[];
  keywordsEn?: string[];
  mustInclude?: string[];
  exclude?: string[];
  timeWindow?: string;
  itemCount?: number;
  audience?: string;
  platforms?: string[];
  url?: string;
  materialPath?: string;
}

const SUPERSEDE = "上一条未确认动作将作废。";
const UNKNOWN_INTENT = "没听懂，请换一种说法。";

export async function readChat(deps: AppDeps, topicId: string): Promise<StoredChat[]> {
  try {
    const text = await readFile(topicChatPath(deps, topicId), "utf8");
    return text.split(/\r?\n/).flatMap((line) => {
      if (!line.trim()) return [];
      try {
        return [JSON.parse(line) as StoredChat];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

export async function postChat(deps: AppDeps, topicId: string, folder: string, text: string): Promise<{ messages: StoredChat[]; pending: PendingAction | null }> {
  const content = text.trim();
  if (content.length < 1 || content.length > 4000) throw bad(400, "UTTERANCE_INVALID", "请用一句话描述主题。");
  const theme = await readTheme(folder);
  const history = await readChat(deps, topicId);
  await appendMessage(deps, topicId, { role: "user", content, citations: [] });
  if (!deps.model.available) {
    await appendMessage(deps, topicId, { role: "assistant", content: "还没有配置模型。", citations: [] });
    throw bad(503, "MODEL_UNAVAILABLE", "还没有配置模型。");
  }
  const limits = limitsOf(deps);
  const started = Date.now();
  let intent: ModelIntent;
  try {
    const packed = await contextMessages(deps, folder, theme, history, content, limits.chatTokens);
    if (packed.over) {
      await appendMessage(deps, topicId, { role: "assistant", content: "已停在对话·超过内容上限", citations: [] });
      await appendTrace(deps, topicId, { action: "chat", phase: "对话", count: packed.tokens, ms: Date.now() - started, note: "超过内容上限" });
      return { messages: await readChat(deps, topicId), pending: await readPending(deps, topicId) };
    }
    const reply = await withDeadline(deps.model.complete(packed.messages), limits.chatWallMs, "对话");
    intent = extractJson(reply) as ModelIntent;
    await appendTrace(deps, topicId, { action: "chat", phase: "对话", count: packed.tokens, ms: Date.now() - started, note: intent.intent ?? "missing" });
  } catch (error) {
    if (error instanceof BudgetStop) {
      await appendMessage(deps, topicId, { role: "assistant", content: error.message, citations: [] });
      await appendTrace(deps, topicId, { action: "chat", phase: "对话", ms: Date.now() - started, note: error.reason });
      return { messages: await readChat(deps, topicId), pending: await readPending(deps, topicId) };
    }
    await appendMessage(deps, topicId, { role: "assistant", content: "模型没有返回可用结果。", citations: [] });
    throw bad(502, "MODEL_REQUEST_FAILED", "模型没有返回可用结果。");
  }
  const name = intentName(intent.intent);
  if (!name) {
    await appendMessage(deps, topicId, { role: "assistant", content: UNKNOWN_INTENT, citations: [] });
    return { messages: await readChat(deps, topicId), pending: await readPending(deps, topicId) };
  }
  const snapshots = await listSnapshots(folder);
  switch (name) {
    case "discuss":
      return replyDiscuss(deps, topicId, folder, intent);
    case "organize":
      return replyOrganize(deps, topicId, folder, theme, intent);
    case "propose-plan":
    case "update-plan":
      return replyPlan(deps, topicId, intent);
    case "research":
    case "collect":
      return replyResearch(deps, topicId, folder, theme, intent);
    case "track":
      return replyTrack(deps, topicId, folder, theme, snapshots.length, intent);
    default: {
      const unreachable: never = name;
      return unreachable;
    }
  }
}

type IntentName = "discuss" | "organize" | "propose-plan" | "update-plan" | "research" | "collect" | "track";

function intentName(value: string | undefined): IntentName | null {
  switch (value) {
    case "discuss":
    case "organize":
    case "propose-plan":
    case "update-plan":
    case "research":
    case "collect":
    case "track":
      return value;
    default:
      return null;
  }
}

async function replyDiscuss(deps: AppDeps, topicId: string, folder: string, intent: ModelIntent) {
  const citations = await verifiedCitations(folder, intent.citations ?? []);
  await appendMessage(deps, topicId, {
    role: "assistant",
    content: intent.answer || "文件夹里没有对应材料。",
    citations,
  });
  return { messages: await readChat(deps, topicId), pending: await readPending(deps, topicId) };
}

async function replyOrganize(deps: AppDeps, topicId: string, folder: string, theme: ThemeFile, intent: ModelIntent) {
  if (theme.status !== "confirmed") {
    await appendMessage(deps, topicId, { role: "assistant", content: "请先同意调研方案。可以在对话里把方案确定下来，或在设置里点确认计划。", citations: [] });
    return { messages: await readChat(deps, topicId), pending: await readPending(deps, topicId) };
  }
  const preview = await previewNoteTarget(folder, { url: intent.url, materialPath: intent.materialPath });
  if (!preview.ok) {
    await appendMessage(deps, topicId, { role: "assistant", content: preview.message, citations: [] });
    return { messages: await readChat(deps, topicId), pending: await readPending(deps, topicId) };
  }
  const pending: PendingAction = {
    type: "organize",
    keywords: [],
    platforms: [],
    createdAt: deps.now().toISOString(),
    note: { ...preview.target, preview: preview.preview },
  };
  return placePending(deps, topicId, pending, preview.preview, []);
}

export async function confirmOrganize(deps: AppDeps, topicId: string, folder: string, pending: PendingAction): Promise<string> {
  const preview = await previewNoteTarget(folder, { url: pending.note?.url, materialPath: pending.note?.materialPath });
  if (!preview.ok) throw bad(400, "NOTE_EMPTY", preview.message);
  const notePath = await createNote(deps, folder, preview.target);
  await clearPending(deps, topicId);
  await appendMessage(deps, topicId, {
    role: "assistant",
    content: "已经写成笔记。",
    citations: [{ type: "file", path: notePath }],
  });
  await appendTrace(deps, topicId, { action: "note", phase: "成稿", command: preview.target.materialPath ?? preview.target.url ?? "", count: 1, note: "written" });
  return notePath;
}

async function replyPlan(deps: AppDeps, topicId: string, intent: ModelIntent) {
  const catalog = await discoverCatalog(deps, false).catch(() => null);
  const selectable = new Set((catalog?.commands ?? []).filter((entry) => entry.selectable).map((entry) => entry.command));
  const keywords = [...new Set((intent.keywords ?? []).map((keyword) => keyword.trim()).filter(Boolean))].slice(0, 20);
  const platforms = [...new Set((intent.platforms ?? []).filter((platform) => selectable.has(platform)))].slice(0, 20);
  if (keywords.length === 0 || platforms.length === 0) {
    await appendMessage(deps, topicId, { role: "assistant", content: "方案还缺关键词，或还没有能纳入对比的平台。", citations: [] });
    return { messages: await readChat(deps, topicId), pending: await readPending(deps, topicId) };
  }
  const audiences = new Set<ThemeAudience>(["学生", "从业者", "管理层", "随便看看"]);
  const pending: PendingAction = {
    type: "agree-plan",
    keywords,
    platforms,
    createdAt: deps.now().toISOString(),
    card: {
      keywordsEn: intent.keywordsEn ? wordList(intent.keywordsEn) : undefined,
      mustInclude: intent.mustInclude ? wordList(intent.mustInclude) : undefined,
      exclude: intent.exclude ? wordList(intent.exclude) : undefined,
      timeWindow: intent.timeWindow === "1d" || intent.timeWindow === "7d" ? intent.timeWindow : undefined,
      itemCount: typeof intent.itemCount === "number" ? intent.itemCount : undefined,
      audience: intent.audience && audiences.has(intent.audience as ThemeAudience) ? intent.audience : undefined,
    },
  };
  return placePending(deps, topicId, pending, intent.answer || "请到设置里确认这份调研方案。", []);
}

async function replyResearch(deps: AppDeps, topicId: string, folder: string, theme: ThemeFile, intent: ModelIntent) {
  if (theme.status !== "confirmed") {
    await appendMessage(deps, topicId, { role: "assistant", content: "请先同意调研方案。可以在对话里把方案确定下来，或在设置里点确认计划。", citations: [] });
    return { messages: await readChat(deps, topicId), pending: await readPending(deps, topicId) };
  }
  return rememberAction(deps, topicId, folder, intent, "research");
}

async function replyTrack(deps: AppDeps, topicId: string, folder: string, theme: ThemeFile, snapshotCount: number, intent: ModelIntent) {
  if (theme.status !== "confirmed") {
    await appendMessage(deps, topicId, { role: "assistant", content: "请先同意调研方案。可以在对话里把方案确定下来，或在设置里点确认计划。", citations: [] });
    return { messages: await readChat(deps, topicId), pending: await readPending(deps, topicId) };
  }
  if (snapshotCount === 0) {
    await appendMessage(deps, topicId, { role: "assistant", content: "请先完成一次调研。", citations: [] });
    return { messages: await readChat(deps, topicId), pending: await readPending(deps, topicId) };
  }
  return rememberAction(deps, topicId, folder, intent, "track");
}

async function rememberAction(deps: AppDeps, topicId: string, folder: string, intent: ModelIntent, type: "research" | "track") {
  const pending: PendingAction = { type, keywords: [], platforms: [], createdAt: deps.now().toISOString() };
  const citations = await verifiedCitations(folder, intent.citations ?? []);
  return placePending(deps, topicId, pending, intent.answer || "请到设置里确认这一次动作。", citations);
}

async function placePending(deps: AppDeps, topicId: string, pending: PendingAction, content: string, citations: StoredChat["citations"]) {
  const previous = await readPending(deps, topicId);
  const notice = previous ? SUPERSEDE : "";
  await writePending(deps, topicId, pending);
  await appendMessage(deps, topicId, { role: "assistant", content: `${notice}${content}`, citations });
  return { messages: await readChat(deps, topicId), pending };
}

async function contextMessages(deps: AppDeps, folder: string, theme: ThemeFile, history: StoredChat[], question: string, tokenBudget: number): Promise<{ messages: ChatMessage[]; tokens: number; over: boolean }> {
  const briefs = await listBriefs(folder);
  const snapshots = await listSnapshots(folder);
  const catalog = await discoverCatalog(deps, false).catch(() => null);
  const selected = new Set(theme.platforms.filter((platform) => platform.selected).map((platform) => platform.command));
  const selectable = (catalog?.commands ?? []).filter((entry) => entry.selectable);
  const scoped = selected.size > 0 ? selectable.filter((entry) => selected.has(entry.command)) : selectable.slice(0, 12);
  const commands = scoped.slice(0, 12).map((entry) => ({ command: entry.command, description: entry.description }));
  const latestBrief = (briefs.at(-1)?.body ?? "").slice(0, 1_800);
  const latest = snapshots.at(-1);
  const events = (latest?.events ?? []).slice(0, 20).map((event) => {
    const item = latest?.items.find((candidate) => candidate.id === event.itemIds[0]);
    return { title: event.title, url: item?.url ?? "" };
  });
  const themeView = { ...theme, reported: theme.reported.slice(-8) };
  const keptHistory = history.slice(-12).map((message) => ({ role: message.role, content: message.content.slice(0, 500) }));
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: "你在帮用户确认主题卡。信息不够就反问，不要催着立刻搜索。平台从 commands 里推荐并说明理由，不能写 commands 以外的名字。方案清楚后 intent 用 propose-plan，keywords 放中文检索词，并尽量给出 keywordsEn、mustInclude、exclude、timeWindow（1d 或 7d）、itemCount（5 到 7）、audience（学生、从业者、管理层、随便看看）。请用户到设置确认。用户要调研时 intent 用 research，已有调研且用户要看时间窗里的热点时 intent 用 track。讨论用 discuss。用户要整理已有链接或素材时 intent 用 organize，url 和 materialPath 只能抄资料里出现的地址，不要假设笔记已经写好。拿不准就不要编新的 intent。不要调用搜索命令。只输出 JSON：{\"intent\":\"discuss|propose-plan|research|track|organize\",\"answer\":string,\"citations\":[{\"type\":\"file\",\"path\":string}|{\"type\":\"url\",\"url\":string}],\"keywords\":string[],\"keywordsEn\":string[],\"mustInclude\":string[],\"exclude\":string[],\"timeWindow\":string,\"itemCount\":number,\"audience\":string,\"platforms\":string[],\"url\":string,\"materialPath\":string}。citations 只能抄资料里出现的路径或链接。",
    },
    ...keptHistory,
    {
      role: "user",
      content: JSON.stringify({
        question,
        phase: snapshots.length === 0 ? (theme.status === "confirmed" ? "ready" : "planning") : "tracking",
        snapshotCount: snapshots.length,
        commands,
        theme: themeView,
        latestBrief,
        events,
      }),
    },
  ];
  let tokens = messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
  while (tokens > tokenBudget && messages.length > 2) {
    const removed = messages.splice(1, 1)[0];
    tokens -= removed ? estimateTokens(removed.content) : 0;
  }
  return { messages, tokens, over: tokens > tokenBudget };
}

async function verifiedCitations(folder: string, citations: { type?: string; path?: string; url?: string }[]): Promise<StoredChat["citations"]> {
  const snapshots = await listSnapshots(folder);
  const urls = new Set(snapshots.flatMap((snapshot) => snapshot.items.map((item) => item.url)));
  const kept: StoredChat["citations"] = [];
  for (const citation of citations) {
    if (citation.type === "file" && citation.path && isInsideFolder(folder, citation.path)) {
      try {
        await readFile(path.resolve(folder, citation.path));
        kept.push({ type: "file", path: citation.path.replaceAll("\\", "/") });
      } catch {
        continue;
      }
    }
    if (citation.type === "url" && citation.url && urls.has(citation.url)) {
      kept.push({ type: "url", url: citation.url });
    }
  }
  return kept;
}

async function appendMessage(deps: AppDeps, topicId: string, message: Omit<StoredChat, "id" | "createdAt">): Promise<void> {
  const file = topicChatPath(deps, topicId);
  await mkdir(path.dirname(file), { recursive: true });
  const row: StoredChat = { ...message, id: crypto.randomUUID(), createdAt: deps.now().toISOString() };
  await appendFile(file, `${JSON.stringify(row)}\n`, "utf8");
}

function wordList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((word) => word.trim()).filter(Boolean))].slice(0, 20);
}
