import { catchupNominalDate } from "@followup/core";
import type { AppDeps } from "../types.js";
import { listSnapshots } from "../topic/archive.js";
import { readRegistry, readTheme } from "../topic/store.js";
import { morningAlreadySettled, morningHeld, type JobState } from "../jobs/job-store.js";

export async function runDueTopics(
  deps: AppDeps,
  jobs: Map<string, JobState>,
  startJob: (topicId: string, kind: JobState["kind"], nominalDate: string | null) => Promise<void>,
): Promise<void> {
  const registry = await readRegistry(deps);
  for (const record of registry.topics) {
    let theme;
    try {
      theme = await readTheme(record.folderPath);
    } catch {
      continue;
    }
    if (theme.status !== "confirmed" || !theme.morningReport.enabled || !theme.morningReport.time) continue;
    const snapshots = await listSnapshots(record.folderPath);
    if (snapshots.length === 0) continue;
    if (jobs.get(record.id)?.state === "running") continue;
    const morningNominals = snapshots
      .filter((snapshot) => snapshot.trigger === "morning" && snapshot.nominalDate)
      .map((snapshot) => snapshot.nominalDate as string);
    const nominal = catchupNominalDate(deps.now(), theme.morningReport.time, morningNominals, deps.timeZone);
    if (!nominal || morningAlreadySettled(jobs.get(record.id), nominal) || await morningHeld(deps, record.id, nominal)) continue;
    try {
      await startJob(record.id, "morning", nominal);
    } catch {
      continue;
    }
  }
}
