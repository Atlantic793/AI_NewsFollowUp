export function validatePlan(
  input: { keywords: readonly string[]; platforms: readonly string[] },
  selectable: ReadonlySet<string>,
): { ok: true; keywords: string[]; platforms: string[] } | { ok: false } {
  const keywords: string[] = [];
  for (const raw of input.keywords) {
    const keyword = raw.trim();
    if (!keyword || keyword.length > 40 || keywords.includes(keyword)) continue;
    keywords.push(keyword);
  }
  const platforms: string[] = [];
  for (const platform of input.platforms) {
    if (!selectable.has(platform) || platforms.includes(platform)) return { ok: false };
    platforms.push(platform);
  }
  if (keywords.length < 1 || keywords.length > 20 || platforms.length < 1 || platforms.length > 20) {
    return { ok: false };
  }
  return { ok: true, keywords, platforms };
}

export function normalizeUtterance(value: string): string | null {
  const utterance = value.trim();
  if (utterance.length < 1 || utterance.length > 200) return null;
  return utterance;
}
