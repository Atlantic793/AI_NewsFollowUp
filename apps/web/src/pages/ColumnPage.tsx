import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { request } from "../api";
import { startRun, waitRun } from "../run";
import {
  COLUMN_TITLES,
  clock,
  eventTypeName,
  statusName,
  type EventType,
  type EventView,
  type HotView,
  type Kind,
  type PriceView,
  type RankView,
  type SourceView,
} from "../types";

interface ColumnBody {
  kind: Kind;
  day: string;
  changes: number;
  push: boolean;
  baseline: boolean;
  usdToCny: number;
  blocked: Array<{ label: string; fallbackId: string; note: string }>;
  sources: SourceView[];
  rows: unknown[];
}

interface Brief {
  mode: "llm" | "rule";
  text: string;
  hits: number;
}

interface Shown {
  id: number;
  rowIds: number[];
  sourceId: string;
  facet: string;
  cells: ReactNode[];
  search: string;
  title: string;
  excerpt: string;
  link: string;
  fetchedAt: string;
  brief: string;
  officialPrice: string;
  price: string;
}

interface Shape {
  heads: string[];
  facets: Array<{ id: string; label: string }>;
  items: Shown[];
}

export function ColumnPage() {
  const { kind = "price" } = useParams();
  const column = (kind in COLUMN_TITLES ? kind : "price") as Kind;
  const [data, setData] = useState<ColumnBody | null>(null);
  const [focus, setFocus] = useState("");
  const [facet, setFacet] = useState("all");
  const [query, setQuery] = useState("");
  const [rowId, setRowId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [grouped, setGrouped] = useState(true);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);

  function load() {
    request<ColumnBody>(`/api/ledger/column/${column}`).then(setData).catch((reason: Error) => setError(reason.message));
  }

  useEffect(() => {
    setData(null);
    setFocus("");
    setFacet("all");
    setQuery("");
    setRowId(null);
    setBrief(null);
    load();
  }, [column]);

  async function run() {
    if (!data) return;
    setError("");
    try {
      const ids = data.sources.filter((source) => source.enabled).map((source) => source.id);
      await startRun(ids);
      await waitRun((state) => setBusy(state.state === "running" ? `正在抓取 ${state.done}/${state.total}` : ""));
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "没有跑完。");
    } finally {
      setBusy("");
    }
  }

  async function togglePush() {
    if (!data) return;
    setError("");
    try {
      await request(`/api/ledger/column/${column}/push`, { method: "POST", body: JSON.stringify({ enabled: !data.push }) });
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "推送开关没有更新。");
    }
  }

  const shape = useMemo(() => shapeOf(column, data?.rows ?? [], data?.sources ?? [], column === "price" && grouped), [column, data, grouped]);
  const needle = query.trim().toLocaleLowerCase();
  const items = shape.items.filter((item) =>
    (!focus || item.sourceId === focus) && (facet === "all" || item.facet === facet) && (!needle || item.search.includes(needle)));
  const selected = items.find((item) => item.id === rowId) ?? null;
  const source = data?.sources.find((item) => item.id === focus) ?? null;
  const sourceOf = (id: string) => data?.sources.find((item) => item.id === id);

  async function summarize(rowId?: number) {
    const item = rowId === undefined ? undefined : shape.items.find((item) => item.id === rowId);
    const text = item?.title ?? query;
    if (!text.trim()) return;
    setBriefBusy(true);
    setError("");
    try {
      setBrief(await request<Brief>(`/api/ledger/column/${column}/brief`, {
        method: "POST",
        body: JSON.stringify({ query: text, rowIds: item?.rowIds }),
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "概括没有完成。");
    } finally {
      setBriefBusy(false);
    }
  }

  return (
    <div className="desk ledger-desk">
      <header className="desk-top">
        <Link className="desk-back" to="/" aria-label="回到首页">←</Link>
        <h1 className="desk-title">{COLUMN_TITLES[column]}</h1>
        <span className="desk-status">{data?.baseline && (data?.changes ?? 0) === 0 ? "基线，还没有上一轮可比" : `今日 ${data?.changes ?? 0} 处变化`}</span>
        <div className="desk-top-gap" />
        <button className="desk-go" type="button" disabled={Boolean(busy)} onClick={() => void run()}>{busy || "立即抓取"}</button>
        <label className="desk-morning">
          推送
          <button className={data?.push ? "desk-switch on" : "desk-switch"} type="button" role="switch" aria-checked={Boolean(data?.push)} title="打开后，抓取结束会把这一栏的变化写进本机 digests 目录" onClick={() => void togglePush()}><i /></button>
        </label>
      </header>
      {error ? <p className="ledger-error">{error}</p> : null}
      <div className="desk-body">
        <aside className="desk-side" style={{ width: 210 }}>
          <div className="archive">
            <h2>来源</h2>
            <button className={focus === "" ? "archive-row on" : "archive-row"} type="button" onClick={() => { setFocus(""); setRowId(null); }}>
              <span>全部来源</span>
              <em>{shape.items.length} 行</em>
            </button>
            {(data?.sources ?? []).map((item) => (
              <button key={item.id} className={item.id === focus ? "archive-row on" : "archive-row"} type="button" onClick={() => { setFocus(item.id); setRowId(null); }}>
                <span className="source-name"><b>{item.vendor}</b>{item.label}</span>
                <em className={item.run && item.run.status !== "ok" ? "warn" : ""}>{statusName(item.run, item.enabled)}</em>
              </button>
            ))}
          </div>
        </aside>
        <div className="desk-split" />
        <main className="desk-main ledger-main">
          <div className="ledger-sheet">
            <div className="ledger-tools">
              <input value={query} onChange={(event) => { setQuery(event.target.value); setBrief(null); }} placeholder="搜模型、产品、标题" aria-label="搜索" />
              <button type="button" disabled={briefBusy || !query.trim()} onClick={() => void summarize()}>{briefBusy ? "概括中" : "概括"}</button>
              {column === "price" ? <button type="button" className={grouped ? "on" : ""} onClick={() => setGrouped((value) => !value)}>{grouped ? "按产品" : "每一格"}</button> : null}
              {shape.facets.length > 0 ? (
                <div className="ledger-facets">
                  {[{ id: "all", label: "全部" }, ...shape.facets].map((item) => (
                    <button key={item.id} type="button" className={facet === item.id ? "on" : ""} onClick={() => setFacet(item.id)}>{item.label}</button>
                  ))}
                </div>
              ) : null}
              <span className="ledger-count">{items.length} 行</span>
            </div>
            {brief ? <pre className="ledger-brief">{brief.mode === "llm" ? "模型概括" : "规则概括"} · {brief.hits} 行原文\n{brief.text}</pre> : null}
            {column === "price" ? <p className="ledger-note">价格已换算成人民币，汇率 1 美元 = {data?.usdToCny ?? 7.2} 元。官网标价留在右侧原文里。</p> : null}
            {(data?.blocked ?? []).map((page) => <p key={page.label} className="ledger-note">{page.label}：{page.note}</p>)}
            {column === "event" && facet === "cn_access" && items.length === 0 ? <p className="ledger-note">这些官网页面没有在同一句里同时写到中国大陆和注册、调用或付款，所以这里是空的。</p> : null}
            {source?.stale ? (
              <p className="ledger-note">本轮没有新的正文：{source.staleReason}。下面是上次成功的内容，抓取于 {clock(source.rowsFetchedAt ?? "")}。</p>
            ) : source && source.run && source.run.status !== "ok" ? (
              <p className="ledger-note">{statusName(source.run, source.enabled)}：{source.run.error}。<Link to="/collect">去采集页看这一页的抓取和清洗记录</Link></p>
            ) : null}
            {items.length === 0 && source?.fallbackId ? (
              <p className="ledger-note">这一页还没有可显示的行。{source.fallbackNote} <button type="button" onClick={() => setFocus(source.fallbackId ?? "")}>改看 {source.fallbackId}</button></p>
            ) : null}
            {items.length > 0 ? (
              <table>
                <thead><tr>{shape.heads.map((head) => <th key={head}>{head}</th>)}</tr></thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className={item.id === selected?.id ? "on" : ""} onClick={() => setRowId(item.id)}>
                      {item.cells.map((cell, index) => <td key={index}>{cell}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {data && items.length === 0 ? <p className="shot-empty ledger-empty">{emptyText(source, shape.items.length > 0)}</p> : null}
          </div>
        </main>
        <div className="desk-split" />
        <aside className="desk-pane" style={{ width: 340 }}>
          <div className="excerpt">
            <h2>原文片段</h2>
            {selected ? (
              <>
                <p className="excerpt-title">{selected.title}</p>
                {selected.brief ? <p>{selected.brief}</p> : null}
                {selected.officialPrice && selected.officialPrice !== selected.price ? <p>原文标价 {selected.officialPrice}</p> : null}
                <blockquote>{selected.excerpt || "这一行没有留下原文片段。"}</blockquote>
                {selected.link ? <a href={selected.link} target="_blank" rel="noreferrer">打开原页面</a> : null}
                <button type="button" disabled={briefBusy} onClick={() => void summarize(selected.id)}>概括这一段</button>
                <p>来源：{sourceOf(selected.sourceId)?.vendor} · {sourceOf(selected.sourceId)?.label}</p>
                <p>抓取于 {clock(selected.fetchedAt)}</p>
              </>
            ) : <p>点中间的一行，这里显示这一行在原页面里的那一段文字。</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}

function emptyText(source: SourceView | null, hasRows: boolean): string {
  if (source?.fallbackId) return "上面写了可以改看的来源。";
  if (source?.stale) return "上面是上次成功的内容。";
  if (hasRows) return "没有符合筛选条件的行。";
  if (source && !source.enabled) return "这个来源没有启用。";
  if (source?.run?.status === "没抽出") return "没抽出。若上一轮成功过，那些行还留着。";
  return "还没有数据。点「立即抓取」跑一轮。";
}

function priceItem(row: PriceView, extra = ""): Shown {
  return {
    id: row.id,
    rowIds: [row.id],
    sourceId: row.sourceId,
    facet: row.kind,
    cells: [
      <span key="v" className="nowrap">{row.vendor}</span>,
      <b key="p">{row.product}</b>,
      <span key="t" className="nowrap">{row.tier}</span>,
      row.metric,
      row.condition || "—",
      <span key="m" className="num nowrap">{row.price}</span>,
      <span key="u" className="nowrap">{row.unit || "—"}</span>,
      <span key="q" className="clip">{extra || [row.quota, row.reset].filter(Boolean).join("；") || "—"}</span>,
    ],
    search: `${row.vendor} ${row.product} ${row.metric} ${row.condition} ${row.tier} ${row.brief}`.toLocaleLowerCase(),
    title: `${row.product} · ${row.metric}${row.condition ? ` · ${row.condition}` : ""}`,
    excerpt: row.excerpt,
    link: row.page,
    fetchedAt: row.fetchedAt,
    brief: row.brief,
    officialPrice: row.officialPrice ?? row.price,
    price: row.price,
  };
}

function groupPriceItems(rows: readonly PriceView[]): Shown[] {
  const groups = new Map<string, PriceView[]>();
  for (const row of rows) {
    const key = `${row.sourceId}|${row.product}|${row.tier}|${row.condition}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return [...groups.values()].map((list) => {
    const head = list.find((row) => row.metric === "输入" || row.metric.startsWith("输入")) ?? list[0];
    if (!head) return priceItem(list[0] as PriceView);
    const rest = list.filter((row) => row !== head).map((row) => `${row.metric} ${row.price}${row.unit ? ` ${row.unit}` : ""}`);
    const item = priceItem(head, [...rest, head.quota, head.reset].filter(Boolean).join("；"));
    item.rowIds = list.map((row) => row.id);
    item.search = list.map((row) => `${row.vendor} ${row.product} ${row.metric} ${row.condition}`).join(" ").toLocaleLowerCase();
    item.excerpt = list.map((row) => `${row.metric} ${row.price}\n${row.excerpt}`).join("\n\n");
    return item;
  });
}

function shapeOf(kind: Kind, rows: unknown[], sources: SourceView[], groupPrices: boolean): Shape {
  const vendorOf = (id: string) => sources.find((source) => source.id === id)?.vendor ?? "";
  switch (kind) {
    case "price":
      return {
        heads: ["厂商", "产品", "档位", "计价项", "条件", "价格", "单位", "额度与重置"],
        facets: [{ id: "api", label: "API 按量" }, { id: "plan", label: "套餐" }],
        items: groupPrices ? groupPriceItems(rows as PriceView[]) : (rows as PriceView[]).map((row) => priceItem(row)),
      };
    case "rank":
      return {
        heads: ["榜单", "名次", "模型", "机构", "分数", "票数", "榜单日期"],
        facets: [],
        items: (rows as RankView[]).map((row) => ({
          id: row.id,
          rowIds: [row.id],
          sourceId: row.sourceId,
          facet: "",
          cells: [row.board, <span key="r" className="num">{row.basis === "sorted" ? `${row.rank}（按分数）` : row.rank}</span>, <b key="m">{row.model}</b>, row.org || "—", <span key="s" className="num">{row.score}</span>, row.votes || "—", row.boardDate || "页面未印日期"],
          search: `${row.board} ${row.model} ${row.org}`.toLocaleLowerCase(),
          title: `${row.board} ${row.basis === "sorted" ? "按分数排序" : `第 ${row.rank} 名`} · ${row.model}`,
          excerpt: row.excerpt,
          link: row.page,
          fetchedAt: row.fetchedAt,
          brief: row.brief,
          officialPrice: "",
          price: "",
        })),
      };
    case "hot":
      return {
        heads: ["来源", "名次", "条目", "热度", "简介"],
        facets: [],
        items: (rows as HotView[]).map((row) => ({
          id: row.id,
          rowIds: [row.id],
          sourceId: row.sourceId,
          facet: "",
          cells: [row.site, <span key="r" className="num">{row.rank}</span>, <a key="t" href={row.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{row.title}</a>, row.heat.replace(/(\d[\d,]*)\s+stars today/gi, "$1 个今日星标") || "—", row.summary || "—"],
          search: `${row.site} ${row.title} ${row.summary}`.toLocaleLowerCase(),
          title: row.title,
          excerpt: row.excerpt,
          link: row.url,
          fetchedAt: row.fetchedAt,
          brief: row.brief,
          officialPrice: "",
          price: "",
        })),
      };
    case "event": {
      const types: EventType[] = ["release", "news", "status", "incident", "cn_access"];
      return {
        heads: ["日期", "厂商", "类型", "标题", "说明"],
        facets: types.map((type) => ({ id: type, label: eventTypeName(type) })),
        items: (rows as EventView[]).map((row) => ({
          id: row.id,
          rowIds: [row.id],
          sourceId: row.sourceId,
          facet: row.type,
          cells: [<span key="d" className="num nowrap">{row.date}</span>, <span key="v" className="nowrap">{row.vendor || vendorOf(row.sourceId)}</span>, <span key="t" className={`tag tag-${row.type}`}>{eventTypeName(row.type)}</span>, <b key="h">{row.title}</b>, <span key="x" className="clip">{row.detail || "—"}</span>],
          search: `${row.vendor} ${row.title} ${row.detail} ${row.brief}`.toLocaleLowerCase(),
          title: row.title,
          excerpt: row.excerpt,
          link: row.url,
          fetchedAt: row.fetchedAt,
          brief: row.brief,
          officialPrice: "",
          price: "",
        })),
      };
    }
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}
