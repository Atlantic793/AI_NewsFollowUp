export function zonedParts(date: Date, timeZone: string): { date: string; hm: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${read("year")}-${read("month")}-${read("day")}`,
    hm: `${read("hour").padStart(2, "0")}:${read("minute").padStart(2, "0")}`,
  };
}

export function addCalendarDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const shifted = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days));
  return shifted.toISOString().slice(0, 10);
}

export function catchupNominalDate(
  now: Date,
  hhmm: string,
  existingNominalDates: readonly string[],
  timeZone: string,
): string | null {
  const { date, hm } = zonedParts(now, timeZone);
  const opened = minutes(hm) + 30 >= minutes(hhmm);
  const candidate = opened ? date : addCalendarDays(date, -1);
  if (existingNominalDates.includes(candidate)) return null;
  return candidate;
}

export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const ABSOLUTE_DATE = /(20\d{2})\s*[年/\-.]\s*(\d{1,2})\s*[月/\-.]\s*(\d{1,2})\s*日?(?:[\sT]*(\d{1,2})\s*(?:[:：]|时)\s*(\d{1,2})?)?/;
const RELATIVE_ZH = /(\d+)\s*(分钟|小时|天)前/;
const RELATIVE_EN = /(\d+)\s*(minute|hour|day)s?\s+ago/i;

export function dateInText(text: string, now = new Date()): string | null {
  const absolute = ABSOLUTE_DATE.exec(text);
  if (absolute) {
    const year = Number(absolute[1]);
    const month = Number(absolute[2]);
    const day = Number(absolute[3]);
    const hour = absolute[4] ? Number(absolute[4]) : 0;
    const minute = absolute[5] ? Number(absolute[5]) : 0;
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
    const parsed = new Date(year, month - 1, day, hour, minute);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (text.includes("昨天")) return new Date(now.getTime() - 86_400_000).toISOString();
  const chinese = RELATIVE_ZH.exec(text);
  if (chinese) return new Date(now.getTime() - relativeMs(Number(chinese[1]), chinese[2] ?? "")).toISOString();
  const english = RELATIVE_EN.exec(text);
  if (english) return new Date(now.getTime() - relativeMs(Number(english[1]), english[2] ?? "")).toISOString();
  return null;
}

function relativeMs(amount: number, unit: string): number {
  const name = unit.toLowerCase();
  if (name.startsWith("minute") || name === "分钟") return amount * 60_000;
  if (name.startsWith("hour") || name === "小时") return amount * 3_600_000;
  return amount * 86_400_000;
}

function minutes(hhmm: string): number {
  const [hour, minute] = hhmm.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}
