import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { isPhaseName, type PhaseName } from "../budget.js";
import { listSnapshots, type SnapshotFile } from "../topic/archive.js";
import { readRegistry } from "../topic/store.js";
import type { AppDeps } from "../types.js";

export interface JobStep {
  command: string;
  keyword: string;
  state: "pending" | "running" | "success" | "failed";
}

export interface JobState {
  id: string;
  topicId: string;
  kind: "collect" | "research" | "track" | "morning";
  state: "running" | "succeeded" | "failed" | "incomplete";
  startedAt: string;
  finishedAt: string | null;
  snapshotId: string | null;
  error: string | null;
  steps: JobStep[];
  phase: PhaseName;
  nominalDate: string | null;
}

export function jobPath(deps: AppDeps, topicId: string): string {
  return path.join(deps.dataDir, "topics", topicId, "job.json");
}

export async function readJob(deps: AppDeps, topicId: string): Promise<JobState | null> {
  try {
    return coerceJob(JSON.parse(await readFile(jobPath(deps, topicId), "utf8")));
  } catch {
    return null;
  }
}

export async function writeJob(deps: AppDeps, job: JobState): Promise<void> {
  await writeJson(jobPath(deps, job.topicId), job);
}

export async function holdMorning(deps: AppDeps, topicId: string, nominal: string): Promise<void> {
  const file = holdPath(deps, topicId);
  let dates: string[] = [];
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (Array.isArray(parsed)) dates = parsed.filter((item): item is string => typeof item === "string");
  } catch {
    dates = [];
  }
  if (dates.includes(nominal)) return;
  dates.push(nominal);
  await writeJson(file, dates);
}

export async function morningHeld(deps: AppDeps, topicId: string, nominal: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(await readFile(holdPath(deps, topicId), "utf8")) as unknown;
    return Array.isArray(parsed) && parsed.includes(nominal);
  } catch {
    return false;
  }
}

export async function recoverJobs(deps: AppDeps, jobs: Map<string, JobState>): Promise<void> {
  const registry = await readRegistry(deps);
  for (const record of registry.topics) {
    if (jobs.has(record.id)) continue;
    const job = await readJob(deps, record.id);
    if (!job) continue;
    if (job.state === "running") {
      const snapshots = await listSnapshots(record.folderPath).catch(() => []);
      const done = snapshots.find((snapshot) => snapshotFinishesJob(snapshot, job));
      if (done) {
        job.state = "succeeded";
        job.snapshotId = done.id;
        job.error = null;
        job.finishedAt = job.finishedAt ?? deps.now().toISOString();
      } else {
        job.state = "incomplete";
        job.finishedAt = deps.now().toISOString();
        job.error = `已停在${job.phase}·上次未完成，没有自动重跑`;
        if (job.kind === "morning" && job.nominalDate) await holdMorning(deps, job.topicId, job.nominalDate);
      }
      await writeJob(deps, job);
    }
    jobs.set(record.id, job);
  }
}

export function morningAlreadySettled(job: JobState | undefined, nominal: string): boolean {
  if (!job || job.kind !== "morning" || job.nominalDate !== nominal) return false;
  if (job.state === "incomplete") return true;
  return job.state === "failed" && (job.error ?? "").startsWith("已停在");
}

function holdPath(deps: AppDeps, topicId: string): string {
  return path.join(deps.dataDir, "topics", topicId, "morning-hold.json");
}

async function writeJson(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.tmp`;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
  await rename(temporary, file);
}

function snapshotFinishesJob(snapshot: SnapshotFile, job: JobState): boolean {
  if (snapshot.trigger !== job.kind) return false;
  if (job.nominalDate && snapshot.nominalDate !== job.nominalDate) return false;
  const started = Date.parse(job.startedAt);
  const collected = Date.parse(snapshot.collectedAt);
  if (Number.isNaN(started) || Number.isNaN(collected)) return false;
  return collected >= started - 1_000;
}

function coerceJob(value: unknown): JobState | null {
  if (!value || typeof value !== "object") return null;
  const job = value as JobState;
  if (!job.id || !job.topicId || !job.kind || !job.state) return null;
  if (!isPhaseName(job.phase)) job.phase = "采集";
  job.steps ??= [];
  job.nominalDate ??= null;
  job.error ??= null;
  job.snapshotId ??= null;
  job.finishedAt ??= null;
  return job;
}
