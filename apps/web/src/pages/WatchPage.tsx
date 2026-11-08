import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { request } from "../api";

interface DiffItem {
  id: number;
  tableName: string;
  field: string;
  oldValue: string;
  newValue: string;
  fetchedAt: string;
  label: string;
}

const GROUP: Record<string, string> = { prices: "价目", ranks: "排名", hot: "热榜", events: "厂商动态" };

export function WatchPage() {
  const [names, setNames] = useState<string[]>([]);
  const [diffs, setDiffs] = useState<DiffItem[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  function load() {
    request<{ names: string[]; diffs: DiffItem[] }>("/api/ledger/watch").then((body) => {
      setNames(body.names);
      setDiffs(body.diffs);
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
        <span className="desk-status">只看勾过的名字</span>
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
              <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="模型或套餐名" aria-label="模型或套餐名" />
              <button type="submit">添加</button>
            </form>
          </div>
        </aside>
        <main className="desk-main">
          <div className="feed">
            {diffs.length === 0 ? <div className="feed-empty"><p>今天没有这些名字的新变化。</p><Link to="/">回到首页看全表</Link></div> : null}
            {diffs.map((diff) => (
              <article className="story" key={diff.id}>
                <small>{GROUP[diff.tableName] ?? diff.tableName}</small>
                <strong>{diff.label}</strong>
                <p className="story-copy">{diff.field === "row" ? diff.newValue : `${diff.field}：${diff.oldValue || "空"} → ${diff.newValue}`}</p>
                <div className="story-notes"><span>{diff.fetchedAt.slice(0, 16).replace("T", " ")}</span></div>
              </article>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
