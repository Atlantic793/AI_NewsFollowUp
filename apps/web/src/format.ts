export function formatStamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fileStamp(name: string): string | null {
  const stem = name.split("/").pop() ?? name;
  const matched = stem.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
  if (!matched?.[2] || !matched[3] || !matched[4] || !matched[5]) return null;
  return `${matched[2]}-${matched[3]} ${matched[4]}:${matched[5]}`;
}

export function stripFrontMatter(text: string): string {
  const matched = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  return matched?.[1]?.trim() ? matched[1].trim() : text;
}
