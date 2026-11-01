export type HeatStage = "爆发" | "高峰" | "衰退" | "长尾";

export type Audience = "学生" | "从业者" | "管理层" | "随便看看";

export interface HotspotFactor {
  label: string;
  note: string;
}

export interface HotspotRecord {
  eventKey: string;
  title: string;
  url: string;
  summary: string;
  platforms: string[];
  score: number;
  stage: HeatStage;
  factors: HotspotFactor[];
  discussion: string;
}

export interface HotspotCandidate {
  eventKey: string;
  title: string;
  url: string;
  summary: string;
  platforms: string[];
  publishedAt: string;
  priorAppearances: number;
  priorSourceCount: number;
  priorStage: HeatStage | null;
}

export interface ReportedHotspot {
  eventKey: string;
  stage: HeatStage;
}

export interface HotspotSelection {
  events: HotspotRecord[];
  windowLabel: string;
  quiet: boolean;
}

const CLUE = /weibo|twitter|reddit|xiaohongshu|xhs|bilibili|tieba|discord|sinablog|wechat|douyin|tiktok|nowcoder/i;
const CLICKBAIT = /震惊|必看|转载|重磅/;

export function titleKey(title: string): string {
  return title.trim().toLocaleLowerCase().replace(/\s+/g, "");
}

export function isCluePlatform(platform: string): boolean {
  return CLUE.test(platform);
}

export function blockedByExclude(title: string, summary: string, exclude: readonly string[]): boolean {
  const text = `${title}\n${summary}`.toLocaleLowerCase();
  return exclude.some((term) => term.trim() && text.includes(term.trim().toLocaleLowerCase()));
}

export function buildQueries(input: {
  keywords: readonly string[];
  keywordsEn: readonly string[];
  mustInclude: readonly string[];
}): string[] {
  const queries: string[] = [];
  const push = (value: string) => {
    const query = value.trim();
    if (!query || query.length > 80 || queries.includes(query) || queries.length >= 15) return;
    queries.push(query);
  };
  for (const keyword of input.keywords) push(keyword);
  for (const keyword of input.keywordsEn) push(keyword);
  for (const keyword of input.keywords) {
    for (const entity of input.mustInclude) push(`${keyword} ${entity}`);
  }
  return queries;
}

export type DropReason = "没有日期" | "过了时间窗" | "和主题对不上" | "未打开";

export const OPEN_CAP = 12;

export interface WindowDropCounts {
  outside: number;
  noDate: number;
  offTopic: number;
}

export function screenByWindow<T extends { title: string; summary: string; publishedAt: string }>(input: {
  now: Date;
  days: number;
  keywords: readonly string[];
  mustInclude: readonly string[];
  exclude: readonly string[];
  items: readonly T[];
}): { kept: T[]; marked: { item: T; drop?: DropReason }[]; counts: WindowDropCounts } {
  const needles = [...input.keywords, ...input.mustInclude].map((term) => term.trim().toLocaleLowerCase()).filter(Boolean);
  const counts: WindowDropCounts = { outside: 0, noDate: 0, offTopic: 0 };
  const marked: { item: T; drop?: DropReason }[] = [];
  for (const item of input.items) {
    const drop = reasonFor(item, input.now, input.days, needles, input.exclude);
    if (!drop) {
      marked.push({ item });
      continue;
    }
    marked.push({ item, drop });
    switch (drop) {
      case "没有日期":
        counts.noDate += 1;
        break;
      case "过了时间窗":
        counts.outside += 1;
        break;
      case "和主题对不上":
        counts.offTopic += 1;
        break;
      case "未打开":
        break;
      default: {
        const unreachable: never = drop;
        return unreachable;
      }
    }
  }
  return { kept: marked.flatMap((row) => (row.drop ? [] : [row.item])), marked, counts };
}

export function selectHotspots(input: {
  now: Date;
  timeWindow: number;
  itemCount: number;
  mustInclude: readonly string[];
  exclude: readonly string[];
  candidates: readonly HotspotCandidate[];
  reported: readonly ReportedHotspot[];
  mode: "hotspot" | "daily";
}): HotspotSelection {
  const allowed = input.candidates.filter((candidate) => !blockedByExclude(candidate.title, candidate.summary, input.exclude));
  const pool = allowed.flatMap((candidate) => {
    const age = ageHours(candidate.publishedAt, input.now);
    return age !== null && age <= input.timeWindow * 24 ? [candidate] : [];
  });
  const ranked = pool
    .flatMap((candidate) => scoreCandidate(candidate, input.now, input.mustInclude))
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, "zh"));
  const unseen = input.mode === "daily"
    ? ranked.filter((event) => {
      const memory = input.reported.find((item) => item.eventKey === event.eventKey);
      return !memory || memory.stage !== event.stage;
    })
    : ranked;
  const events = unseen.slice(0, Math.min(7, Math.max(5, input.itemCount)));
  return {
    events,
    windowLabel: `过去 ${input.timeWindow} 天`,
    quiet: events.length === 0,
  };
}

export function freshnessDrop(
  item: { title: string; summary: string; publishedAt: string },
  now: Date,
  days: number,
  exclude: readonly string[],
): DropReason | null {
  if (blockedByExclude(item.title, item.summary, exclude)) return "和主题对不上";
  const age = ageHours(item.publishedAt, now);
  if (age !== null && age > days * 24) return "过了时间窗";
  return null;
}

export function openGate(
  item: { title: string; summary: string; publishedAt: string },
  now: Date,
  days: number,
  exclude: readonly string[],
): DropReason | null {
  const age = ageHours(item.publishedAt, now);
  if (age === null) return "没有日期";
  if (age > days * 24) return "过了时间窗";
  if (blockedByExclude(item.title, item.summary, exclude)) return "和主题对不上";
  return null;
}

export function takeToOpen<T>(items: readonly T[], cap = OPEN_CAP): { open: T[]; held: T[] } {
  return { open: items.slice(0, cap), held: items.slice(cap) };
}

export function topicDrop(input: {
  title: string;
  summary: string;
  body: string;
  keywords: readonly string[];
  mustInclude: readonly string[];
  exclude: readonly string[];
}): DropReason | null {
  const body = input.body.trim();
  if (blockedByExclude(input.title, `${input.summary}\n${body}`, input.exclude)) return "和主题对不上";
  const needles = [...input.keywords, ...input.mustInclude].map((term) => term.trim().toLocaleLowerCase()).filter(Boolean);
  if (needles.length === 0) return null;
  const corpus = (body || `${input.title}\n${input.summary}`).toLocaleLowerCase();
  return needles.some((needle) => corpus.includes(needle)) ? null : "和主题对不上";
}

function reasonFor(
  item: { title: string; summary: string; publishedAt: string },
  now: Date,
  days: number,
  needles: readonly string[],
  exclude: readonly string[],
): DropReason | null {
  const gated = openGate(item, now, days, exclude);
  if (gated) return gated;
  if (needles.length === 0) return null;
  const text = `${item.title}\n${item.summary}`.toLocaleLowerCase();
  return needles.some((needle) => text.includes(needle)) ? null : "和主题对不上";
}

function scoreCandidate(candidate: HotspotCandidate, now: Date, mustInclude: readonly string[]): HotspotRecord[] {
  if (!/^https?:\/\//i.test(candidate.url)) return [];
  if (candidate.platforms.length === 0 || candidate.platforms.every((platform) => isCluePlatform(platform))) return [];
  const age = ageHours(candidate.publishedAt, now);
  if (age === null) return [];
  const stage = classify(candidate.priorAppearances, candidate.platforms.length, candidate.priorSourceCount);
  const changed = candidate.priorStage !== null && candidate.priorStage !== stage;
  const text = `${candidate.title}\n${candidate.summary}`;
  const relevance = relevanceScore(text, mustInclude);
  const factors: HotspotFactor[] = [
    { label: "来源", note: `${candidate.platforms.length} 个独立信源` },
    { label: "时效", note: age < 1 ? "不到 1 小时" : `${Math.round(age)} 小时内` },
  ];
  if (relevance.note) factors.push({ label: "相关", note: relevance.note });
  factors.push(
    { label: "持续", note: `已出现 ${candidate.priorAppearances + 1} 次` },
    { label: "新进展", note: candidate.priorAppearances === 0 ? "新出现" : changed ? "阶段有变化" : "阶段未变" },
  );
  const score = Math.max(0, sourceScore(candidate.platforms.length) + recencyScore(age) + relevance.score + continuityScore(candidate.priorAppearances + 1) + (candidate.priorAppearances === 0 || changed ? 15 : 5));
  return [{
    eventKey: candidate.eventKey,
    title: candidate.title,
    url: candidate.url,
    summary: candidate.summary,
    platforms: candidate.platforms,
    score,
    stage,
    factors,
    discussion: candidate.platforms.filter((platform) => !isCluePlatform(platform)).length >= 2
      ? "多个信源都提到了这件事。"
      : "目前只有一个信源，先当作线索来看。",
  }];
}

function classify(priorAppearances: number, sourceCount: number, priorSourceCount: number): HeatStage {
  if (priorAppearances === 0) return "爆发";
  if (sourceCount < priorSourceCount) return "衰退";
  if (priorAppearances >= 3 && sourceCount <= priorSourceCount) return "长尾";
  return "高峰";
}

function sourceScore(count: number): number {
  if (count >= 4) return 30;
  if (count === 3) return 24;
  if (count === 2) return 16;
  return 8;
}

function recencyScore(hours: number): number {
  if (hours <= 6) return 25;
  if (hours <= 24) return 18;
  if (hours <= 72) return 12;
  return 5;
}

function continuityScore(times: number): number {
  if (times >= 4) return 15;
  if (times === 3) return 12;
  if (times === 2) return 8;
  return 4;
}

function relevanceScore(text: string, mustInclude: readonly string[]): { score: number; note: string } {
  const folded = text.toLocaleLowerCase();
  const hit = mustInclude.some((term) => term.trim() && folded.includes(term.trim().toLocaleLowerCase()));
  let score = hit ? 15 : 0;
  const notes: string[] = [];
  if (hit) notes.push("命中必须项");
  else if (mustInclude.length > 0) notes.push("未命中必须项");
  if (CLICKBAIT.test(text)) {
    score -= 10;
    notes.push("标题党或转载");
  }
  return { score, note: notes.join("，") };
}

function ageHours(publishedAt: string, now: Date): number | null {
  const time = Date.parse(publishedAt);
  if (Number.isNaN(time)) return null;
  return Math.max(0, (now.getTime() - time) / 3_600_000);
}
