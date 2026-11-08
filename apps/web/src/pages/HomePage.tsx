import { useEffect, useState, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import { request } from "../api";
import type { EventView, HotView, Kind, PriceView, RankView } from "../types";

interface HomeBody {
  day: string;
  hotEnabled: { github: boolean; huggingface: boolean; kaggle: boolean };
  hot: HotView[];
  prices: PriceView[];
  priceRows: number;
  ranks: RankView[];
  events: EventView[];
  outages: number;
  changes: Record<Kind, number>;
}

const HOT_IDS = { github: "H01", huggingface: "H02", kaggle: "H03" } as const;
const BOARDS = [
  { id: "R01", label: "LMArena 文本榜" },
  { id: "R02", label: "SWE-bench Verified" },
  { id: "R03", label: "AA 智能指数" },
];

export function HomePage() {
  const [data, setData] = useState<HomeBody | null>(null);
  const [error, setError] = useState("");

  function load() {
    request<HomeBody>("/api/ledger/home").then(setData).catch((reason: Error) => setError(reason.message));
  }

  useEffect(() => { load(); }, []);

  async function toggleHot(key: keyof typeof HOT_IDS) {
    if (!data) return;
    await request(`/api/ledger/sources/${HOT_IDS[key]}`, { method: "POST", body: JSON.stringify({ enabled: !data.hotEnabled[key] }) });
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
          <div className="shot-card-head"><h2>热榜</h2><Changes count={data?.changes.hot ?? 0} /></div>
          <div className="shot-pills">
            <Pill on={data?.hotEnabled.github ?? true} label="GitHub" onClick={(event) => { event.preventDefault(); void toggleHot("github"); }} />
            <Pill on={data?.hotEnabled.huggingface ?? true} label="Hugging Face" onClick={(event) => { event.preventDefault(); void toggleHot("huggingface"); }} />
            <Pill on={data?.hotEnabled.kaggle ?? false} label="Kaggle" onClick={(event) => { event.preventDefault(); void toggleHot("kaggle"); }} />
          </div>
          <ul>
            {(data?.hot ?? []).slice(0, 4).map((item) => <li key={item.id}><span>{item.rank}. {item.title}</span><em>{item.site}</em></li>)}
            {data && data.hot.length === 0 ? <li className="shot-empty">还没有抓到热榜。</li> : null}
          </ul>
        </Link>
        <Link className="shot-card" to="/columns/price">
          <div className="shot-card-head"><h2>价目</h2><Changes count={data?.changes.price ?? 0} /></div>
          <table>
            <thead><tr><th>厂商</th><th>产品</th><th>输入价</th></tr></thead>
            <tbody>
              {(data?.prices ?? []).map((row) => (
                <tr key={row.id}>
                  <td>{row.vendor}</td>
                  <td>{row.product}{row.condition ? <small> · {row.condition}</small> : null}</td>
                  <td className="num">{row.price} <small>{row.unit}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.prices.length === 0 ? <p className="shot-empty">还没有价目。去采集跑一轮。</p> : null}
          {data && data.priceRows > 0 ? <p className="shot-foot">全表 {data.priceRows} 行，每格一行</p> : null}
        </Link>
        <Link className="shot-card" to="/columns/rank">
          <div className="shot-card-head"><h2>排名</h2><Changes count={data?.changes.rank ?? 0} /></div>
          <div className="shot-boards">
            {BOARDS.map((board) => {
              const top = data?.ranks.find((row) => row.sourceId === board.id);
              return (
                <div key={board.id}>
                  <small>{board.label}</small>
                  <strong>{top ? top.model : "—"}</strong>
                  <em>{top ? `第 ${top.rank} 名 · ${top.score}` : "未抓到"}</em>
                </div>
              );
            })}
          </div>
        </Link>
        <Link className="shot-card" to="/columns/event">
          <div className="shot-card-head">
            <h2>厂商动态</h2>
            {data && data.outages > 0 ? <b className="bad">{data.outages} 个组件异常</b> : <Changes count={data?.changes.event ?? 0} />}
          </div>
          <ul>
            {(data?.events ?? []).map((item) => (
              <li key={item.id}>
                <span><b>{item.vendor}</b> {item.title}</span>
                {item.type === "cn_access" ? <i>中国大陆</i> : <em>{item.date.slice(5)}</em>}
              </li>
            ))}
            {data && data.events.length === 0 ? <li className="shot-empty">还没有官网动态。</li> : null}
          </ul>
        </Link>
      </div>
    </div>
  );
}

function Changes(props: { count: number }) {
  return props.count > 0 ? <b>{props.count} 处变化</b> : null;
}

function Pill(props: { on: boolean; label: string; onClick: (event: MouseEvent<HTMLButtonElement>) => void }) {
  return <button type="button" className={props.on ? "on" : ""} aria-pressed={props.on} onClick={props.onClick}>{props.label}</button>;
}
