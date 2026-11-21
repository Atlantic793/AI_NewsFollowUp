import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Hono } from "hono";
import { BLOCKED_PAGES, USD_TO_CNY, cnyAmount, cnyLabel, displayMoneyText, fallbackFor, hasHan, introText, shanghaiDate, showIntro, shownText, sourceById, watchHits, type BriefHit, type ColumnKind } from "@followup/core";
import { bad } from "../http-error.js";
import type { AppDeps } from "../types.js";
import { llmBrief } from "./brief.js";
import { runLedger } from "./run.js";
import { LedgerStore, type DiffView, type EventView, type HotView, type PriceView, type RankView, type SourceView } from "./store.js";

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
  const today = () => shanghaiDate(deps.now());

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
      usdToCny: USD_TO_CNY,
      prices: pickHomePrices(store.prices()).map(presentPrice),
      priceRows: store.prices().length,
      ranks: firstPer(store.ranks(), (row) => row.sourceId, 1),
      events: events.filter((row) => row.type !== "status").sort((left, right) => right.date.localeCompare(left.date)).slice(0, 6).map(presentEvent),
      outages: events.filter((row) => row.type === "status" && !row.detail.startsWith("正常")).length,
      changes: { hot: store.changesOn(day, "hot"), price: store.changesOn(day, "price"), rank: store.changesOn(day, "rank"), event: store.changesOn(day, "event") },
      baselines: { hot: store.okRuns("hot") <= 1, price: store.okRuns("price") <= 1, rank: store.okRuns("rank") <= 1, event: store.okRuns("event") <= 1 },
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
      baseline: store.okRuns(column) <= 1,
      usdToCny: USD_TO_CNY,
      blocked: BLOCKED_PAGES.filter((page) => page.column === column),
      sources: store.sources().filter((source) => source.column === column).map((source) => annotate(store, column, source)),
      rows: presentColumn(column, rowsFor(store, column)),
    });
  });

  app.post("/api/ledger/column/:kind/brief", async (c) => {
    const column = columnParam(c.req.param("kind"));
    const body = await c.req.json().catch(() => ({})) as { query?: string; rowId?: number };
    const query = body.query?.trim() ?? "";
    if (!query) throw bad(400, "QUERY_INVALID", "先写要概括的词。");
    const rows = rowsFor(store, column);
    const hits = briefHits(rows, query, body.rowId);
    const brief = await llmBrief(deps, query, hits);
    return c.json({ ...brief, hits: hits.length });
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
        prices: prices.filter((row) => watchHits(name, row.product)).map(presentPrice),
        ranks: ranks.filter((row) => watchHits(name, row.model)),
        events: events.filter((row) => watchHits(name, row.title)).slice(0, 8).map(presentEvent),
        diffs: diffs.filter((diff) => diff.fetchedAt.startsWith(day) && watchHits(name, `${diff.label} ${diff.rowKey}`)).map(presentDiff),
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

function homePriceScore(row: PriceView): number {
  let score = 0;
  if (row.metric === "输入") score += 5;
  if (row.tier === "标准") score += 3;
  if (/低谷|off-peak|限时|试用/i.test(row.condition)) score -= 6;
  if (/高峰/.test(row.condition)) score += 1;
  return score;
}

/** 首页每家一条输入价。不拿未标价和低谷价当这家的标价。 */
function pickHomePrices(rows: readonly PriceView[]): PriceView[] {
  const ranked = rows
    .filter((row) => row.kind === "api" && row.price !== "未标价" && row.metric.startsWith("输入"))
    .sort((left, right) => homePriceScore(right) - homePriceScore(left));
  return firstPer(ranked, (row) => row.vendor, 1);
}

function briefHits(rows: PriceView[] | RankView[] | HotView[] | EventView[], query: string, rowId?: number): BriefHit[] {
  const needle = query.toLocaleLowerCase();
  const picked = typeof rowId === "number" ? rows.filter((row) => row.id === rowId) : rows.filter((row) => briefHaystack(row).toLocaleLowerCase().includes(needle));
  return picked.slice(0, 12).map((row) => ({ sourceId: row.sourceId, title: briefTitle(row), excerpt: row.excerpt }));
}

function briefHaystack(row: PriceView | RankView | HotView | EventView): string {
  if ("product" in row) return `${row.product} ${row.metric} ${row.condition} ${row.tier}`;
  if ("model" in row) return `${row.model} ${row.org}`;
  if ("heat" in row) return `${row.title} ${row.summary}`;
  return `${row.title} ${row.detail}`;
}

function briefTitle(row: PriceView | RankView | HotView | EventView): string {
  if ("product" in row) return `${row.product} · ${row.metric}${row.condition ? ` · ${row.condition}` : ""}`;
  if ("model" in row) return row.model;
  return row.title;
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

function annotate(store: LedgerStore, column: ColumnKind, source: SourceView) {
  const rows = rowsFor(store, column).filter((row) => row.sourceId === source.id);
  const stale = Boolean(source.run && source.run.status !== "ok" && rows.length > 0);
  const fallback = rows.length === 0 ? fallbackFor(source.id, source.run?.error ?? "") : null;
  return {
    ...source,
    stale,
    staleReason: stale ? source.run?.error ?? "" : "",
    rowsFetchedAt: stale ? rows[0]?.fetchedAt ?? "" : "",
    fallbackId: fallback?.sourceId ?? "",
    fallbackNote: fallback?.note ?? "",
  };
}

function presentPrice(row: PriceView) {
  const condition = showIntro(row.condition);
  const quota = showIntro(row.quota);
  const reset = showIntro(row.reset);
  const useful = (text: string) => text && text !== "说明见右侧原文";
  const brief = [row.product, row.metric, cnyLabel(row.price, row.amount, row.currency), row.unit, useful(condition) ? condition : "", useful(quota) ? quota : "", useful(reset) ? reset : ""].filter(Boolean).join(" ");
  return {
    ...row,
    price: cnyLabel(row.price, row.amount, row.currency),
    amount: row.price === "未标价" ? row.amount : cnyAmount(row.amount, row.currency),
    currency: row.price === "未标价" || row.currency === "" ? row.currency : "CNY" as const,
    condition,
    quota,
    reset,
    brief,
    officialPrice: row.price,
  };
}

function presentEvent(row: EventView) {
  const brief = introText(row.brief);
  const detail = shownText(showIntro(row.detail, row.brief, true));
  const title = introText(row.title) || (hasHan(row.title) && englishTitle(row.title) ? shownText(row.title) : "") || brief || "说明见右侧原文";
  return { ...row, title, detail, brief: brief || detail };
}

function englishTitle(text: string): boolean {
  return (text.match(/[A-Za-z]{4,}/g) ?? []).length <= 3;
}

function presentHeat(heat: string): string {
  const labeled = heat.replace(/\bKnowledge\b/g, "知识").replace(/\bSwag\b/g, "周边");
  return labeled.replace(/(\d[\d,]*)\s*Usd\b/gi, (full, amount: string) => {
    const value = Number(amount.replace(/,/g, ""));
    if (!Number.isFinite(value)) return full;
    return `约${cnyLabel(full, value, "USD")}`;
  });
}

function presentHot(row: HotView) {
  const brief = introText(row.brief);
  const usable = Boolean(brief) && !/-to-/.test(brief) && (brief.replace(/\b(lora|gguf|api|html|svg|cpu|gpu|bf16|fp8)\b/gi, " ").match(/[A-Za-z]{4,}/g) ?? []).length <= 2;
  const summary = usable ? brief : showIntro(row.summary);
  const shown = (summary.match(/[A-Za-z]{4,}/g) ?? []).length > 2 ? "说明见右侧原文" : summary;
  return { ...row, heat: presentHeat(row.heat), summary: shown, brief: usable ? brief : shown };
}

function presentColumn(column: ColumnKind, rows: PriceView[] | RankView[] | HotView[] | EventView[]) {
  switch (column) {
    case "price":
      return (rows as PriceView[]).map(presentPrice);
    case "event":
      return (rows as EventView[]).map(presentEvent);
    case "hot":
      return (rows as HotView[]).map(presentHot);
    case "rank":
      return rows as RankView[];
    default: {
      const unreachable: never = column;
      return unreachable;
    }
  }
}

function presentDiff(diff: DiffView): DiffView {
  if (diff.field !== "价格") return diff;
  return { ...diff, oldValue: displayMoneyText(diff.oldValue), newValue: displayMoneyText(diff.newValue) };
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
