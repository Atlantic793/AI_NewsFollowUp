import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Hono } from "hono";
import { sourceById, watchHits, type ColumnKind } from "@followup/core";
import { bad } from "../http-error.js";
import type { AppDeps } from "../types.js";
import { runLedger } from "./run.js";
import { LedgerStore, type EventView, type HotView, type PriceView, type RankView } from "./store.js";

interface RunState {
  state: "idle" | "running";
  done: number;
  total: number;
  current: string;
  error: string;
}

const COLUMNS = new Set<string>(["hot", "price", "rank", "event"]);
const HOT_IDS = { github: "H01", huggingface: "H02", kaggle: "H03" } as const;
const RAW_LIMIT = 400_000;

function columnParam(value: string): ColumnKind {
  if (!COLUMNS.has(value)) throw bad(400, "COLUMN_INVALID", "没有这一栏。");
  return value as ColumnKind;
}

export function mountLedger(app: Hono, deps: AppDeps): LedgerStore {
  const store = new LedgerStore(path.join(deps.dataDir, "headline.sqlite"));
  const run: RunState = { state: "idle", done: 0, total: 0, current: "", error: "" };
  const today = () => deps.now().toISOString().slice(0, 10);

  app.get("/api/ledger/home", (c) => {
    const day = today();
    const sources = store.sources();
    const enabled = (id: string) => sources.find((source) => source.id === id)?.enabled ?? false;
    const hot = store.hot().filter((row) => enabled(row.sourceId));
    const events = store.events();
    return c.json({
      day,
      hotEnabled: { github: enabled(HOT_IDS.github), huggingface: enabled(HOT_IDS.huggingface), kaggle: enabled(HOT_IDS.kaggle) },
      hot: firstPer(hot, (row) => row.sourceId, 3),
      prices: firstPer(store.prices().filter((row) => row.kind === "api" && (row.metric === "输入" || row.metric === "输入（缓存未命中）")), (row) => row.vendor, 1),
      priceRows: store.prices().length,
      ranks: firstPer(store.ranks(), (row) => row.sourceId, 1),
      events: events.filter((row) => row.type !== "status").sort((left, right) => right.date.localeCompare(left.date)).slice(0, 4),
      outages: events.filter((row) => row.type === "status" && row.detail !== "正常").length,
      changes: { hot: store.changesOn(day, "hot"), price: store.changesOn(day, "price"), rank: store.changesOn(day, "rank"), event: store.changesOn(day, "event") },
    });
  });

  app.get("/api/ledger/column/:kind", (c) => {
    const column = columnParam(c.req.param("kind"));
    const day = today();
    return c.json({
      kind: column,
      day,
      changes: store.changesOn(day, column),
      push: store.setting(`push_${column}`, column === "hot"),
      sources: store.sources().filter((source) => source.column === column),
      rows: rowsFor(store, column),
    });
  });

  app.post("/api/ledger/column/:kind/push", async (c) => {
    const column = columnParam(c.req.param("kind"));
    const body = await c.req.json().catch(() => ({})) as { enabled?: boolean };
    store.setSetting(`push_${column}`, Boolean(body.enabled));
    return c.json({ ok: true });
  });

  app.get("/api/ledger/sources", (c) => c.json({ sources: store.sources(), run }));

  app.post("/api/ledger/sources/:id", async (c) => {
    const id = c.req.param("id");
    if (!sourceById(id)) throw bad(404, "SOURCE_NOT_FOUND", "没有这个来源。");
    const body = await c.req.json().catch(() => ({})) as { enabled?: boolean };
    store.setEnabled(id, Boolean(body.enabled));
    return c.json({ ok: true });
  });

  app.get("/api/ledger/sources/:id/rejects", (c) => {
    const id = c.req.param("id");
    if (!sourceById(id)) throw bad(404, "SOURCE_NOT_FOUND", "没有这个来源。");
    return c.json({ rejects: store.rejects(id) });
  });

  app.get("/api/ledger/sources/:id/raw", async (c) => {
    const id = c.req.param("id");
    const source = store.sources().find((item) => item.id === id);
    if (!source) throw bad(404, "SOURCE_NOT_FOUND", "没有这个来源。");
    const file = source.run?.rawPath ?? "";
    const rawRoot = path.resolve(deps.dataDir, "raw");
    if (!file || !path.resolve(file).startsWith(rawRoot)) throw bad(404, "RAW_NOT_FOUND", "这个来源还没有存下原始响应。");
    const body = await readFile(file, "utf8").catch(() => "");
    if (!body) throw bad(404, "RAW_NOT_FOUND", "原始响应文件不见了。");
    const cut = body.length > RAW_LIMIT ? `${body.slice(0, RAW_LIMIT)}\n\n…（文件共 ${body.length} 字符，这里只显示前 ${RAW_LIMIT} 字符）` : body;
    return c.text(cut, 200, { "content-type": "text/plain; charset=utf-8" });
  });

  app.post("/api/ledger/run", async (c) => {
    if (run.state === "running") throw bad(409, "JOB_BUSY", "这一轮还没结束。");
    const body = await c.req.json().catch(() => ({})) as { ids?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string" && Boolean(sourceById(id))) : null;
    if (ids && ids.length === 0) throw bad(400, "SOURCE_NOT_FOUND", "没有这个来源。");
    Object.assign(run, { state: "running", done: 0, total: ids?.length ?? 0, current: "", error: "" });
    void runLedger(deps, store, ids, (progress) => {
      Object.assign(run, progress);
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
    const day = today();
    const prices = store.prices();
    const ranks = store.ranks();
    const events = store.events().filter((row) => row.type !== "status");
    const diffs = store.diffs(500);
    return c.json({
      names,
      hits: names.map((name) => ({
        name,
        prices: prices.filter((row) => watchHits(name, row.product)),
        ranks: ranks.filter((row) => watchHits(name, row.model)),
        events: events.filter((row) => watchHits(name, `${row.title} ${row.detail}`)).slice(0, 8),
        diffs: diffs.filter((diff) => diff.fetchedAt.startsWith(day) && watchHits(name, `${diff.label} ${diff.rowKey}`)),
      })),
    });
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

  return store;
}

function firstPer<Row>(rows: readonly Row[], group: (row: Row) => string, count: number): Row[] {
  const seen = new Map<string, number>();
  return rows.filter((row) => {
    const key = group(row);
    const used = seen.get(key) ?? 0;
    seen.set(key, used + 1);
    return used < count;
  });
}

function rowsFor(store: LedgerStore, column: ColumnKind): PriceView[] | RankView[] | HotView[] | EventView[] {
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
