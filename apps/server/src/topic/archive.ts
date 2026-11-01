import { readdir, readFile, rename, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { stringify, parse } from "yaml";
import {
  countVerdicts,
  zonedParts,
  type DigestItem,
  type HotspotRecord,
  type NewSource,
  type Verdict,
} from "@followup/core";
import { DIR_BRIEF, DIR_SNAPSHOT, type RawItem } from "../types.js";

export interface StoredItem extends RawItem {
  id: string;
  eventId: string;
}

export interface SnapshotFile {
  id: string;
  topicId: string;
  collectedAt: string;
  trigger: "collect" | "research" | "track" | "morning";
  nominalDate: string | null;
  scheduledTime: string | null;
  baseline: {
    kind: string;
    snapshotId: string | null;
    collectedAt: string | null;
    comparisonDate: string | null;
    label: string;
  };
  plan: { keywords: string[]; platforms: string[] };
  platforms: {
    command: string;
    transport: "adapter" | "browser";
    status: "success" | "failed";
    error?: string;
    itemCount: number;
    loginState?: string;
  }[];
  items: StoredItem[];
  events: { id: string; title: string; itemIds: string[]; platforms: string[] }[];
  hotspots?: HotspotRecord[];
  digests?: DigestItem[];
  digestLead?: string;
  digestFollowups?: string[];
  clustering: { degraded: boolean; truncated: boolean };
}

export interface BriefFile {
  snapshotId: string;
  trigger: SnapshotFile["trigger"];
  collectedAt: string;
  hasVerdicts: boolean;
  baselineLabel: string;
  comparisonDate: string | null;
  counts: ReturnType<typeof countVerdicts>;
  verdicts: Verdict[];
  newSources: NewSource[];
  body: string;
}

export async function writeSnapshot(folder: string, snapshot: SnapshotFile): Promise<void> {
  const file = path.join(folder, DIR_SNAPSHOT, `${snapshot.id}.json`);
  await writeAtomic(file, JSON.stringify(snapshot, null, 2));
}

export async function writeBrief(folder: string, brief: BriefFile): Promise<void> {
  const { body, ...meta } = brief;
  const file = path.join(folder, DIR_BRIEF, `${brief.snapshotId}.md`);
  await writeAtomic(file, `---\n${stringify(meta).trim()}\n---\n\n${body}`);
}

export async function listSnapshots(folder: string): Promise<SnapshotFile[]> {
  const dir = path.join(folder, DIR_SNAPSHOT);
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const snapshots: SnapshotFile[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      snapshots.push(JSON.parse(await readFile(path.join(dir, name), "utf8")) as SnapshotFile);
    } catch {
      continue;
    }
  }
  return snapshots.sort((left, right) => left.collectedAt.localeCompare(right.collectedAt));
}

export async function listBriefs(folder: string): Promise<BriefFile[]> {
  const dir = path.join(folder, DIR_BRIEF);
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const briefs: BriefFile[] = [];
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    try {
      briefs.push(await readBriefFile(path.join(dir, name)));
    } catch {
      continue;
    }
  }
  return briefs.sort((left, right) => left.collectedAt.localeCompare(right.collectedAt));
}

export async function readBriefFile(file: string): Promise<BriefFile> {
  const text = await readFile(file, "utf8");
  const matched = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!matched?.[1]) throw new Error("brief");
  const meta = parse(matched[1]) as Omit<BriefFile, "body">;
  return { ...meta, body: matched[2] ?? "" };
}

export function snapshotStamp(now: Date, timeZone: string, taken: Set<string>): string {
  const parts = zonedParts(now, timeZone);
  const [hour, minute] = parts.hm.split(":");
  const second = new Intl.DateTimeFormat("en-US", {
    timeZone,
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now).find((part) => part.type === "second")?.value ?? "00";
  const stem = `${parts.date.replaceAll("-", "")}-${hour}${minute}${second.padStart(2, "0")}`;
  if (!taken.has(stem)) return stem;
  let index = 2;
  while (taken.has(`${stem}-${index}`)) index += 1;
  return `${stem}-${index}`;
}

async function writeAtomic(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, file);
}
