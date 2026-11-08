import { request } from "./api";
import type { RunState } from "./types";

export async function startRun(ids?: readonly string[]): Promise<void> {
  await request("/api/ledger/run", { method: "POST", body: JSON.stringify(ids ? { ids } : {}) });
}

export async function waitRun(onTick?: (run: RunState) => void): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const body = await request<{ run: RunState }>("/api/ledger/sources");
    onTick?.(body.run);
    if (body.run.state !== "running") {
      if (body.run.error) throw new Error(body.run.error);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("这一轮太久了，采集页还能看到进度。");
}
