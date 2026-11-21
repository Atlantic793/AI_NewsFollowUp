import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  SOURCES,
  comparable,
  diffRows,
  sourceById,
  type CleanedSet,
  type ColumnKind,
  type EventRow,
  type HotRow,
  type PriceRow,
  type RankRow,
  type Rejected,
  type SourceDef,
} from "@followup/core";

const SCHEMA = 4;
const SAMPLES_PER_REASON = 3;

export type RunStatus = "ok" | "没抽出" | "skipped" | "failed";

export interface RunRecord {
  sourceId: string;
  startedAt: string;
  status: RunStatus;
  httpStatus: number | null;
  error: string;
  bytes: number;
  hash: string;
  rawPath: string;
  extracted: number;
  cleaned: number;
  stored: number;
  changed: number;
  rejected: number;
  reasons: Record<string, number>;
  llmDrafts: number;
  llmKept: number;
  llmDropped: number;
}

export interface SourceView {
  id: string;
  vendor: string;
  label: string;
  column: ColumnKind;
  url: string;
  page: string;
  enabled: boolean;
  needs: string;
  run: RunRecord | null;
}

export interface PriceView extends PriceRow { id: number; sourceId: string; vendor: string; page: string; fetchedAt: string }
export interface RankView extends RankRow { id: number; sourceId: string; board: string; page: string; fetchedAt: string }
export interface HotView extends HotRow { id: number; sourceId: string; site: string; fetchedAt: string }
export interface EventView extends EventRow { id: number; sourceId: string; vendor: string; basis: "official"; fetchedAt: string }

export interface DiffView {
  id: number;
  sourceId: string;
  column: ColumnKind;
  vendor: string;
  rowKey: string;
  label: string;
  field: string;
  oldValue: string;
  newValue: string;
  fetchedAt: string;
}

type Raw = Record<string, string | number | null>;

const text = (value: string | number | null | undefined) => (value === null || value === undefined ? "" : String(value));

export class LedgerStore {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, started_at TEXT NOT NULL, status TEXT NOT NULL,
        http_status INTEGER, error TEXT NOT NULL, bytes INTEGER NOT NULL, content_hash TEXT NOT NULL, raw_path TEXT NOT NULL,
        extracted INTEGER NOT NULL, cleaned INTEGER NOT NULL, stored INTEGER NOT NULL, changed INTEGER NOT NULL,
        rejected INTEGER NOT NULL, reasons TEXT NOT NULL,
        llm_drafts INTEGER NOT NULL DEFAULT 0, llm_kept INTEGER NOT NULL DEFAULT 0, llm_dropped INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS rejects (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, reason TEXT NOT NULL, excerpt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, kind TEXT NOT NULL, product TEXT NOT NULL, tier TEXT NOT NULL,
        metric TEXT NOT NULL, condition TEXT NOT NULL, price TEXT NOT NULL, amount REAL, currency TEXT NOT NULL, unit TEXT NOT NULL,
        quota TEXT NOT NULL, reset_rule TEXT NOT NULL, fetched_at TEXT NOT NULL, excerpt TEXT NOT NULL, brief TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS ranks (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, rank_no INTEGER NOT NULL, model TEXT NOT NULL, org TEXT NOT NULL,
        score TEXT NOT NULL, score_value REAL NOT NULL, votes TEXT NOT NULL, board_date TEXT NOT NULL, basis TEXT NOT NULL DEFAULT 'printed', fetched_at TEXT NOT NULL, excerpt TEXT NOT NULL, brief TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS hot (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, rank_no INTEGER NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL,
        heat TEXT NOT NULL, summary TEXT NOT NULL, fetched_at TEXT NOT NULL, excerpt TEXT NOT NULL, brief TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, date TEXT NOT NULL,
        detail TEXT NOT NULL, url TEXT NOT NULL, fetched_at TEXT NOT NULL, excerpt TEXT NOT NULL, brief TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS diffs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, column_kind TEXT NOT NULL, row_key TEXT NOT NULL, label TEXT NOT NULL,
        field TEXT NOT NULL, old_value TEXT NOT NULL, new_value TEXT NOT NULL, fetched_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS row_archive (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, column_kind TEXT NOT NULL, archived_at TEXT NOT NULL, payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS watches (name TEXT PRIMARY KEY, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    this.ensureColumn("ranks", "basis", "TEXT NOT NULL DEFAULT 'printed'");
    this.ensureColumn("prices", "brief", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("prices", "comparison", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("ranks", "brief", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("hot", "brief", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("events", "brief", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("runs", "llm_drafts", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("runs", "llm_kept", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("runs", "llm_dropped", "INTEGER NOT NULL DEFAULT 0");
    this.db.exec(`PRAGMA user_version = ${SCHEMA}`);
    const insert = this.db.prepare("INSERT INTO sources (id, enabled) VALUES (?, ?) ON CONFLICT(id) DO NOTHING");
    for (const source of SOURCES) insert.run(source.id, source.enabled ? 1 : 0);
  }

  private ensureColumn(table: string, name: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === name)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }

  sources(): SourceView[] {
    const enabled = new Map((this.db.prepare("SELECT id, enabled FROM sources").all() as Raw[]).map((row) => [text(row.id), Number(row.enabled) === 1]));
    const runs = new Map((this.db.prepare("SELECT * FROM runs WHERE id IN (SELECT MAX(id) FROM runs GROUP BY source_id)").all() as Raw[]).map((row) => [text(row.source_id), mapRun(row)]));
    return SOURCES.map((source) => ({
      id: source.id,
      vendor: source.vendor,
      label: source.label,
      column: source.column,
      url: source.url,
      page: source.page,
      enabled: enabled.get(source.id) ?? source.enabled,
      needs: source.needs ?? "",
      run: runs.get(source.id) ?? null,
    }));
  }

  setEnabled(id: string, enabled: boolean): void {
    this.db.prepare("UPDATE sources SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
  }

  recordRun(run: RunRecord, rejected: readonly Rejected[]): void {
    this.db.prepare(`INSERT INTO runs (source_id, started_at, status, http_status, error, bytes, content_hash, raw_path,
      extracted, cleaned, stored, changed, rejected, reasons, llm_drafts, llm_kept, llm_dropped) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(run.sourceId, run.startedAt, run.status, run.httpStatus, run.error, run.bytes, run.hash, run.rawPath,
        run.extracted, run.cleaned, run.stored, run.changed, run.rejected, JSON.stringify(run.reasons), run.llmDrafts, run.llmKept, run.llmDropped);
    this.db.prepare("DELETE FROM rejects WHERE source_id = ?").run(run.sourceId);
    const insert = this.db.prepare("INSERT INTO rejects (source_id, reason, excerpt) VALUES (?, ?, ?)");
    const kept = new Map<string, number>();
    for (const item of rejected) {
      const count = kept.get(item.reason) ?? 0;
      if (count >= SAMPLES_PER_REASON) continue;
      kept.set(item.reason, count + 1);
      insert.run(run.sourceId, item.reason, item.excerpt);
    }
  }

  rejects(sourceId: string): Rejected[] {
    return (this.db.prepare("SELECT reason, excerpt FROM rejects WHERE source_id = ? ORDER BY id").all(sourceId) as Raw[])
      .map((row) => ({ reason: text(row.reason), excerpt: text(row.excerpt) }));
  }

  snapshot(source: SourceDef): CleanedSet {
    return this.cleanedOf(source);
  }

  /** 把这个来源的旧行换成这一轮清洗后的行，返回记下的变化条数。第一次入库只当基线，不记变化。 */
  replace(source: SourceDef, set: CleanedSet, fetchedAt: string, unchanged = false): number {
    const before = this.cleanedOf(source);
    const removals = set.column === "price" || set.column === "rank";
    const diffs = unchanged || before.rows.length === 0 ? [] : diffRows(comparable(before), comparable(set), removals);
    if (before.rows.length > 0) {
      this.db.prepare("INSERT INTO row_archive (source_id, column_kind, archived_at, payload) VALUES (?, ?, ?, ?)")
        .run(source.id, source.column, fetchedAt, JSON.stringify(before.rows));
    }
    this.db.exec("BEGIN");
    try {
      this.clear(source);
      this.insertRows(source.id, set, fetchedAt);
      const insert = this.db.prepare(`INSERT INTO diffs (source_id, column_kind, row_key, label, field, old_value, new_value, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const diff of diffs) insert.run(source.id, source.column, diff.key, diff.label, diff.field, diff.oldValue, diff.newValue, fetchedAt);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return diffs.length;
  }

  clear(source: SourceDef): void {
    this.db.prepare(`DELETE FROM ${tableFor(source.column)} WHERE source_id = ?`).run(source.id);
  }

  /** 这个来源当前还留着多少行。解析失败时用来判断要不要告诉用户「上次的还在」。 */
  count(source: SourceDef): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM ${tableFor(source.column)} WHERE source_id = ?`).get(source.id) as { n: number };
    return Number(row.n);
  }

  archived(sourceId: string): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM row_archive WHERE source_id = ?").get(sourceId) as { n: number };
    return Number(row.n);
  }

  /** 这一栏成功跑过的最多次数。只有 1 次时，差分还是基线。 */
  okRuns(column: ColumnKind): number {
    const ids = SOURCES.filter((source) => source.column === column).map((source) => source.id);
    if (ids.length === 0) return 0;
    const marks = ids.map(() => "?").join(", ");
    const row = this.db.prepare(`SELECT MAX(n) AS n FROM (SELECT COUNT(*) AS n FROM runs WHERE status = 'ok' AND source_id IN (${marks}) GROUP BY source_id)`).get(...ids) as { n: number | null };
    return Number(row.n ?? 0);
  }

  private insertRows(sourceId: string, set: CleanedSet, fetchedAt: string): void {
    switch (set.column) {
      case "price": {
        const insert = this.db.prepare(`INSERT INTO prices (source_id, kind, product, tier, metric, condition, price, amount, currency, unit, quota, reset_rule, fetched_at, excerpt, brief, comparison)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const row of set.rows) insert.run(sourceId, row.kind, row.product, row.tier, row.metric, row.condition, row.price, row.amount, row.currency, row.unit, row.quota, row.reset, fetchedAt, row.excerpt, row.brief, row.comparison ? JSON.stringify(row.comparison) : "");
        return;
      }
      case "rank": {
        const insert = this.db.prepare(`INSERT INTO ranks (source_id, rank_no, model, org, score, score_value, votes, board_date, basis, fetched_at, excerpt, brief)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const row of set.rows) insert.run(sourceId, row.rank, row.model, row.org, row.score, row.scoreValue, row.votes, row.boardDate, row.basis, fetchedAt, row.excerpt, row.brief);
        return;
      }
      case "hot": {
        const insert = this.db.prepare("INSERT INTO hot (source_id, rank_no, title, url, heat, summary, fetched_at, excerpt, brief) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
        for (const row of set.rows) insert.run(sourceId, row.rank, row.title, row.url, row.heat, row.summary, fetchedAt, row.excerpt, row.brief);
        return;
      }
      case "event": {
        const insert = this.db.prepare("INSERT INTO events (source_id, type, title, date, detail, url, fetched_at, excerpt, brief) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
        for (const row of set.rows) insert.run(sourceId, row.type, row.title, row.date, row.detail, row.url, fetchedAt, row.excerpt, row.brief);
        return;
      }
      default: {
        const unreachable: never = set;
        return unreachable;
      }
    }
  }

  private cleanedOf(source: SourceDef): CleanedSet {
    switch (source.column) {
      case "price":
        return { column: "price", rows: this.prices(source.id), rejected: [] };
      case "rank":
        return { column: "rank", rows: this.ranks(source.id), rejected: [] };
      case "hot":
        return { column: "hot", rows: this.hot(source.id), rejected: [] };
      case "event":
        return { column: "event", rows: this.events(source.id), rejected: [] };
      default: {
        const unreachable: never = source;
        return unreachable;
      }
    }
  }

  prices(sourceId?: string): PriceView[] {
    return this.select("prices", sourceId, "source_id, id").map((row) => {
      const source = sourceById(text(row.source_id));
      return {
        id: Number(row.id),
        sourceId: text(row.source_id),
        vendor: source?.vendor ?? "",
        page: source?.page ?? "",
        kind: text(row.kind) === "plan" ? "plan" : "api",
        product: text(row.product),
        tier: text(row.tier),
        metric: text(row.metric),
        condition: text(row.condition),
        price: text(row.price),
        amount: row.amount === null ? null : Number(row.amount),
        currency: currencyOf(text(row.currency)),
        unit: text(row.unit),
        quota: text(row.quota),
        reset: text(row.reset_rule),
        comparison: priceComparison(text(row.comparison)),
        fetchedAt: text(row.fetched_at),
        excerpt: text(row.excerpt),
        brief: text(row.brief),
      };
    });
  }

  ranks(sourceId?: string): RankView[] {
    return this.select("ranks", sourceId, "source_id, rank_no").map((row) => {
      const source = sourceById(text(row.source_id));
      return {
        id: Number(row.id),
        sourceId: text(row.source_id),
        board: source ? `${source.vendor} ${source.label}` : "",
        page: source?.page ?? "",
        rank: Number(row.rank_no),
        model: text(row.model),
        org: text(row.org),
        score: text(row.score),
        scoreValue: Number(row.score_value),
        votes: text(row.votes),
        boardDate: text(row.board_date),
        basis: text(row.basis) === "sorted" ? "sorted" : "printed",
        fetchedAt: text(row.fetched_at),
        excerpt: text(row.excerpt),
        brief: text(row.brief),
      };
    });
  }

  hot(sourceId?: string): HotView[] {
    return this.select("hot", sourceId, "source_id, rank_no").map((row) => ({
      id: Number(row.id),
      sourceId: text(row.source_id),
      site: sourceById(text(row.source_id))?.vendor ?? "",
      rank: Number(row.rank_no),
      title: text(row.title),
      url: text(row.url),
      heat: text(row.heat),
      summary: text(row.summary),
      fetchedAt: text(row.fetched_at),
      excerpt: text(row.excerpt),
      brief: text(row.brief),
    }));
  }

  events(sourceId?: string): EventView[] {
    return this.select("events", sourceId, "date DESC, id").map((row) => ({
      id: Number(row.id),
      sourceId: text(row.source_id),
      vendor: sourceById(text(row.source_id))?.vendor ?? "",
      basis: "official",
      type: eventType(text(row.type)),
      title: text(row.title),
      date: text(row.date),
      detail: text(row.detail),
      url: text(row.url),
      fetchedAt: text(row.fetched_at),
      excerpt: text(row.excerpt),
      brief: text(row.brief),
    }));
  }

  private select(table: string, sourceId: string | undefined, order: string): Raw[] {
    const where = sourceId ? "WHERE source_id = ?" : "";
    const statement = this.db.prepare(`SELECT * FROM ${table} ${where} ORDER BY ${order}`);
    return (sourceId ? statement.all(sourceId) : statement.all()) as Raw[];
  }

  changesOn(day: string, column?: ColumnKind): number {
    const row = column
      ? this.db.prepare("SELECT COUNT(*) AS n FROM diffs WHERE column_kind = ? AND fetched_at LIKE ?").get(column, `${day}%`)
      : this.db.prepare("SELECT COUNT(*) AS n FROM diffs WHERE fetched_at LIKE ?").get(`${day}%`);
    return Number((row as { n: number }).n);
  }

  diffs(limit: number): DiffView[] {
    return this.mapDiffs(this.db.prepare("SELECT * FROM diffs ORDER BY id DESC LIMIT ?").all(limit) as Raw[]);
  }

  latestDiffId(): number {
    return Number((this.db.prepare("SELECT MAX(id) AS id FROM diffs").get() as { id: number | null }).id ?? 0);
  }

  lastSuccessfulHash(sourceId: string): string {
    const row = this.db.prepare("SELECT content_hash FROM runs WHERE source_id = ? AND status = 'ok' ORDER BY id DESC LIMIT 1").get(sourceId) as { content_hash: string } | undefined;
    return row?.content_hash ?? "";
  }

  diffsAfter(id: number): DiffView[] {
    return this.mapDiffs(this.db.prepare("SELECT * FROM diffs WHERE id > ? ORDER BY id").all(id) as Raw[]);
  }

  private mapDiffs(rows: Raw[]): DiffView[] {
    return rows.map((row) => ({
      id: Number(row.id),
      sourceId: text(row.source_id),
      column: columnOf(text(row.column_kind)),
      vendor: sourceById(text(row.source_id))?.vendor ?? "",
      rowKey: text(row.row_key),
      label: text(row.label),
      field: text(row.field),
      oldValue: text(row.old_value),
      newValue: text(row.new_value),
      fetchedAt: text(row.fetched_at),
    }));
  }

  watches(): string[] {
    return (this.db.prepare("SELECT name FROM watches ORDER BY created_at").all() as Raw[]).map((row) => text(row.name));
  }

  addWatch(name: string, createdAt: string): void {
    this.db.prepare("INSERT INTO watches (name, created_at) VALUES (?, ?) ON CONFLICT(name) DO NOTHING").run(name.trim(), createdAt);
  }

  removeWatch(name: string): void {
    this.db.prepare("DELETE FROM watches WHERE name = ?").run(name);
  }

  setting(key: string, fallback: boolean): boolean {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row ? row.value === "1" : fallback;
  }

  setSetting(key: string, value: boolean): void {
    this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value ? "1" : "0");
  }

  close(): void {
    this.db.close();
  }
}

function priceComparison(value: string): PriceRow["comparison"] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return undefined;
    const fields = parsed as Record<string, unknown>;
    if (typeof fields.condition === "string" && typeof fields.quota === "string" && typeof fields.reset === "string") {
      const evidence = Array.isArray(fields.evidence) ? fields.evidence.filter((item): item is string => typeof item === "string") : undefined;
      return { condition: fields.condition, quota: fields.quota, reset: fields.reset, evidence };
    }
  } catch { /* 旧数据没有规则字段时，仍按原有字段比较。 */ }
  return undefined;
}

function mapRun(row: Raw): RunRecord {
  let reasons: Record<string, number> = {};
  try {
    reasons = JSON.parse(text(row.reasons) || "{}") as Record<string, number>;
  } catch {
    reasons = {};
  }
  return {
    sourceId: text(row.source_id),
    startedAt: text(row.started_at),
    status: runStatus(text(row.status)),
    httpStatus: row.http_status === null ? null : Number(row.http_status),
    error: text(row.error),
    bytes: Number(row.bytes),
    hash: text(row.content_hash),
    rawPath: text(row.raw_path),
    extracted: Number(row.extracted),
    cleaned: Number(row.cleaned),
    stored: Number(row.stored),
    changed: Number(row.changed),
    rejected: Number(row.rejected),
    reasons,
    llmDrafts: Number(row.llm_drafts ?? 0),
    llmKept: Number(row.llm_kept ?? 0),
    llmDropped: Number(row.llm_dropped ?? 0),
  };
}

function runStatus(value: string): RunStatus {
  return value === "ok" || value === "没抽出" || value === "skipped" ? value : "failed";
}

function currencyOf(value: string): PriceRow["currency"] {
  return value === "USD" || value === "CNY" ? value : "";
}

function eventType(value: string): EventRow["type"] {
  return value === "release" || value === "news" || value === "status" || value === "incident" || value === "cn_access" ? value : "news";
}

function columnOf(value: string): ColumnKind {
  return value === "price" || value === "rank" || value === "hot" ? value : "event";
}

export function tableFor(column: ColumnKind): "prices" | "ranks" | "hot" | "events" {
  switch (column) {
    case "hot":
      return "hot";
    case "price":
      return "prices";
    case "rank":
      return "ranks";
    case "event":
      return "events";
    default: {
      const unreachable: never = column;
      return unreachable;
    }
  }
}
