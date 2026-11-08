import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { request } from "../api";

interface SourceItem {
  id: string;
  vendor: string;
  kind: string;
  label: string;
  url: string;
  status: string;
  error: string;
  fetchedAt: string;
}

interface RunState { state: string; done: number; total: number; error: string }

const FILTERS: Array<{ id: string; label: string }> = [
  { id: "all", label: "全部" },
  { id: "api_price", label: "API 价" },
  { id: "plan", label: "套餐" },
  { id: "changelog", label: "更新日志" },
  { id: "news", label: "新闻" },
  { id: "status", label: "状态页" },
  { id: "model_card", label: "模型卡" },
  { id: "hotlist", label: "热榜" },
  { id: "leaderboard", label: "公开榜" },
];

export function CollectPage() {
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [run, setRun] = useState<RunState>({ state: "idle", done: 0, total: 0, error: "" });
  const [filter, setFilter] = useState("all");
  const [focus, setFocus] = useState("");
  const [error, setError] = useState("");

  function load() {
    request<{ sources: SourceItem[]; run: RunState }>("/api/ledger/sources").then((body) => {
      setSources(body.sources);
      setRun(body.run);
      setFocus((current) => current || body.sources[0]?.id || "");
    }).catch((reason: Error) => setError(reason.message));
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, []);

  async function start() {
    setError("");
    try {
      await request("/api/ledger/run", { method: "POST", body: "{}" });
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "没有开始。");
    }
  }

  const visible = sources.filter((source) => filter === "all" || source.kind === filter);
  const current = sources.find((source) => source.id === focus) ?? visible[0];
  const ok = sources.filter((source) => source.status === "ok").length;
  const bad = sources.filter((source) => source.status === "failed" || source.status === "blocked").length;

  return (
    <div className="desk ledger-desk">
      <header className="desk-top">
        <Link className="desk-back" to="/" aria-label="回到首页">←</Link>
        <h1 className="desk-title">采集</h1>
        <span className="desk-status">{run.state === "running" ? `正在跑 ${run.done}/${run.total}` : `成功 ${ok} / 失败 ${bad}`}</span>
        <div className="desk-top-gap" />
        <button className="desk-go" type="button" disabled={run.state === "running"} onClick={() => void start()}>再跑一轮</button>
      </header>
      {error || run.error ? <p className="ledger-error">{error || run.error}</p> : null}
      <div className="desk-body">
        <aside className="desk-side" style={{ width: 180 }}>
          <div className="archive">
            <h2>类型</h2>
            {FILTERS.map((item) => (
              <button key={item.id} className={filter === item.id ? "archive-row on" : "archive-row"} type="button" onClick={() => setFilter(item.id)}>{item.label}</button>
            ))}
          </div>
        </aside>
        <main className="desk-main">
          <div className="ledger-sheet">
            <table>
              <thead><tr><th>厂商</th><th>页面</th><th>结果</th><th>时间</th></tr></thead>
              <tbody>
                {visible.map((source) => (
                  <tr key={source.id} className={source.id === current?.id ? "on" : ""} onClick={() => setFocus(source.id)}>
                    <td>{source.vendor}</td>
                    <td>{source.label}</td>
                    <td className={source.status === "failed" || source.status === "blocked" ? "bad" : ""}>{source.status || "未跑"}</td>
                    <td className="num">{source.fetchedAt ? source.fetchedAt.slice(11, 16) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="shot-empty">月之暗面和智谱还没有定价表地址，所以不在这张表里。OpenRouter 不抓。</p>
          </div>
        </main>
        <aside className="desk-pane" style={{ width: 360 }}>
          <div className="excerpt">
            <h2>这一次</h2>
            {current ? (
              <>
                <p>{current.vendor} · {current.label}</p>
                <a href={current.url}>{current.url}</a>
                <p>{current.error || (current.status === "ok" ? "这一页已经留下原文。" : "还没有跑过。")}</p>
                <p>失败或被拦下时，不用其他网站填数。</p>
              </>
            ) : <p>没有来源。</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}
