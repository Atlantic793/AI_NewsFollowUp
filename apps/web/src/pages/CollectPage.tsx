import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { request } from "../api";
import { startRun } from "../run";
import { COLUMN_TITLES, clock, statusName, type Kind, type RunState, type SourceView } from "../types";

interface Reject { reason: string; excerpt: string }

const FILTERS: Array<{ id: Kind | "all"; label: string }> = [
  { id: "all", label: "全部" },
  { id: "price", label: COLUMN_TITLES.price },
  { id: "rank", label: COLUMN_TITLES.rank },
  { id: "hot", label: COLUMN_TITLES.hot },
  { id: "event", label: COLUMN_TITLES.event },
];

const NOT_COLLECTED = [
  "ChatGPT 定价页、help.openai.com：对程序返回 403，不绕过；Codex / ChatGPT 套餐改读 learn.chatgpt.com 的 Markdown。",
  "arena.ai 排行页：返回 403；改读 LMArena 在 Hugging Face 上发布的官方数据集。",
  "status.claude.com/api/：robots.txt 不允许，改读状态页 HTML。",
  "Kimi Code 会员套餐：官网没有静态价目页；GLM Coding Plan 文档里没有标价，只记额度。",
  "Kaggle 竞赛：官方 API 要凭据，没配就跳过。OpenRouter 等第三方聚合站不抓。",
];

function bytes(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  if (value >= 1_000) return `${Math.round(value / 1_000)} KB`;
  return `${value} B`;
}

export function CollectPage() {
  const [sources, setSources] = useState<SourceView[]>([]);
  const [run, setRun] = useState<RunState>({ state: "idle", done: 0, total: 0, current: "", error: "" });
  const [filter, setFilter] = useState<Kind | "all">("all");
  const [focus, setFocus] = useState("");
  const [rejects, setRejects] = useState<Reject[]>([]);
  const [error, setError] = useState("");

  function load() {
    request<{ sources: SourceView[]; run: RunState }>("/api/ledger/sources").then((body) => {
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

  const current = sources.find((source) => source.id === focus) ?? null;
  const runKey = current?.run?.startedAt ?? "";
  useEffect(() => {
    if (!focus) return;
    request<{ rejects: Reject[] }>(`/api/ledger/sources/${focus}/rejects`).then((body) => setRejects(body.rejects)).catch(() => setRejects([]));
  }, [focus, runKey]);

  async function start(ids?: string[]) {
    setError("");
    try {
      await startRun(ids);
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "没有开始。");
    }
  }

  async function toggle(source: SourceView) {
    await request(`/api/ledger/sources/${source.id}`, { method: "POST", body: JSON.stringify({ enabled: !source.enabled }) });
    load();
  }

  const visible = sources.filter((source) => filter === "all" || source.column === filter);
  const count = (status: string) => sources.filter((source) => source.run?.status === status).length;
  const running = run.state === "running";

  return (
    <div className="desk ledger-desk">
      <header className="desk-top">
        <Link className="desk-back" to="/" aria-label="回到首页">←</Link>
        <h1 className="desk-title">采集</h1>
        <span className="desk-status">
          {running ? `正在跑 ${run.done}/${run.total}${run.current ? ` · ${run.current}` : ""}` : `入库 ${count("ok")} · 没抽出 ${count("没抽出")} · 跳过 ${count("skipped")} · 失败 ${count("failed")}`}
        </span>
        <div className="desk-top-gap" />
        <button className="desk-go" type="button" disabled={running} onClick={() => void start()}>再跑一轮</button>
      </header>
      {error || run.error ? <p className="ledger-error">{error || run.error}</p> : null}
      <div className="desk-body">
        <aside className="desk-side" style={{ width: 170 }}>
          <div className="archive">
            <h2>栏目</h2>
            {FILTERS.map((item) => (
              <button key={item.id} className={filter === item.id ? "archive-row on" : "archive-row"} type="button" onClick={() => setFilter(item.id)}>
                <span>{item.label}</span>
                <em>{sources.filter((source) => item.id === "all" || source.column === item.id).length}</em>
              </button>
            ))}
          </div>
        </aside>
        <div className="desk-split" />
        <main className="desk-main ledger-main">
          <div className="ledger-sheet">
            <table className="collect-table">
              <thead>
                <tr><th>来源</th><th>抓取</th><th>抽取</th><th>清洗后</th><th>丢弃</th><th>入库</th><th>变化</th><th>结果</th><th>时间</th></tr>
              </thead>
              <tbody>
                {visible.map((source) => {
                  const last = source.run;
                  return (
                    <tr key={source.id} className={source.id === current?.id ? "on" : ""} onClick={() => setFocus(source.id)}>
                      <td><span className="source-name"><b>{source.vendor}</b>{source.label}</span></td>
                      <td className="num">{last?.httpStatus ? `${last.httpStatus} · ${bytes(last.bytes)}` : "—"}</td>
                      <td className="num">{last ? last.extracted : "—"}</td>
                      <td className="num">{last ? last.cleaned : "—"}</td>
                      <td className="num">{last ? last.rejected : "—"}</td>
                      <td className="num">{last ? last.stored : "—"}</td>
                      <td className="num">{last ? last.changed : "—"}</td>
                      <td className={last && last.status !== "ok" ? "bad" : ""}>{statusName(last, source.enabled)}</td>
                      <td className="num">{last ? clock(last.startedAt) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="collect-skip">
              <h3>不抓的页面</h3>
              <ul>{NOT_COLLECTED.map((line) => <li key={line}>{line}</li>)}</ul>
            </div>
          </div>
        </main>
        <div className="desk-split" />
        <aside className="desk-pane" style={{ width: 400 }}>
          <div className="excerpt">
            <h2>这一页</h2>
            {current ? (
              <>
                <p className="excerpt-title">{current.vendor} · {current.label}</p>
                <a href={current.page} target="_blank" rel="noreferrer">{current.page}</a>
                {current.url !== current.page ? <p className="collect-url">实际抓取：{current.url}</p> : null}
                <ol className="steps">
                  <li><b>抓取</b><span>{current.run?.httpStatus ? `HTTP ${current.run.httpStatus}，${bytes(current.run.bytes)}，原始响应已存盘` : "—"}</span></li>
                  <li><b>抽取</b><span>{current.run ? `按这一页的解析规则抽出 ${current.run.extracted} 条` : "—"}</span></li>
                  <li><b>清洗</b><span>{current.run ? `留下 ${current.run.cleaned} 条，丢掉 ${current.run.rejected} 条` : "—"}</span></li>
                  <li><b>入库</b><span>{current.run ? `${current.run.stored} 行，和上一轮比 ${current.run.changed} 处变化` : "—"}</span></li>
                </ol>
                {current.run?.error ? <p className="collect-why">{statusName(current.run, current.enabled)}：{current.run.error}</p> : null}
                {current.run && Object.keys(current.run.reasons).length > 0 ? (
                  <div className="reasons">
                    <h3>丢弃原因</h3>
                    {Object.entries(current.run.reasons).sort((left, right) => right[1] - left[1]).map(([reason, total]) => (
                      <details key={reason}>
                        <summary><span>{reason}</span><em>{total}</em></summary>
                        {rejects.filter((item) => item.reason === reason).map((item, index) => <pre key={index}>{item.excerpt}</pre>)}
                      </details>
                    ))}
                  </div>
                ) : null}
                <div className="collect-actions">
                  <button type="button" disabled={running} onClick={() => void start([current.id])}>只跑这一页</button>
                  <button type="button" onClick={() => void toggle(current)}>{current.enabled ? "停用" : "启用"}</button>
                  {current.run?.httpStatus ? <a href={`/api/ledger/sources/${current.id}/raw`} target="_blank" rel="noreferrer">看原始响应</a> : null}
                  {current.run?.status === "ok" ? <Link to={`/columns/${current.column}`}>看入库的行</Link> : null}
                </div>
              </>
            ) : <p>没有来源。</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}
