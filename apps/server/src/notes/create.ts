import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isInsideFolder } from "@followup/core";
import { bad } from "../http-error.js";
import { extractJson } from "../model/json.js";
import { DIR_MATERIAL, type AppDeps } from "../types.js";
import { listSnapshots, snapshotStamp } from "../topic/archive.js";

const BODY_LIMIT = 20_000;

export interface NoteTarget {
  url?: string;
  materialPath?: string;
}

export type NotePreview =
  | { ok: true; target: NoteTarget; preview: string }
  | { ok: false; message: string };

const NOT_ALLOWED = "这条链接不在已采集结果或素材里，不会抓取。";

export async function previewNoteTarget(folder: string, target: NoteTarget): Promise<NotePreview> {
  const url = target.url?.trim() ?? "";
  const materialPath = target.materialPath?.trim().replaceAll("\\", "/") ?? "";
  if (!url && !materialPath) return { ok: false, message: "请给出一条已采集的链接，或主题素材里的文件。" };
  if (materialPath) {
    if (!isInsideFolder(folder, materialPath) || !materialPath.startsWith("素材/")) {
      return { ok: false, message: "只能读取这个主题文件夹里的文件。" };
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(path.resolve(folder, materialPath));
    } catch {
      return { ok: false, message: "这份材料还不能解析出正文。" };
    }
    if (bytes.includes(0) || bytes.length === 0) return { ok: false, message: "这份材料还不能解析出正文。" };
    const excerpt = bytes.toString("utf8").replace(/\s+/g, " ").trim().slice(0, 120);
    return {
      ok: true,
      target: { materialPath },
      preview: `将写入笔记\n来源：${materialPath}\n摘录：${excerpt}\n确认后才会写入。`,
    };
  }
  if (!/^https?:\/\//i.test(url)) return { ok: false, message: "请给出一条已采集的链接，或主题素材里的文件。" };
  const allowed = await allowedNoteUrls(folder);
  if (!allowed.has(url)) return { ok: false, message: NOT_ALLOWED };
  const title = allowed.get(url);
  const titleLine = title ? `\n标题：${title}` : "";
  return {
    ok: true,
    target: { url },
    preview: `将写入笔记\n来源：${url}${titleLine}\n确认后才会打开链接并写入。`,
  };
}

async function allowedNoteUrls(folder: string): Promise<Map<string, string>> {
  const allowed = new Map<string, string>();
  const snapshots = await listSnapshots(folder).catch(() => []);
  for (const snapshot of snapshots) {
    for (const item of snapshot.items) {
      if (/^https?:\/\//i.test(item.url)) allowed.set(item.url, item.title);
    }
  }
  const names = await readdir(path.join(folder, DIR_MATERIAL)).catch(() => []);
  for (const name of names) {
    if (!name.endsWith(".url")) continue;
    const text = await readFile(path.join(folder, DIR_MATERIAL, name), "utf8").catch(() => "");
    const saved = text.trim();
    if (/^https?:\/\//i.test(saved) && !allowed.has(saved)) allowed.set(saved, "");
  }
  return allowed;
}

export interface BodyReader {
  id: string;
  supports(target: NoteTarget): boolean;
  read(target: NoteTarget, deps: AppDeps, folder: string): Promise<{ text: string }>;
}

export function builtinReaders(): BodyReader[] {
  return [materialTextReader(), htmlArticleReader()];
}

export function pickReader(readers: readonly BodyReader[], target: NoteTarget): BodyReader | null {
  return readers.find((reader) => reader.supports(target)) ?? null;
}

export async function createNote(deps: AppDeps, folder: string, target: NoteTarget, readers = builtinReaders()): Promise<string> {
  const url = target.url?.trim() ?? "";
  const materialPath = target.materialPath?.trim() ?? "";
  if (!url && !materialPath) throw bad(400, "NOTE_EMPTY", "请给出一条链接。");
  if (url && !/^https?:\/\//i.test(url)) throw bad(400, "NOTE_EMPTY", "请给出一条链接。");
  if (url && !(await allowedNoteUrls(folder)).has(url)) throw bad(400, "NOTE_EMPTY", NOT_ALLOWED);
  const reader = pickReader(readers, { url, materialPath });
  if (!reader) throw bad(422, "NOTE_UNPARSED", "这份材料还不能解析出正文。");
  let text = "";
  try {
    text = (await reader.read({ url, materialPath }, deps, folder)).text.trim();
  } catch (error) {
    if (error instanceof Error && "status" in error) throw error;
    throw bad(422, "NOTE_UNPARSED", "这份材料还不能解析出正文。");
  }
  if (!text) throw bad(422, "NOTE_UNPARSED", "这份材料还不能解析出正文。");
  const truncated = [...text].length > BODY_LIMIT;
  const body = truncated ? `${[...text].slice(0, BODY_LIMIT).join("")}\n\n（正文已截断，原长超过 20000 字）` : text;
  const title = body.split(/\r?\n/).find((line) => line.trim())?.trim().slice(0, 24) || "笔记";
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, "").trim() || "笔记";
  const existing = new Set(await readdir(path.join(folder, "笔记")).catch(() => []));
  const stem = snapshotStamp(deps.now(), deps.timeZone, existing);
  const relative = path.join("笔记", `${stem}-${safeTitle}.md`);
  const source = url || materialPath;
  const file = `---\nsource: ${JSON.stringify(source)}\nsourceKind: ${url ? "url" : "material"}\nbodyKind: text\ncreatedAt: ${JSON.stringify(deps.now().toISOString())}\ntruncated: ${truncated}\n---\n\n${body}\n`;
  await writeFile(path.join(folder, relative), file, "utf8");
  return relative.replaceAll("\\", "/");
}

function materialTextReader(): BodyReader {
  return {
    id: "material-text",
    supports(target) {
      return Boolean(target.materialPath) && !target.url;
    },
    async read(target, _deps, folder) {
      const relative = target.materialPath ?? "";
      if (!isInsideFolder(folder, relative) || !relative.replaceAll("\\", "/").startsWith("素材/")) {
        throw bad(400, "PATH_ESCAPE", "只能读取这个主题文件夹里的文件。");
      }
      const absolute = path.resolve(folder, relative);
      const bytes = await readFile(absolute);
      if (bytes.includes(0) || bytes.length === 0) throw bad(422, "NOTE_UNPARSED", "这份材料还不能解析出正文。");
      return { text: bytes.toString("utf8") };
    },
  };
}

function htmlArticleReader(): BodyReader {
  return {
    id: "html-article",
    supports(target) {
      return Boolean(target.url && /^https?:\/\//i.test(target.url));
    },
    async read(target, deps) {
      const page = await readHttpText(deps, target.url ?? "");
      if (!deps.model.available) throw bad(422, "NOTE_UNPARSED", "这份材料还不能解析出正文。");
      const reply = await deps.model.complete([
        { role: "system", content: "从给定页面文本抽出可读正文。只输出 JSON：{\"text\": string }。不要写五章节长文。" },
        { role: "user", content: page.slice(0, 20_000) },
      ]);
      const parsed = extractJson(reply) as { text?: string };
      return { text: parsed.text ?? "" };
    },
  };
}

async function readHttpText(deps: AppDeps, url: string): Promise<string> {
  let current = url;
  for (let hop = 0; hop < 3; hop += 1) {
    const response = await deps.fetchImpl(current, { redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || !/^https?:\/\//i.test(location)) break;
      current = location;
      continue;
    }
    if (!response.ok) throw bad(422, "NOTE_UNPARSED", "这份材料还不能解析出正文。");
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("text/html") && !type.includes("text/plain")) {
      throw bad(422, "NOTE_UNPARSED", "这份材料还不能解析出正文。");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return new TextDecoder().decode(bytes.slice(0, 2_000_000));
  }
  throw bad(422, "NOTE_UNPARSED", "这份材料还不能解析出正文。");
}

export async function saveMaterialUrl(deps: AppDeps, folder: string, url: string): Promise<string> {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) throw bad(400, "NOTE_EMPTY", "请给出一条链接。");
  const existing = new Set(await readdir(path.join(folder, DIR_MATERIAL)).catch(() => []));
  const stem = snapshotStamp(deps.now(), deps.timeZone, existing);
  const relative = path.join(DIR_MATERIAL, `${stem}.url`);
  await writeFile(path.join(folder, relative), `${trimmed}\n`, "utf8");
  return relative.replaceAll("\\", "/");
}
