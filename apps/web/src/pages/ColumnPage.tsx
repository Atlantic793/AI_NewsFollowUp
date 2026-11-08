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
  sources: SourceView[];
  rows: unknown[];
}

interface Shown {
  id: number;
  sourceId: string;
  facet: string;
  cells: ReactNode[];
  search: string;
  title: string;
  excerpt: string;
  link: string;
  fetchedAt: string;
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

  function load() {
    request<ColumnBody>(`/api/ledger/column/${column}`).then(setData).catch((reason: Error) => setError(reason.message));
  }

  useEffect(() => {
    setData(null);
    setFocus("");
    setFacet("all");
    setQuery("");
    setRowId(null);
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
    await request(`/api/ledger/column/${column}/push`, { method: "POST", body: JSON.stringify({ enabled: !data.push }) });
    load();
  }

  const shape = useMemo(() => shapeOf(column, data?.rows ?? [], data?.sources ?? []), [column, data]);
  const needle = query.trim().toLocaleLowerCase();
  const items = shape.items.filter((item) =>
    (!focus || item.sourceId === focus) && (facet === "all" || item.facet === facet) && (!needle || item.search.includes(needle)));
  const selected = items.find((item) => item.id === rowId) ?? null;
  const source = data?.sources.find((item) => item.id === focus) ?? null;
  const sourceOf = (id: string) => data?.sources.find((item) => item.id === id);

  return (
    <div className="desk ledger-desk">
      <header className="desk-top">
        <Link className="desk-back" to="/" aria-label="回到首页">←</Link>
        <h1 className="desk-title">{COLUMN_TITLES[column]}</h1>
        <span className="desk-status">今日 {data?.changes ?? 0} 处变化</span>
        <div className="desk-top-gap" />
        <button className="desk-go" type="button" disabled={Boolean(busy)} onClick={() => void run()}>{busy || "立即抓取"}</button>
        <label className="desk-morning">
          推送
          <button className={data?.push ? "desk-switch on" : "desk-switch"} type="button" role="switch" aria-checked={Boolean(data?.push)} onClick={() => void togglePush()}><i /></button>
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
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜模型、产品、标题" aria-label="搜索" />
              {shape.facets.length > 0 ? (
                <div className="ledger-facets">
                  {[{ id: "all", label: "全部" }, ...shape.facets].map((item) => (
                    <button key={item.id} type="button" className={facet === item.id ? "on" : ""} onClick={() => setFacet(item.id)}>{item.label}</button>
                  ))}
                </div>
              ) : null}
              <span className="ledger-count">{items.length} 行</span>
            </div>
            {source && source.run && source.run.status !== "ok" ? (
              <p className="ledger-note">{statusName(source.run, source.enabled)}：{source.run.error}。<Link to="/collect">去采集页看这一页的抓取和清洗记录</Link></p>
            ) : null}
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
                <blockquote>{selected.excerpt || "这一行没有留下原文片段。"}</blockquote>
                {selected.link ? <a href={selected.link} target="_blank" rel="noreferrer">打开原页面</a> : null}
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
  if (hasRows) return "没有符合筛选条件的行。";
  if (source && !source.enabled) return "这个来源没有启用。";
  if (source?.run?.status === "没抽出") return "没抽出：这一页没有对上这一栏要的表或条目，旧行已经清掉。";
  return "还没有数据。点「立即抓取」跑一轮。";
}

function shapeOf(kind: Kind, rows: unknown[], sources: SourceView[]): Shape {
  const vendorOf = (id: string) => sources.find((source) => source.id === id)?.vendor ?? "";
  switch (kind) {
    case "price":
      return {
        heads: ["厂商", "产品", "档位", "计价项", "条件", "价格", "单位", "额度与重置"],
        facets: [{ id: "api", label: "API 按量" }, { id: "plan", label: "套餐" }],
        items: (rows as PriceView[]).map((row) => ({
          id: row.id,
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
            <span key="q" className="clip">{[row.quota, row.reset].filter(Boolean).join("；") || "—"}</span>,
          ],
          search: `${row.vendor} ${row.product} ${row.metric} ${row.condition} ${row.tier}`.toLocaleLowerCase(),
          title: `${row.product} · ${row.metric}${row.condition ? ` · ${row.condition}` : ""}`,
          excerpt: row.excerpt,
          link: row.page,
          fetchedAt: row.fetchedAt,
        })),
      };
    case "rank":
      return {
        heads: ["榜单", "名次", "模型", "机构", "分数", "票数", "榜单日期"],
        facets: [],
        items: (rows as RankView[]).map((row) => ({
          id: row.id,
          sourceId: row.sourceId,
          facet: "",
          cells: [row.board, <span key="r" className="num">{row.rank}</span>, <b key="m">{row.model}</b>, row.org || "—", <span key="s" className="num">{row.score}</span>, row.votes || "—", row.boardDate || "榜上没写"],
          search: `${row.board} ${row.model} ${row.org}`.toLocaleLowerCase(),
          title: `${row.board} 第 ${row.rank} 名 · ${row.model}`,
          excerpt: row.excerpt,
          link: row.page,
          fetchedAt: row.fetchedAt,
        })),
      };
    case "hot":
      return {
        heads: ["来源", "名次", "条目", "热度", "简介"],
        facets: [],
        items: (rows as HotView[]).map((row) => ({
          id: row.id,
          sourceId: row.sourceId,
          facet: "",
          cells: [row.site, <span key="r" className="num">{row.rank}</span>, <a key="t" href={row.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{row.title}</a>, row.heat || "—", row.summary || "—"],
          search: `${row.site} ${row.title} ${row.summary}`.toLocaleLowerCase(),
          title: row.title,
          excerpt: row.excerpt,
          link: row.url,
          fetchedAt: row.fetchedAt,
        })),
      };
    case "event": {
      const types: EventType[] = ["release", "news", "status", "incident", "cn_access"];
      return {
        heads: ["日期", "厂商", "类型", "标题", "说明"],
        facets: types.map((type) => ({ id: type, label: eventTypeName(type) })),
        items: (rows as EventView[]).map((row) => ({
          id: row.id,
          sourceId: row.sourceId,
          facet: row.type,
          cells: [<span key="d" className="num nowrap">{row.date}</span>, <span key="v" className="nowrap">{row.vendor || vendorOf(row.sourceId)}</span>, <span key="t" className={`tag tag-${row.type}`}>{eventTypeName(row.type)}</span>, <b key="h">{row.title}</b>, <span key="x" className="clip">{row.detail || "—"}</span>],
          search: `${row.vendor} ${row.title} ${row.detail}`.toLocaleLowerCase(),
          title: row.title,
          excerpt: row.excerpt,
          link: row.url,
          fetchedAt: row.fetchedAt,
        })),
      };
    }
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}
