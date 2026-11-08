import { useEffect, useState, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import { request } from "../api";

interface HotItem { id: number; source: string; rank: string; title: string; fetchedAt: string }
interface PriceItem { id: number; vendor: string; product: string; metric: string; price: string }
interface RankItem { id: number; board: string; rank: string; model: string; score: string }
interface EventItem { id: number; vendor: string; text: string; type: string; fetchedAt: string }

interface HomeBody {
  day: string;
  hotEnabled: { github: boolean; huggingface: boolean; kaggle: boolean };
  hot: HotItem[];
  prices: PriceItem[];
  priceChanges: number;
  ranks: RankItem[];
  events: EventItem[];
}

const HOT_IDS = { github: "H01", huggingface: "H02", kaggle: "H03" } as const;

export function HomePage() {
  const [data, setData] = useState<HomeBody | null>(null);
  const [error, setError] = useState("");

  function load() {
    request<HomeBody>("/api/ledger/home").then(setData).catch((reason: Error) => setError(reason.message));
  }

  useEffect(() => { load(); }, []);

  async function toggleHot(key: keyof typeof HOT_IDS) {
    if (!data) return;
    const enabled = !data.hotEnabled[key];
    await request(`/api/ledger/sources/${HOT_IDS[key]}`, { method: "POST", body: JSON.stringify({ enabled }) });
    load();
  }

  const day = data ? data.day.replaceAll("-", ".") : "";
  return (
    <div className="shot">
      <div className="shot-lights" aria-hidden="true"><span /><span /><span /></div>
      <header className="shot-top">
        <div />
        <div className="shot-brand">
          <h1>headline-chaser</h1>
          <p>今日快照{day ? ` · ${day}` : ""}</p>
        </div>
        <nav>
          <Link to="/watch">定制</Link>
          <Link to="/collect">采集</Link>
        </nav>
      </header>
      {error ? <p className="shot-error">{error}</p> : null}
      <div className="shot-grid">
        <Link className="shot-card" to="/columns/hot">
          <div className="shot-card-head"><h2>热榜</h2></div>
          <div className="shot-pills">
            <Pill on={data?.hotEnabled.github ?? true} label="GitHub" onClick={(event) => { event.preventDefault(); void toggleHot("github"); }} />
            <Pill on={data?.hotEnabled.huggingface ?? true} label="Hugging Face" onClick={(event) => { event.preventDefault(); void toggleHot("huggingface"); }} />
            <Pill on={data?.hotEnabled.kaggle ?? false} label="Kaggle" onClick={(event) => { event.preventDefault(); void toggleHot("kaggle"); }} />
          </div>
          <ul>
            {(data?.hot ?? []).slice(0, 3).map((item) => <li key={item.id}><span>{item.title}</span><em>{item.source}</em></li>)}
            {data && data.hot.length === 0 ? <li className="shot-empty">还没有抓到热榜。</li> : null}
          </ul>
        </Link>
        <Link className="shot-card" to="/columns/price">
          <div className="shot-card-head">
            <h2>价目</h2>
            {data && data.priceChanges > 0 ? <b>{data.priceChanges} 处变化</b> : null}
          </div>
          <table>
            <thead><tr><th>厂商</th><th>产品</th><th>价格</th></tr></thead>
            <tbody>
              {(data?.prices ?? []).slice(0, 4).map((row) => (
                <tr key={row.id}><td>{row.vendor}</td><td>{row.product}</td><td className="num">{row.price}</td></tr>
              ))}
            </tbody>
          </table>
          {data && data.prices.length === 0 ? <p className="shot-empty">还没有价目。去采集跑一轮。</p> : null}
        </Link>
        <Link className="shot-card" to="/columns/rank">
          <div className="shot-card-head"><h2>排名</h2></div>
          <div className="shot-boards">
            {["LMArena", "SWE-bench", "Artificial Analysis"].map((board) => {
              const top = data?.ranks.find((row) => row.board === board);
              return (
                <div key={board}>
                  <small>{board}</small>
                  <strong>{top ? top.model : "—"}</strong>
                  <em>{top ? `第 ${top.rank} 名` : "未抓到"}</em>
                </div>
              );
            })}
          </div>
        </Link>
        <Link className="shot-card" to="/columns/event">
          <div className="shot-card-head"><h2>厂商动态</h2></div>
          <ul>
            {(data?.events ?? []).slice(0, 3).map((item) => (
              <li key={item.id}>
                <span><b>{item.vendor}</b> {item.text}</span>
                {item.type === "cn_access" ? <i>中国大陆</i> : null}
              </li>
            ))}
            {data && data.events.length === 0 ? <li className="shot-empty">还没有官网动态。</li> : null}
          </ul>
        </Link>
      </div>
    </div>
  );
}

function Pill(props: { on: boolean; label: string; onClick: (event: MouseEvent<HTMLButtonElement>) => void }) {
  return <button type="button" className={props.on ? "on" : ""} aria-pressed={props.on} onClick={props.onClick}>{props.label}</button>;
}
