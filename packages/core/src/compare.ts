import type { NewSource, Verdict } from "./types.js";

export function dedupeByUrl<T extends { url: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const item of items) {
    const key = item.url.normalize("NFC").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(item);
  }
  return kept;
}

export function countVerdicts(verdicts: readonly Verdict[], newSources: readonly NewSource[]) {
  return {
    appeared: verdicts.filter((verdict) => verdict.kind === "appeared").length,
    heating: verdicts.filter((verdict) => verdict.kind === "heating").length,
    ongoing: verdicts.filter((verdict) => verdict.kind === "ongoing").length,
    fading: verdicts.filter((verdict) => verdict.kind === "fading").length,
    newSources: newSources.length,
  };
}
