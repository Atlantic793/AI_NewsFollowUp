import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { request } from "../api";
import { COLUMN_TITLES, clock, type DiffView, type EventView, type PriceView, type RankView } from "../types";

interface Hit {
  name: string;
  prices: PriceView[];
  ranks: RankView[];
  events: EventView[];
  diffs: DiffView[];
}

export function WatchPage() {
  const [names, setNames] = useState<string[]>([]);
  const [hits, setHits] = useState<Hit[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  function load() {
    request<{ names: string[]; hits: Hit[] }>("/api/ledger/watch").then((body) => {
      setNames(body.names);
      setHits(body.hits);
    }).catch((reason: Error) => setError(reason.message));
  }

  useEffect(() => { load(); }, []);

  async function add() {
    if (!draft.trim()) return;
    await request("/api/ledger/watch", { method: "POST", body: JSON.stringify({ name: draft }) });
    setDraft("");
    load();
  }

  async function remove(name: string) {
    await request(`/api/ledger/watch/${encodeURIComponent(name)}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="desk ledger-desk">
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
              <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="模型或套餐名，例如 deepseek-flash" aria-label="模型或套餐名" />
              <button type="submit">添加</button>
            </form>
          </div>
        </aside>
        <main className="desk-main">
          <div className="feed">
            {hits.length === 0 ? <div className="feed-empty"><p>名单是空的。加一个模型或套餐的名字，这里会列出它在各栏里的行和今天的变化。</p></div> : null}
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
                ) : <p className="story-copy">今天没有变化。</p>}
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
                    {hit.events.map((row) => <li key={`e${row.id}`}><small>{row.vendor} · {row.date}</small>{row.title}</li>)}
                  </ul>
                ) : null}
                {hit.prices.length + hit.ranks.length + hit.events.length === 0 ? <p className="story-copy">库里还没有这个名字的行。</p> : null}
              </article>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
