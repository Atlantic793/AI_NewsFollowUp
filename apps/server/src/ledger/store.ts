import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  SOURCES,
  diffRows,
  type ColumnKind,
  type ComparedRow,
  type EventDraft,
  type HotDraft,
  type PriceDraft,
  type RankDraft,
  type SourceKind,
} from "@followup/core";

export interface SourceRow {
  id: string;
  vendor: string;
  kind: SourceKind;
  url: string;
  label: string;
  enabled: boolean;
  status: string;
  error: string;
  fetchedAt: string;
}

export interface RunRow {
  sourceId: string;
  startedAt: string;
  status: string;
  httpStatus: number | null;
  error: string;
  bytes: number;
}

interface PriceRow extends PriceDraft {
  id: number;
  vendor: string;
  sourceId: string;
  url: string;
  fetchedAt: string;
}

interface RankRow extends RankDraft {
  id: number;
  board: string;
  sourceId: string;
  url: string;
  fetchedAt: string;
  boardDate: string;
}

interface HotRow extends HotDraft {
  id: number;
  source: string;
  sourceId: string;
  fetchedAt: string;
}

interface EventRow extends EventDraft {
  id: number;
  vendor: string;
  sourceId: string;
  url: string;
  fetchedAt: string;
  basis: "official";
}

export interface DiffRow {
  id: number;
  tableName: string;
  rowKey: string;
  field: string;
  oldValue: string;
  newValue: string;
  fetchedAt: string;
  label: string;
}

export class LedgerStore {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY, vendor TEXT NOT NULL, kind TEXT NOT NULL, url TEXT NOT NULL,
        label TEXT NOT NULL, enabled INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, started_at TEXT NOT NULL,
        status TEXT NOT NULL, http_status INTEGER, error TEXT NOT NULL, bytes INTEGER NOT NULL, content_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS raw_pages (
        source_id TEXT PRIMARY KEY, url TEXT NOT NULL, fetched_at TEXT NOT NULL, body TEXT NOT NULL, content_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT, vendor TEXT NOT NULL, product TEXT NOT NULL, kind TEXT NOT NULL,
        metric TEXT NOT NULL, price TEXT NOT NULL, unit TEXT NOT NULL, quota TEXT NOT NULL, reset_cycle TEXT NOT NULL,
        source_id TEXT NOT NULL, url TEXT NOT NULL, fetched_at TEXT NOT NULL, excerpt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ranks (
        id INTEGER PRIMARY KEY AUTOINCREMENT, board TEXT NOT NULL, rank_no TEXT NOT NULL, model TEXT NOT NULL,
        score TEXT NOT NULL, board_date TEXT NOT NULL, source_id TEXT NOT NULL, url TEXT NOT NULL,
        fetched_at TEXT NOT NULL, excerpt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS hot (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, rank_no TEXT NOT NULL, title TEXT NOT NULL,
        url TEXT NOT NULL, source_id TEXT NOT NULL, fetched_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, vendor TEXT NOT NULL, type TEXT NOT NULL, basis TEXT NOT NULL,
        text TEXT NOT NULL, source_id TEXT NOT NULL, url TEXT NOT NULL, fetched_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS diffs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT NOT NULL, row_key TEXT NOT NULL, field TEXT NOT NULL,
        old_value TEXT NOT NULL, new_value TEXT NOT NULL, fetched_at TEXT NOT NULL, label TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS watches (name TEXT PRIMARY KEY, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    const insert = this.db.prepare(`INSERT INTO sources (id, vendor, kind, url, label, enabled)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET vendor = excluded.vendor, kind = excluded.kind, url = excluded.url, label = excluded.label`);
    for (const source of SOURCES) insert.run(source.id, source.vendor, source.kind, source.url, source.label, source.id === "H03" ? 0 : 1);
  }

  sources(): SourceRow[] {
    const rows = this.db.prepare(`SELECT s.id, s.vendor, s.kind, s.url, s.label, s.enabled,
      COALESCE((SELECT status FROM runs WHERE source_id = s.id ORDER BY id DESC LIMIT 1), '') AS status,
      COALESCE((SELECT error FROM runs WHERE source_id = s.id ORDER BY id DESC LIMIT 1), '') AS error,
      COALESCE((SELECT started_at FROM runs WHERE source_id = s.id ORDER BY id DESC LIMIT 1), '') AS fetched_at
      FROM sources s ORDER BY s.id`).all() as Array<Record<string, string | number>>;
    return rows.map((row) => ({
      id: String(row.id),
      vendor: String(row.vendor),
      kind: String(row.kind) as SourceKind,
      url: String(row.url),
      label: String(row.label),
      enabled: Number(row.enabled) === 1,
      status: String(row.status),
      error: String(row.error),
      fetchedAt: String(row.fetched_at),
    }));
  }

  setEnabled(id: string, enabled: boolean): void {
    this.db.prepare("UPDATE sources SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
  }

  enabledSources(): SourceRow[] {
    return this.sources().filter((source) => source.enabled);
  }

  recordRun(row: RunRow & { hash: string }): void {
    this.db.prepare(`INSERT INTO runs (source_id, started_at, status, http_status, error, bytes, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(row.sourceId, row.startedAt, row.status, row.httpStatus, row.error, row.bytes, row.hash);
  }

  saveRaw(sourceId: string, url: string, fetchedAt: string, body: string): void {
    const hash = createHash("sha256").update(body).digest("hex");
    this.db.prepare(`INSERT INTO raw_pages (source_id, url, fetched_at, body, content_hash)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(source_id) DO UPDATE SET url = excluded.url, fetched_at = excluded.fetched_at, body = excluded.body, content_hash = excluded.content_hash`)
      .run(sourceId, url, fetchedAt, body, hash);
  }

  raw(sourceId: string): { url: string; fetchedAt: string; body: string } | null {
    const row = this.db.prepare("SELECT url, fetched_at, body FROM raw_pages WHERE source_id = ?").get(sourceId) as
      | { url: string; fetched_at: string; body: string }
      | undefined;
    return row ? { url: row.url, fetchedAt: row.fetched_at, body: row.body } : null;
  }

  previous(table: string, sourceId: string): ComparedRow[] {
    if (table === "prices") {
      return (this.db.prepare("SELECT vendor, product, metric, price, quota, reset_cycle FROM prices WHERE source_id = ?").all(sourceId) as Array<Record<string, string>>)
        .map((row) => ({ key: `${row.product}|${row.metric}`, fields: { price: row.price, quota: row.quota, reset: row.reset_cycle } }));
    }
    if (table === "ranks") {
      return (this.db.prepare("SELECT model, rank_no, score FROM ranks WHERE source_id = ?").all(sourceId) as Array<Record<string, string>>)
        .map((row) => ({ key: row.model, fields: { rank: row.rank_no, score: row.score } }));
    }
    if (table === "hot") {
      return (this.db.prepare("SELECT title, url FROM hot WHERE source_id = ?").all(sourceId) as Array<Record<string, string>>)
        .map((row) => ({ key: row.url || row.title, fields: { title: row.title } }));
    }
    return (this.db.prepare("SELECT type, text FROM events WHERE source_id = ?").all(sourceId) as Array<Record<string, string>>)
      .map((row) => ({ key: `${row.type}|${row.text}`, fields: { text: row.text } }));
  }

  replacePrices(sourceId: string, vendor: string, url: string, fetchedAt: string, drafts: PriceDraft[], label: string): number {
    return this.replace(sourceId, "prices", label, fetchedAt, this.previous("prices", sourceId), drafts.map((row) => ({
      key: `${row.product}|${row.metric}`,
      fields: { price: row.price, quota: row.quota, reset: row.reset },
    })), () => {
      this.db.prepare("DELETE FROM prices WHERE source_id = ?").run(sourceId);
      const insert = this.db.prepare(`INSERT INTO prices (vendor, product, kind, metric, price, unit, quota, reset_cycle, source_id, url, fetched_at, excerpt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const row of drafts) insert.run(vendor, row.product, row.kind, row.metric, row.price, row.unit, row.quota, row.reset, sourceId, url, fetchedAt, row.excerpt);
    });
  }

  replaceRanks(sourceId: string, board: string, url: string, fetchedAt: string, drafts: RankDraft[], label: string): number {
    return this.replace(sourceId, "ranks", label, fetchedAt, this.previous("ranks", sourceId), drafts.map((row) => ({
      key: row.model,
      fields: { rank: row.rank, score: row.score },
    })), () => {
      this.db.prepare("DELETE FROM ranks WHERE source_id = ?").run(sourceId);
      const insert = this.db.prepare(`INSERT INTO ranks (board, rank_no, model, score, board_date, source_id, url, fetched_at, excerpt)
        VALUES (?, ?, ?, ?, '', ?, ?, ?, ?)`);
      for (const row of drafts) insert.run(board, row.rank, row.model, row.score, sourceId, url, fetchedAt, row.excerpt);
    });
  }

  replaceHot(sourceId: string, source: string, fetchedAt: string, drafts: HotDraft[], label: string): number {
    return this.replace(sourceId, "hot", label, fetchedAt, this.previous("hot", sourceId), drafts.map((row) => ({
      key: row.url || row.title,
      fields: { title: row.title },
    })), () => {
      this.db.prepare("DELETE FROM hot WHERE source_id = ?").run(sourceId);
      const insert = this.db.prepare("INSERT INTO hot (source, rank_no, title, url, source_id, fetched_at) VALUES (?, ?, ?, ?, ?, ?)");
      for (const row of drafts) insert.run(source, row.rank, row.title, row.url, sourceId, fetchedAt);
    });
  }

  replaceEvents(sourceId: string, vendor: string, url: string, fetchedAt: string, drafts: EventDraft[], label: string): number {
    return this.replace(sourceId, "events", label, fetchedAt, this.previous("events", sourceId), drafts.map((row) => ({
      key: `${row.type}|${row.text}`,
      fields: { text: row.text },
    })), () => {
      this.db.prepare("DELETE FROM events WHERE source_id = ?").run(sourceId);
      const insert = this.db.prepare("INSERT INTO events (vendor, type, basis, text, source_id, url, fetched_at) VALUES (?, ?, 'official', ?, ?, ?, ?)");
      for (const row of drafts) insert.run(vendor, row.type, row.text, sourceId, url, fetchedAt);
    });
  }

  private replace(sourceId: string, table: string, label: string, fetchedAt: string, previous: ComparedRow[], next: ComparedRow[], write: () => void): number {
    const diffs = diffRows(previous, next);
    write();
    const insert = this.db.prepare("INSERT INTO diffs (table_name, row_key, field, old_value, new_value, fetched_at, label) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const diff of diffs) insert.run(table, `${sourceId}:${diff.key}`, diff.field, diff.oldValue, diff.newValue, fetchedAt, label);
    return diffs.length;
  }

  prices(): PriceRow[] {
    return (this.db.prepare("SELECT * FROM prices ORDER BY vendor, product, metric").all() as Array<Record<string, string | number>>).map((row) => ({
      id: Number(row.id),
      vendor: String(row.vendor),
      product: String(row.product),
      kind: String(row.kind) as "api" | "plan",
      metric: String(row.metric),
      price: String(row.price),
      unit: String(row.unit),
      quota: String(row.quota),
      reset: String(row.reset_cycle),
      excerpt: String(row.excerpt),
      sourceId: String(row.source_id),
      url: String(row.url),
      fetchedAt: String(row.fetched_at),
    }));
  }

  ranks(): RankRow[] {
    return (this.db.prepare("SELECT * FROM ranks ORDER BY board, CAST(rank_no AS INTEGER)").all() as Array<Record<string, string | number>>).map((row) => ({
      id: Number(row.id),
      board: String(row.board),
      rank: String(row.rank_no),
      model: String(row.model),
      score: String(row.score),
      excerpt: String(row.excerpt),
      boardDate: String(row.board_date),
      sourceId: String(row.source_id),
      url: String(row.url),
      fetchedAt: String(row.fetched_at),
    }));
  }

  hot(): HotRow[] {
    return (this.db.prepare("SELECT * FROM hot ORDER BY source, CAST(rank_no AS INTEGER)").all() as Array<Record<string, string | number>>).map((row) => ({
      id: Number(row.id),
      source: String(row.source),
      rank: String(row.rank_no),
      title: String(row.title),
      url: String(row.url),
      sourceId: String(row.source_id),
      fetchedAt: String(row.fetched_at),
    }));
  }

  events(): EventRow[] {
    return (this.db.prepare("SELECT * FROM events ORDER BY fetched_at DESC, id DESC").all() as Array<Record<string, string | number>>).map((row) => ({
      id: Number(row.id),
      vendor: String(row.vendor),
      type: String(row.type) as EventRow["type"],
      basis: "official",
      text: String(row.text),
      sourceId: String(row.source_id),
      url: String(row.url),
      fetchedAt: String(row.fetched_at),
    }));
  }

  todayChanges(day: string): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM diffs WHERE fetched_at LIKE ?").get(`${day}%`) as { n: number };
    return Number(row.n);
  }

  changesFor(table: string, day: string): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM diffs WHERE table_name = ? AND fetched_at LIKE ?").get(table, `${day}%`) as { n: number };
    return Number(row.n);
  }

  recentDiffs(limit: number): DiffRow[] {
    return (this.db.prepare("SELECT * FROM diffs ORDER BY id DESC LIMIT ?").all(limit) as Array<Record<string, string | number>>).map(mapDiff);
  }

  watches(): string[] {
    return (this.db.prepare("SELECT name FROM watches ORDER BY created_at").all() as Array<{ name: string }>).map((row) => row.name);
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
}

function mapDiff(row: Record<string, string | number>): DiffRow {
  return {
    id: Number(row.id),
    tableName: String(row.table_name),
    rowKey: String(row.row_key),
    field: String(row.field),
    oldValue: String(row.old_value),
    newValue: String(row.new_value),
    fetchedAt: String(row.fetched_at),
    label: String(row.label),
  };
}

export function tableFor(column: ColumnKind): string {
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
