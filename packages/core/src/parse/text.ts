export interface MdTable {
  /** 表头所在行号（0 起）。 */
  line: number;
  header: string[];
  rows: string[][];
  rawHeader: string;
  rawRows: string[];
}

/** 去掉 Markdown 行内标记，保留读者看到的文字。 */
export function stripMd(value: string): string {
  return value
    .replace(/<sup>[\s\S]*?<\/sup>/gi, "")
    .replace(/\{%\s*sup\s*%\}[\s\S]*?\{%\s*\/sup\s*%\}/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/\\([[\]_*|#()-])/g, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/\u200b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitRow(line: string): string[] {
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === "\\" && body[index + 1] === "|") {
      current += "|";
      index += 1;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function isSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell));
}

/** 找出文本里所有 Markdown 表格。引用块里的表（行首 "> "）也算。 */
export function mdTables(lines: readonly string[]): MdTable[] {
  const tables: MdTable[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = unquote(lines[index] ?? "");
    const next = unquote(lines[index + 1] ?? "");
    if (line.startsWith("|") && next.startsWith("|") && isSeparator(splitRow(next))) {
      const table: MdTable = { line: index, header: splitRow(line).map(stripMd), rows: [], rawHeader: line, rawRows: [] };
      index += 2;
      while (index < lines.length && unquote(lines[index] ?? "").startsWith("|")) {
        const raw = unquote(lines[index] ?? "");
        table.rows.push(splitRow(raw).map(stripMd));
        table.rawRows.push(raw);
        index += 1;
      }
      tables.push(table);
      continue;
    }
    index += 1;
  }
  return tables;
}

export function unquote(line: string): string {
  return line.replace(/^\s*(?:>\s?)+/, "").trim();
}

/** 截一段原文给右栏看，保留换行。 */
export function excerptOf(...parts: string[]): string {
  return parts.map((part) => part.replace(/[ \t]{2,}/g, " ").trim()).filter(Boolean).join("\n").slice(0, 1200);
}

/** 从 text[start] 的 "{" 或 "[" 起读出一段配平的 JSON 文本，字符串里的括号不算。 */
export function readJsonAt(text: string, start: number): string {
  const open = text[start];
  if (open !== "{" && open !== "[") return "";
  let depth = 0;
  let quoted = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === "\\") index += 1;
      else if (char === "\"") quoted = false;
      continue;
    }
    if (char === "\"") quoted = true;
    else if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return "";
}

export function lastHeading(lines: readonly string[], before: number): string {
  for (let index = before - 1; index >= 0; index -= 1) {
    const line = (lines[index] ?? "").trim();
    if (/^#{1,6}\s/.test(line)) return line;
  }
  return "";
}

export function firstSentence(value: string, max = 140): string {
  const text = stripMd(value);
  const end = text.search(/(?<=[.!?。！？])\s/);
  const sentence = end > 0 ? text.slice(0, end) : text;
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function monthOf(word: string): number {
  const name = word.toLowerCase().replace(/\.$/, "");
  return MONTHS.findIndex((month) => month === name || month.slice(0, 3) === name || (month === "september" && name === "sept"));
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 把页面上的日期写法统一成 YYYY-MM-DD；只有年月时给 YYYY-MM；认不出就返回空串。 */
export function isoDate(value: string, year?: number): string {
  const text = value.trim();
  let found = text.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (found) return `${found[1]}-${pad(Number(found[2]))}-${pad(Number(found[3]))}`;
  for (const match of text.matchAll(/\b(\d{1,2})\s+([A-Za-z]{3,9}\.?),?\s+(\d{4})\b/g)) {
    const month = monthOf(match[2] ?? "");
    if (month >= 0) return `${match[3]}-${pad(month + 1)}-${pad(Number(match[1]))}`;
  }
  for (const match of text.matchAll(/\b([A-Za-z]{3,9}\.?)\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s*(\d{4})\b)?/g)) {
    const month = monthOf(match[1] ?? "");
    const fullYear = match[3] ? Number(match[3]) : year;
    if (month >= 0 && fullYear) return `${fullYear}-${pad(month + 1)}-${pad(Number(match[2]))}`;
  }
  found = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
  if (found) return `${found[1]}-${pad(Number(found[2]))}`;
  for (const match of text.matchAll(/\b([A-Za-z]{3,9}),?\s+(\d{4})\b/g)) {
    const month = monthOf(match[1] ?? "");
    if (month >= 0) return `${match[2]}-${pad(month + 1)}`;
  }
  return "";
}

export function absoluteUrl(base: string, href: string): string {
  try {
    return new URL(href, base).href;
  } catch {
    return "";
  }
}
