export type LoginState = "logged-in" | "not-logged-in" | "unknown" | "error";

export interface ListedCommand {
  command: string;
  description: string;
  access?: string;
}

export interface CommandHelp {
  access?: string;
  browser?: boolean;
  siteSession?: boolean;
  description?: string;
  positionals?: { name?: string; required?: boolean; type?: string; default?: unknown }[];
  command_options?: { name?: string; required?: boolean; default?: unknown }[];
  columns?: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function parseJsonStdout(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("empty stdout");
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.lastIndexOf("\n{");
    const blob = start >= 0 ? trimmed.slice(start + 1) : trimmed.slice(trimmed.indexOf("{"));
    return JSON.parse(blob) as unknown;
  }
}

export function readEnvelope(stdout: string): { ok: true; data: unknown } | { ok: false; message: string } {
  let parsed: unknown;
  try {
    parsed = parseJsonStdout(stdout);
  } catch {
    return { ok: false, message: "命令没有返回 JSON。" };
  }
  const record = asRecord(parsed);
  if (!record || record.ok !== true) {
    const error = asRecord(record?.error);
    const message = typeof error?.message === "string" ? error.message : "命令失败。";
    return { ok: false, message };
  }
  return { ok: true, data: record.data };
}

export function parseList(stdout: string): { commands: ListedCommand[]; nextOffset?: number } {
  const envelope = readEnvelope(stdout);
  if (!envelope.ok) throw new Error(envelope.message);
  const data = asRecord(envelope.data);
  const commands = Array.isArray(data?.commands) ? data.commands : [];
  const nextOffset = typeof data?.nextOffset === "number" ? data.nextOffset : undefined;
  return {
    nextOffset,
    commands: commands.flatMap((entry) => {
      const row = asRecord(entry);
      if (!row || typeof row.command !== "string") return [];
      return [{
        command: row.command,
        description: typeof row.description === "string" ? row.description : "",
        access: typeof row.access === "string" ? row.access : undefined,
      }];
    }),
  };
}

export function parseHelp(stdout: string): CommandHelp {
  const envelope = readEnvelope(stdout);
  const record = envelope.ok ? asRecord(envelope.data) ?? asRecord(parseJsonStdout(stdout)) : asRecord(parseJsonStdout(stdout));
  if (!record) return {};
  const positionals = Array.isArray(record.positionals) ? record.positionals.flatMap((item) => {
    const row = asRecord(item);
    return row ? [row] : [];
  }) : [];
  const options = Array.isArray(record.command_options) ? record.command_options.flatMap((item) => {
    const row = asRecord(item);
    return row ? [row] : [];
  }) : [];
  return {
    access: typeof record.access === "string" ? record.access : undefined,
    browser: record.browser === true,
    siteSession: record.siteSession === true || (typeof record.siteSession === "string" && record.siteSession.length > 0),
    description: typeof record.description === "string" ? record.description : undefined,
    positionals: positionals.map((row) => ({
      name: typeof row.name === "string" ? row.name : undefined,
      required: row.required === true,
      type: typeof row.type === "string" ? row.type : undefined,
      default: row.default,
    })),
    command_options: options.map((row) => ({
      name: typeof row.name === "string" ? row.name : undefined,
      required: row.required === true,
      default: row.default,
    })),
    columns: Array.isArray(record.columns) ? record.columns.filter((column) => typeof column === "string") : [],
  };
}

export function parseAuthStatus(stdout: string): Map<string, LoginState> {
  const found = new Map<string, LoginState>();
  let parsed: unknown;
  try {
    parsed = parseJsonStdout(stdout);
  } catch {
    return found;
  }
  const record = asRecord(parsed);
  const data = record?.ok === true ? record.data : record?.data;
  const rows = Array.isArray(data) ? data : Array.isArray(asRecord(data)?.sites) ? asRecord(data)?.sites : [];
  if (!Array.isArray(rows)) return found;
  for (const entry of rows) {
    const row = asRecord(entry);
    if (!row) continue;
    const site = [row.site, row.id, row.name].find((value) => typeof value === "string");
    const status = [row.status, row.state].find((value) => typeof value === "string");
    if (typeof site !== "string" || typeof status !== "string") continue;
    if (status === "logged-in" || status === "not-logged-in" || status === "unknown" || status === "error") {
      found.set(site, status);
    }
  }
  return found;
}
