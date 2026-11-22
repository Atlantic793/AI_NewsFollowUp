import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { request } from "../api";
import { COLUMN_TITLES, clock, type DiffView, type EventView, type HotView, type PriceView, type RankView } from "../types";

interface Hit {
  name: string;
  prices: PriceView[];
  ranks: RankView[];
  events: EventView[];
  diffs: DiffView[];
  noMatchReason: string;
  hot: HotView[];
}

export function WatchPage() {
  const [names, setNames] = useState<string[]>([]);
  const [hits, setHits] = useState<Hit[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState<Array<{ name: string; columns: string[] }>>([]);
  const [saving, setSaving] = useState(false);

  function load() {
    request<{ names: string[]; hits: Hit[]; candidates: Array<{ name: string; columns: string[] }> }>("/api/ledger/watch").then((body) => {
      setNames(body.names);
      setHits(body.hits);
      setCandidates(body.candidates);
    }).catch((reason: Error) => setError(reason.message));
  }

  useEffect(() => { load(); }, []);

  async function add() {
    if (!draft.trim()) return;
    setError("");
    setSaving(true);
    try {
      await request("/api/ledger/watch", { method: "POST", body: JSON.stringify({ name: draft }) });
      setDraft("");
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "追踪名单没有更新。");
    } finally {
      setSaving(false);
    }
  }

  async function remove(name: string) {
    setError("");
    try {
      await request(`/api/ledger/watch/${encodeURIComponent(name)}`, { method: "DELETE" });
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "没有移除这个名字。");
    }
  }

  return (
    <div className="desk ledger-desk watch-desk">
      <header className="desk-top">
        <Link className="desk-back" to="/" aria-label="回到首页">←</Link>
        <h1 className="desk-title">定制追踪</h1>
        <span className="desk-status">只看名单里的名字</span>
      </header>
      {error ? <p className="ledger-error">{error}</p> : null}
      <div className="desk-body">
        <aside className="desk-side" style={{ width: 280 }}>
          <div className="archive">
            <h2>我的名单</h2>
            {names.map((name) => (
              <div className="watch-row" key={name}>
                <span>{name}</span>
                <button type="button" onClick={() => void remove(name)}>去掉</button>
              </div>
            ))}
            <form className="archive-add" onSubmit={(event) => { event.preventDefault(); void add(); }}>
              <input value={draft} list="watch-candidates" onChange={(event) => setDraft(event.target.value)} placeholder="搜索已有模型，或输入完整名称" aria-label="模型或套餐名" />
              <datalist id="watch-candidates">{candidates.map((item) => <option key={item.name} value={item.name}>{item.columns.join("、")}</option>)}</datalist>
              <button type="submit" disabled={saving || !draft.trim()}>{saving ? "添加中" : "添加"}</button>
            </form>
            <p className="watch-help">从已入库的 {candidates.length} 个名称中选择。也可以在价目表、排名和热榜直接点关注。</p>
            {draft.trim() ? <ul className="watch-suggestions">{candidates.filter((item) => item.name.toLocaleLowerCase().includes(draft.trim().toLocaleLowerCase()) && !names.includes(item.name)).slice(0, 8).map((item) => <li key={item.name}><button type="button" onClick={() => setDraft(item.name)}>{item.name}<small>{item.columns.join("、")}</small></button></li>)}</ul> : null}
          </div>
        </aside>
        <main className="desk-main">
          <div className="feed">
            {hits.length === 0 ? <div className="feed-empty"><p>名单是空的。写完整的模型名或套餐名，例如 deepseek-flash。pro、opus 这种短词不会匹配。</p></div> : null}
            {hits.map((hit) => (
              <article className="story" key={hit.name}>
                <strong>{hit.name}</strong>
                {hit.diffs.length > 0 ? (
                  <ul className="watch-list">
                    {hit.diffs.map((diff) => (
                      <li key={diff.id}>
                        <small>{COLUMN_TITLES[diff.column]} · {clock(diff.fetchedAt)}</small>
                        {diff.label}：{diff.field === "row" ? diff.newValue : `${diff.field} ${diff.oldValue || "空"} → ${diff.newValue}`}
                      </li>
                    ))}
                  </ul>
                ) : <p className="story-copy">今天没有记录到匹配的变化。</p>}
                {hit.prices.length > 0 ? (
                  <ul className="watch-list">
                    {hit.prices.slice(0, 8).map((row) => <li key={`p${row.id}`}><small>{row.vendor} · {row.tier}</small>{row.product} {row.metric}{row.condition ? `（${row.condition}）` : ""}：<b>{row.price}</b> {row.unit}</li>)}
                    {hit.prices.length > 8 ? <li><Link to="/columns/price">还有 {hit.prices.length - 8} 行，去价目表搜</Link></li> : null}
                  </ul>
                ) : null}
                {hit.ranks.length > 0 ? (
                  <ul className="watch-list">
                    {hit.ranks.map((row) => <li key={`r${row.id}`}><small>{row.board}</small>{row.model}：第 {row.rank} 名 · {row.score}</li>)}
                  </ul>
                ) : null}
                {hit.events.length > 0 ? (
                  <ul className="watch-list">
                    {hit.events.map((row) => <li key={`e${row.id}`}><small>{row.vendor} · {row.date}</small>{row.brief || row.title}</li>)}
                  </ul>
                ) : null}
                {hit.hot.length > 0 ? <ul className="watch-list">{hit.hot.map((row) => <li key={row.id}><small>{row.site} · 第 {row.rank} 名</small><a href={row.url} target="_blank" rel="noreferrer">{row.title}</a> · {row.summary || row.heat}</li>)}</ul> : null}
                {hit.noMatchReason ? <p className="ledger-note">{hit.noMatchReason} <Link to="/collect">查看采集情况</Link></p> : null}
              </article>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
