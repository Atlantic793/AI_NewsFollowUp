import path from "node:path";
import type { Hono } from "hono";
import { columnOf, watchHits, type ColumnKind, type SourceKind } from "@followup/core";
import { bad } from "../http-error.js";
import type { AppDeps } from "../types.js";
import { runLedger } from "./run.js";
import { LedgerStore, tableFor } from "./store.js";

interface RunState {
  state: "idle" | "running";
  done: number;
  total: number;
  error: string;
}

const COLUMNS = new Set<ColumnKind>(["hot", "price", "rank", "event"]);

export function mountLedger(app: Hono, deps: AppDeps): void {
  const store = new LedgerStore(path.join(deps.dataDir, "headline.sqlite"));
  const run: RunState = { state: "idle", done: 0, total: 0, error: "" };

  app.get("/api/ledger/home", (c) => {
    const day = deps.now().toISOString().slice(0, 10);
    const sources = store.sources();
    return c.json({
      day,
      hotEnabled: {
        github: sources.find((source) => source.id === "H01")?.enabled ?? true,
        huggingface: sources.find((source) => source.id === "H02")?.enabled ?? true,
        kaggle: sources.find((source) => source.id === "H03")?.enabled ?? true,
      },
      hot: store.hot().slice(0, 6),
      prices: store.prices().slice(0, 6),
      priceChanges: store.changesFor("prices", day),
      ranks: store.ranks(),
      rankChanges: store.changesFor("ranks", day),
      events: store.events().slice(0, 6),
      eventChanges: store.changesFor("events", day),
    });
  });

  app.get("/api/ledger/column/:kind", (c) => {
    const kind = c.req.param("kind");
    if (!COLUMNS.has(kind as ColumnKind)) throw bad(400, "COLUMN_INVALID", "没有这一栏。");
    const column = kind as ColumnKind;
    const day = deps.now().toISOString().slice(0, 10);
    const sources = store.sources().filter((source) => tableFor(columnOfKind(source.kind)) === tableFor(column));
    const focus = c.req.query("source") || sources[0]?.id || "";
    const raw = focus ? store.raw(focus) : null;
    return c.json({
      kind: column,
      changes: store.changesFor(tableFor(column), day),
      push: store.setting(`push_${column}`, column === "hot"),
      sources,
      rows: rowsFor(store, column),
      excerpt: raw,
      focus,
    });
  });

  app.post("/api/ledger/column/:kind/push", async (c) => {
    const kind = c.req.param("kind");
    if (!COLUMNS.has(kind as ColumnKind)) throw bad(400, "COLUMN_INVALID", "没有这一栏。");
    const body = await c.req.json().catch(() => ({})) as { enabled?: boolean };
    store.setSetting(`push_${kind}`, Boolean(body.enabled));
    return c.json({ ok: true });
  });

  app.post("/api/ledger/sources/:id", async (c) => {
    const body = await c.req.json().catch(() => ({})) as { enabled?: boolean };
    const id = c.req.param("id");
    if (!store.sources().some((source) => source.id === id)) throw bad(404, "SOURCE_NOT_FOUND", "没有这个来源。");
    store.setEnabled(id, Boolean(body.enabled));
    return c.json({ ok: true });
  });

  app.get("/api/ledger/sources", (c) => c.json({ sources: store.sources(), run }));

  app.post("/api/ledger/run", (c) => {
    if (run.state === "running") throw bad(409, "JOB_BUSY", "这一轮还没结束。");
    run.state = "running";
    run.done = 0;
    run.total = store.enabledSources().length;
    run.error = "";
    void runLedger(deps, store, (done, total) => {
      run.done = done;
      run.total = total;
    }).then(() => {
      run.state = "idle";
    }).catch((error: unknown) => {
      run.state = "idle";
      run.error = error instanceof Error ? error.message : "这一轮没有跑完。";
    });
    return c.json({ ok: true, run });
  });

  app.get("/api/ledger/watch", (c) => {
    const names = store.watches();
    const day = deps.now().toISOString().slice(0, 10);
    const diffs = store.recentDiffs(400).filter((diff) => diff.fetchedAt.startsWith(day) && names.some((name) => watchHits(name, `${diff.label} ${diff.rowKey} ${diff.oldValue} ${diff.newValue}`)));
    return c.json({ names, diffs });
  });

  app.post("/api/ledger/watch", async (c) => {
    const body = await c.req.json().catch(() => ({})) as { name?: string };
    const name = body.name?.trim() ?? "";
    if (!name) throw bad(400, "NAME_INVALID", "写上模型或套餐的名字。");
    store.addWatch(name, deps.now().toISOString());
    return c.json({ ok: true });
  });

  app.delete("/api/ledger/watch/:name", (c) => {
    store.removeWatch(decodeURIComponent(c.req.param("name")));
    return c.json({ ok: true });
  });
}

function rowsFor(store: LedgerStore, column: ColumnKind): unknown[] {
  switch (column) {
    case "hot":
      return store.hot();
    case "price":
      return store.prices();
    case "rank":
      return store.ranks();
    case "event":
      return store.events();
    default: {
      const unreachable: never = column;
      return unreachable;
    }
  }
}

function columnOfKind(kind: SourceKind): ColumnKind {
  return columnOf(kind);
}
