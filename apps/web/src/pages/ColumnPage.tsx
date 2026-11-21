import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { request } from "../api";
import { HighlightedExcerpt, briefLabel, originLabel, type EvidenceField } from "../components/Evidence";
import { EMPTY_PRICE_FILTERS, cacheOf, contextOf, filterPrices, priceGroup, priceIn, regionOf, sortPrices, type PriceFilters } from "../price-tools";
import { startRun, waitRun } from "../run";
import {
  COLUMN_TITLES,
  clock,
  diffText,
  eventTypeName,
  statusName,
  type EventType,
  type DiffView,
  type EventView,
  type HotView,
  type Kind,
  type PriceView,
  type RankView,
  type SourceView,
  type RowBase,
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
  diffs: DiffView[];
  watches: string[];
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
  watchName: string;
  evidence: EvidenceRow[];
}

interface EvidenceRow extends RowBase { title: string; fields: EvidenceField[] }

interface Shape {
  heads: string[];
  facets: Array<{ id: string; label: string }>;
  items: Shown[];
}

export function ColumnPage() {
  const { kind = "price" } = useParams();
  const [params] = useSearchParams();
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
  const [priceFilters, setPriceFilters] = useState<PriceFilters>({ ...EMPTY_PRICE_FILTERS });
  const [currency, setCurrency] = useState<"cny" | "original">("cny");
  const [order, setOrder] = useState("default");
  const [showChanges, setShowChanges] = useState(params.get("changes") === "1");
  const [evidenceIndex, setEvidenceIndex] = useState(0);
  const [fieldKey, setFieldKey] = useState("");
  const [watchBusy, setWatchBusy] = useState("");
  const [notice, setNotice] = useState("");

  function load() {
    request<ColumnBody>(`/api/ledger/column/${column}`).then(setData).catch((reason: Error) => setError(reason.message));
  }

  useEffect(() => {
    setData(null);
    setFocus(params.get("source") ?? "");
    setFacet("all");
    setQuery("");
    setRowId(null);
    setBrief(null);
    setPriceFilters({ ...EMPTY_PRICE_FILTERS });
    setOrder("default");
    setShowChanges(params.get("changes") === "1");
    load();
  }, [column]);

  async function run() {
    if (!data) return;
    setError("");
    setBusy("正在开始采集");
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

  const priceRows = useMemo(() => (data?.rows ?? []) as PriceView[], [data]);
  const filteredRows = useMemo(() => column === "price" ? sortPrices(filterPrices(priceRows, priceFilters).map((row) => priceIn(row, currency)), order) : data?.rows ?? [], [column, data, priceRows, priceFilters, currency, order]);
  const shape = useMemo(() => shapeOf(column, filteredRows, data?.sources ?? [], column === "price" && grouped && order === "default"), [column, data, filteredRows, grouped, order]);
  const needle = query.trim().toLocaleLowerCase();
  const items = shape.items.filter((item) =>
    (!focus || item.sourceId === focus) && (facet === "all" || item.facet === facet) && (!needle || item.search.includes(needle)));
  const selected = items.find((item) => item.id === rowId) ?? null;
  const evidence = selected?.evidence[evidenceIndex] ?? selected?.evidence[0];
  const field = evidence?.fields.find((item) => item.key === fieldKey) ?? evidence?.fields[0];
  const source = data?.sources.find((item) => item.id === focus) ?? null;
  const sourceOf = (id: string) => data?.sources.find((item) => item.id === id);
  const diffs = (data?.diffs ?? []).filter((diff) => !focus || diff.sourceId === focus);

  async function follow(name: string) {
    setWatchBusy(name);
    setError("");
    try {
      await request("/api/ledger/watch", { method: "POST", body: JSON.stringify({ name }) });
      setData((current) => current ? { ...current, watches: [...new Set([...current.watches, name])] } : current);
      setNotice(`已关注 ${name}，可在定制追踪中查看。`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "关注没有完成。"); }
    finally { setWatchBusy(""); }
  }

  function selectRow(item: Shown, head: string) {
    setRowId(item.id);
    setEvidenceIndex(0);
    setFieldKey(({ "价格": "price", "日期": "date", "分数": "score", "票数": "votes", "单位": "unit", "条件": "condition", "额度与重置": "quota", "产品": "product", "模型": "model", "名次": "rank", "标题": "title" } as Record<string, string>)[head] ?? "");
  }

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
        <Link to="/watch">定制追踪</Link>
        <Link to="/digests">查看简报</Link>
        <button className="desk-go" type="button" disabled={Boolean(busy)} onClick={() => void run()}>{busy || "立即抓取"}</button>
        <label className="desk-morning">
          生成本地简报
          <button className={data?.push ? "desk-switch on" : "desk-switch"} type="button" role="switch" aria-label="生成本地简报" aria-checked={Boolean(data?.push)} title="采集后追加当天简报，可查看、复制和下载" onClick={() => void togglePush()}><i /></button>
        </label>
      </header>
      {error ? <p className="ledger-error">{error}</p> : null}
      {notice ? <p className="action-notice" role="status">{notice}</p> : null}
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
              {column === "price" ? <button type="button" disabled={order !== "default"} className={grouped && order === "default" ? "on" : ""} onClick={() => setGrouped((value) => !value)}>{grouped && order === "default" ? "按产品" : "每一格"}</button> : null}
              <button type="button" className={showChanges ? "on" : ""} onClick={() => setShowChanges((value) => !value)}>今日变化（{data?.changes ?? 0}）</button>
              {shape.facets.length > 0 ? (
                <div className="ledger-facets">
                  {[{ id: "all", label: "全部" }, ...shape.facets].map((item) => (
                    <button key={item.id} type="button" className={facet === item.id ? "on" : ""} onClick={() => setFacet(item.id)}>{item.label}</button>
                  ))}
                </div>
              ) : null}
              <span className="ledger-count">{items.length} 行</span>
            </div>
            {column === "price" ? <div className="price-filters">
              <PriceSelect label="地域" value={priceFilters.region} values={priceRows.map(regionOf)} onChange={(region) => setPriceFilters((current) => ({ ...current, region }))} />
              <PriceSelect label="上下文" value={priceFilters.context} values={priceRows.map(contextOf)} onChange={(context) => setPriceFilters((current) => ({ ...current, context }))} />
              <PriceSelect label="缓存" value={priceFilters.cache} values={priceRows.map(cacheOf)} onChange={(cache) => setPriceFilters((current) => ({ ...current, cache }))} />
              <PriceSelect label="档位" value={priceFilters.tier} values={priceRows.map((row) => row.tier)} onChange={(tier) => setPriceFilters((current) => ({ ...current, tier }))} />
              <PriceSelect label="计价项" value={priceFilters.metric} values={priceRows.map((row) => row.metric)} onChange={(metric) => setPriceFilters((current) => ({ ...current, metric }))} />
              <PriceSelect label="单位" value={priceFilters.unit} values={priceRows.map((row) => row.unit)} onChange={(unit) => setPriceFilters((current) => ({ ...current, unit }))} />
              <label>币种<select aria-label="币种" value={currency} onChange={(event) => setCurrency(event.target.value as "cny" | "original")}><option value="cny">人民币</option><option value="original">官网原币种</option></select></label>
              <label>价格排序<select aria-label="价格排序" value={order} onChange={(event) => setOrder(event.target.value)}><option value="default">来源顺序</option><option value="asc">价格从低到高</option><option value="desc">价格从高到低</option></select></label>
              <button className="secondary-button" type="button" onClick={() => { setPriceFilters({ ...EMPTY_PRICE_FILTERS }); setOrder("default"); }}>重置筛选</button>
            </div> : null}
            {showChanges ? <section className="column-changes" aria-label="今日变化">
              <h2>今日变化 · {source ? `${source.vendor} ${source.label}` : "全部来源"}</h2>
              {diffs.length ? <ul>{diffs.map((diff) => <li key={diff.id} id={`diff-${diff.id}`} className={params.get("diff") === String(diff.id) ? "selected-diff" : ""}><small>{diff.vendor} · {clock(diff.fetchedAt)}</small><button type="button" onClick={() => setQuery(diff.label)}>{diff.label}</button><span>{diffText(diff)}</span></li>)}</ul> : <p>今天没有记录到变化。首次成功采集只建立基线。</p>}
              {(data?.changes ?? 0) > (data?.diffs.length ?? 0) ? <p>此处显示最近 {data?.diffs.length} 处，更多变化可在当天简报中查看。</p> : null}
            </section> : null}
            {brief ? <pre className="ledger-brief">{brief.mode === "llm" ? "模型概括" : "规则概括"} · {brief.hits} 行原文\n{brief.text}</pre> : null}
            {column === "price" ? <p className="ledger-note">{currency === "cny" ? `当前显示人民币，按固定展示汇率 1 美元 = ${data?.usdToCny ?? 7.2} 元换算。` : "当前显示官网原币种。"}地域与上下文按页面已注明的条件筛选；“未注明”表示当前报价行没有记录。{order !== "default" ? `当前按计价项、单位和币种分成 ${new Set((filteredRows as PriceView[]).map(priceGroup)).size} 组，各组内排序；未标价排在末尾。排序时显示每一格。` : "先确认档位、计价项和单位，再比较价格。"}</p> : null}
            <p className="ledger-caption">点表格字段可在右侧核对原文。简报开关仅控制采集后生成本地文件。</p>
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
              <table className={`${column}-table`}>
                <thead><tr>{shape.heads.map((head) => <th key={head}>{head}</th>)}{column !== "event" ? <th>关注</th> : null}</tr></thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} tabIndex={0} className={item.id === selected?.id ? "on" : ""} onClick={() => setRowId(item.id)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); selectRow(item, ""); } }}>
                      {item.cells.map((cell, index) => <td key={index} onClick={() => selectRow(item, shape.heads[index] ?? "")}>{cell}</td>)}
                      {column !== "event" ? <td><button className="follow-button" type="button" disabled={!item.watchName || Boolean(watchBusy) || data?.watches.includes(item.watchName)} onClick={(event) => { event.stopPropagation(); void follow(item.watchName); }}>{data?.watches.includes(item.watchName) ? "已关注" : watchBusy === item.watchName ? "关注中" : "关注"}</button></td> : null}
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
                <p className="excerpt-title">{selected.evidence.length > 1 ? `${selected.watchName} · ${evidence?.title ?? ""}` : selected.title}</p>
                {selected.evidence.length > 1 ? <label className="evidence-choice">计价项<select aria-label="核对计价项" value={evidenceIndex} onChange={(event) => { setEvidenceIndex(Number(event.target.value)); setFieldKey(""); }}>{selected.evidence.map((item, index) => <option key={item.id} value={index}>{item.title}</option>)}</select></label> : null}
                <div className="evidence-tags"><span className="tag">{originLabel(evidence?.provenance?.extraction)}</span>{(evidence?.provenance?.modelFields ?? []).map((key) => <span className="tag tag-cn_access" key={key}>模型补充：{({ condition: "条件", quota: "额度", reset: "重置" } as Record<string, string>)[key] ?? key}</span>)}</div>
                {evidence?.brief ? <p><small>{briefLabel(evidence.provenance?.brief)}</small><br />{evidence.brief}</p> : null}
                <div className="evidence-fields">{(evidence?.fields ?? []).map((item) => <button className={field?.key === item.key ? "on" : ""} type="button" key={item.key} onClick={() => setFieldKey(item.key)}>{item.label}：{item.value}</button>)}</div>
                <blockquote><HighlightedExcerpt text={evidence?.excerpt || "这一行没有留下原文片段。"} value={field?.value ?? ""} /></blockquote>
                <p className="evidence-help">黄色标记为选中字段在片段中出现的原字或完整数字。翻译和单位归一可能改变写法，未标记时请结合整段核对。</p>
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

function PriceSelect({ label, value, values, onChange }: { label: string; value: string; values: string[]; onChange: (value: string) => void }) {
  return <label>{label}<select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}><option value="">全部</option>{[...new Set(values)].filter(Boolean).sort().map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}

function evidenceOf(row: PriceView | RankView | HotView | EventView): EvidenceRow {
  const fields: EvidenceField[] = [];
  const add = (key: string, label: string, value: string) => { if (value) fields.push({ key, label, value }); };
  let title = "";
  if ("product" in row) {
    title = `${row.metric} · ${row.officialPrice ?? row.price}`;
    add("price", "官网价格", row.officialPrice ?? row.price);
    add("unit", "单位", row.unit);
    add("product", "产品", row.product);
    add("condition", "条件", row.officialCondition ?? row.condition);
    add("quota", "额度", row.quota);
    add("reset", "重置", row.reset);
  } else if ("model" in row) {
    title = row.model;
    add("score", "分数", row.score);
    add("model", "模型", row.model);
    if (row.basis === "printed") add("rank", "名次", String(row.rank));
    add("votes", "票数", row.votes);
    add("date", "日期", row.boardDate);
  } else {
    title = row.title;
    if ("date" in row) add("date", "日期", row.date);
    else add("rank", "名次", String(row.rank));
    add("title", "标题", row.title);
  }
  return { ...row, title, fields };
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
    watchName: row.watchName ?? row.product,
    evidence: [evidenceOf(row)],
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
    item.evidence = list.map(evidenceOf);
    item.search = list.map((row) => `${row.vendor} ${row.product} ${row.metric} ${row.condition}`).join(" ").toLocaleLowerCase();
    item.excerpt = list.map((row) => row.excerpt).join("\n\n");
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
          watchName: row.watchName ?? row.model,
          evidence: [evidenceOf(row)],
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
          watchName: row.title,
          evidence: [evidenceOf(row)],
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
          watchName: "",
          evidence: [evidenceOf(row)],
        })),
      };
    }
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}
