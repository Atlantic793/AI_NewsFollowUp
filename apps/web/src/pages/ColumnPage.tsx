import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { request } from "../api";

type Kind = "hot" | "price" | "rank" | "event";

interface SourceItem {
  id: string;
  vendor: string;
  label: string;
  status: string;
  error: string;
  fetchedAt: string;
  url: string;
}

interface Excerpt { url: string; fetchedAt: string; body: string }

interface ColumnBody {
  kind: Kind;
  changes: number;
  push: boolean;
  sources: SourceItem[];
  rows: Array<Record<string, string | number>>;
  excerpt: Excerpt | null;
  focus: string;
}

const TITLES: Record<Kind, string> = { hot: "热榜", price: "价目表", rank: "排名", event: "厂商动态" };

export function ColumnPage() {
  const { kind = "price" } = useParams();
  const column = (kind in TITLES ? kind : "price") as Kind;
  const [data, setData] = useState<ColumnBody | null>(null);
  const [focus, setFocus] = useState("");
  const [rowId, setRowId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function load(source = focus) {
    const query = source ? `?source=${encodeURIComponent(source)}` : "";
    request<ColumnBody>(`/api/ledger/column/${column}${query}`).then((body) => {
      setData(body);
      setFocus(body.focus);
    }).catch((reason: Error) => setError(reason.message));
  }

  useEffect(() => { setFocus(""); setRowId(null); load(""); }, [column]);

  async function run() {
    setBusy(true);
    setError("");
    try {
      await request("/api/ledger/run", { method: "POST", body: "{}" });
      await waitRun();
      load(focus);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "没有跑完。");
    } finally {
      setBusy(false);
    }
  }

  async function togglePush() {
    if (!data) return;
    await request(`/api/ledger/column/${column}/push`, { method: "POST", body: JSON.stringify({ enabled: !data.push }) });
    load(focus);
  }

  const rows = (data?.rows ?? []).filter((row) => !focus || String(row.sourceId) === focus);
  const selected = rows.find((row) => Number(row.id) === rowId) ?? rows[0];
  const quote = selected && typeof selected.excerpt === "string" && selected.excerpt ? selected.excerpt : data?.excerpt?.body ?? "";
  const link = selected && typeof selected.url === "string" && selected.url ? selected.url : data?.excerpt?.url ?? "";

  return (
    <div className="desk ledger-desk">
      <header className="desk-top">
        <Link className="desk-back" to="/" aria-label="回到首页">←</Link>
        <h1 className="desk-title">{TITLES[column]}</h1>
        <span className="desk-status">今日 {data?.changes ?? 0} 处变化</span>
        <div className="desk-top-gap" />
        <button className="desk-go" type="button" disabled={busy} onClick={() => void run()}>{busy ? "正在抓取" : "立即抓取"}</button>
        <label className="desk-morning">
          推送
          <button className={data?.push ? "desk-switch on" : "desk-switch"} type="button" role="switch" aria-checked={Boolean(data?.push)} onClick={() => void togglePush()}><i /></button>
        </label>
      </header>
      {error ? <p className="ledger-error">{error}</p> : null}
      <div className="desk-body">
        <aside className="desk-side" style={{ width: 220 }}>
          <div className="archive">
            <h2>来源</h2>
            {(data?.sources ?? []).map((source) => (
              <button key={source.id} className={source.id === focus ? "archive-row on" : "archive-row"} type="button" onClick={() => { setFocus(source.id); setRowId(null); load(source.id); }}>
                <span>{source.vendor}</span>
                <em>{source.label}</em>
              </button>
            ))}
          </div>
        </aside>
        <div className="desk-split" />
        <main className="desk-main">
          <div className="ledger-sheet">
            <table>
              <thead><tr>{headers(column).map((head) => <th key={head}>{head}</th>)}</tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={String(row.id)} className={Number(row.id) === Number(selected?.id) ? "on" : ""} onClick={() => setRowId(Number(row.id))}>
                    {cells(column, row).map((cell, index) => <td key={index} className={index > 0 ? "num" : ""}>{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 ? <p className="shot-empty">这一来源还没有行。抓到正文之后，抽不出的格子会空着，不会用别的网站填上。</p> : null}
          </div>
        </main>
        <div className="desk-split" />
        <aside className="desk-pane" style={{ width: 360 }}>
          <div className="excerpt">
            <h2>原文</h2>
            <blockquote>{quote || "还没有摘录。"}</blockquote>
            {link ? <a href={link}>{link}</a> : null}
            {data?.sources.find((source) => source.id === focus)?.error ? <p>{data.sources.find((source) => source.id === focus)?.error}</p> : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

function headers(kind: Kind): string[] {
  switch (kind) {
    case "hot":
      return ["标题", "名次", "来源"];
    case "price":
      return ["产品", "计费项", "价格", "额度"];
    case "rank":
      return ["模型", "名次", "分数"];
    case "event":
      return ["厂商", "类型", "原文"];
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function cells(kind: Kind, row: Record<string, string | number>): string[] {
  switch (kind) {
    case "hot":
      return [String(row.title), String(row.rank), String(row.source)];
    case "price":
      return [String(row.product), String(row.metric), String(row.price), String(row.quota || "—")];
    case "rank":
      return [String(row.model), String(row.rank), String(row.score)];
    case "event":
      return [String(row.vendor), String(row.type), String(row.text)];
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

async function waitRun(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const body = await request<{ run: { state: string; error: string } }>("/api/ledger/sources");
    if (body.run.state !== "running") {
      if (body.run.error) throw new Error(body.run.error);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("这一轮太久了，采集页还能看到进度。");
}
