import { applyGroups, type LabeledItem } from "@followup/core";
import { extractJson } from "../model/json.js";
import type { ModelClient, RawItem } from "../types.js";

export async function assignEventKeys(
  items: readonly (RawItem & { id: string })[],
  model: ModelClient,
): Promise<{ eventKeyById: Map<string, string>; degraded: boolean; truncated: boolean }> {
  const eventKeyById = new Map<string, string>();
  if (items.length === 0) return { eventKeyById, degraded: false, truncated: false };
  if (items.length === 1) {
    eventKeyById.set(items[0]!.id, "g0");
    return { eventKeyById, degraded: false, truncated: false };
  }
  const truncated = items.length > 120;
  const sample = items.slice(0, 120);
  if (!model.available) {
    for (const item of items) eventKeyById.set(item.id, `solo:${item.id}`);
    return { eventKeyById, degraded: true, truncated };
  }
  try {
    const reply = await model.complete([
      {
        role: "system",
        content: "把同一件事分组。标题明显不是同一件事的 id 分开。只输出 JSON：{\"groups\": string[][] }。groups 必须正好覆盖每个 id 一次。",
      },
      {
        role: "user",
        content: JSON.stringify({
          items: sample.map((item) => ({
            id: item.id,
            title: item.title,
            summary: item.summary,
            platform: item.platform,
          })),
        }),
      },
    ]);
    const parsed = extractJson(reply) as { groups?: string[][] };
    const applied = applyGroups(sample.map((item) => ({ id: item.id })), parsed.groups ?? []);
    for (const row of applied.assignments) eventKeyById.set(row.id, row.eventKey);
    for (const item of items.slice(120)) eventKeyById.set(item.id, `solo:${item.id}`);
    return { eventKeyById, degraded: applied.degraded, truncated };
  } catch {
    for (const item of items) eventKeyById.set(item.id, `solo:${item.id}`);
    return { eventKeyById, degraded: true, truncated };
  }
}

export function toLabeled(items: readonly (RawItem & { id: string })[], keys: Map<string, string>): LabeledItem[] {
  return items.map((item) => ({
    id: item.id,
    eventKey: keys.get(item.id) ?? `solo:${item.id}`,
    title: item.title,
    url: item.url,
    platform: item.platform,
  }));
}
