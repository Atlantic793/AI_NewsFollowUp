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

function minutes(hhmm: string): number {
  const [hour, minute] = hhmm.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}
