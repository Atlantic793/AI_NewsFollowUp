import { useEffect, useState, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import { request } from "../api";
import { COLUMN_TITLES, clock, diffText, type DiffView, type EventView, type HotView, type Kind, type PriceView, type RankView } from "../types";

interface HomeBody {
  day: string;
  hotEnabled: { github: boolean; huggingface: boolean; kaggle: boolean };
  hot: HotView[];
  prices: PriceView[];
  priceRows: number;
  usdToCny: number;
  ranks: RankView[];
  events: EventView[];
  outages: number;
  changes: Record<Kind, number>;
  baselines: Record<Kind, boolean>;
  freshness: { latestSuccessAt: string; oldestSuccessAt: string; failed: number; issues: number; neverSucceeded: number; enabled: number };
  highlights: DiffView[];
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
    setError("");
    try {
      await request(`/api/ledger/sources/${HOT_IDS[key]}`, { method: "POST", body: JSON.stringify({ enabled: !data.hotEnabled[key] }) });
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "来源开关没有更新。");
    }
  }

  const day = data ? data.day.replaceAll("-", ".") : "";
  return (
    <div className="shot">
      <header className="shot-top">
        <div />
        <div className="shot-brand">
          <h1>headline-chaser</h1>
          <p>今日快照{day ? ` · ${day}` : ""}</p>
        </div>
        <nav>
          <Link to="/watch">定制</Link>
          <Link to="/collect">采集</Link>
          <Link to="/digests">简报</Link>
        </nav>
      </header>
      {error ? <p className="shot-error">{error}</p> : null}
      <div className="home-sheet">
        <div className="home-freshness">
          <span>最近成功 <strong>{clock(data?.freshness.latestSuccessAt ?? "")}</strong></span>
          <span>最早数据 <strong>{clock(data?.freshness.oldestSuccessAt ?? "")}</strong></span>
          <Link to="/collect">{data?.freshness.failed ?? 0} 个失败来源 · {data?.freshness.issues ?? 0} 个异常来源</Link>
          {data && data.freshness.neverSucceeded > 0 ? <span>{data.freshness.neverSucceeded}/{data.freshness.enabled} 个启用来源尚未成功</span> : null}
        </div>
        <section className="home-block" aria-labelledby="home-price">
          <div className="shot-card-head"><h2 id="home-price"><Link to="/columns/price">价目</Link></h2><Changes count={data?.changes.price ?? 0} baseline={data?.baselines.price ?? false} /></div>
          <PriceTape rows={data?.prices ?? []} />
          {data && data.prices.length === 0 ? <p className="shot-empty">还没有价目。去采集跑一轮。</p> : null}
          {data && data.priceRows > 0 ? <p className="shot-foot">全表 {data.priceRows} 行。1 美元 = {data.usdToCny} 元</p> : null}
        </section>
        <section className="home-block" aria-labelledby="home-rank">
          <div className="shot-card-head"><h2 id="home-rank"><Link to="/columns/rank">排名</Link></h2><Changes count={data?.changes.rank ?? 0} baseline={data?.baselines.rank ?? false} /></div>
          <div className="shot-boards">
            {BOARDS.map((board) => {
              const top = data?.ranks.find((row) => row.sourceId === board.id);
              return (
                <div key={board.id}>
                  <small>{board.label}</small>
                  <strong>{top ? top.model : "—"}</strong>
                  <em>{top ? `${top.basis === "sorted" ? "按分数排序" : `第 ${top.rank} 名`} · ${top.score}${top.boardDate ? ` · ${top.boardDate}` : ""}` : "未抓到"}</em>
                </div>
              );
            })}
          </div>
        </section>
        <section className="home-block" aria-labelledby="home-hot">
          <div className="shot-card-head"><h2 id="home-hot"><Link to="/columns/hot">热榜</Link></h2><Changes count={data?.changes.hot ?? 0} baseline={data?.baselines.hot ?? false} /></div>
          <div className="shot-pills">
            <Pill on={data?.hotEnabled.github ?? true} label="GitHub" onClick={(event) => { event.preventDefault(); void toggleHot("github"); }} />
            <Pill on={data?.hotEnabled.huggingface ?? true} label="Hugging Face" onClick={(event) => { event.preventDefault(); void toggleHot("huggingface"); }} />
            <Pill on={data?.hotEnabled.kaggle ?? false} label="Kaggle" onClick={(event) => { event.preventDefault(); void toggleHot("kaggle"); }} />
          </div>
          <ul className="home-lines">
            {(data?.hot ?? []).map((item) => <li key={item.id}><span className="who">{item.site}</span><span><b>{item.title}</b><small>{item.summary}</small></span></li>)}
            {data && data.hot.length === 0 ? <li className="shot-empty">还没有抓到热榜。</li> : null}
          </ul>
        </section>
        <section className="home-block" aria-labelledby="home-event">
          <div className="shot-card-head">
            <h2 id="home-event"><Link to="/columns/event">厂商动态</Link></h2>
            {data && data.outages > 0 ? <b className="bad">{data.outages} 个组件异常</b> : <Changes count={data?.changes.event ?? 0} baseline={data?.baselines.event ?? false} />}
          </div>
          <ul className="home-lines">
            {(data?.events ?? []).map((item) => (
              <li key={item.id}>
                <span className="who">{item.vendor}</span>
                <span>{item.brief || item.title}</span>
                {item.type === "cn_access" ? <i>中国大陆</i> : <em>{item.date.slice(5)}</em>}
              </li>
            ))}
            {data && data.events.length === 0 ? <li className="shot-empty">还没有官网动态。</li> : null}
          </ul>
        </section>
        <section className="home-updates" aria-label="今日重点变化">
          <div className="home-update-head"><h2>今日重点变化</h2><span>价格与服务状态优先</span></div>
          <ul className="home-update-list">
            {(data?.highlights ?? []).map((diff) => <li key={diff.id}><Link to={`/columns/${diff.column}?changes=1&source=${diff.sourceId}&diff=${diff.id}`}><small>{COLUMN_TITLES[diff.column]} · {diff.vendor}</small><strong>{diff.label}</strong><span>{diffText(diff)}</span><time>{clock(diff.fetchedAt)}</time></Link></li>)}
          </ul>
          {data && data.highlights.length === 0 ? <p className="shot-empty">今天还没有记录到变化。首次成功采集作为基线，下一轮开始比较。</p> : null}
        </section>
      </div>
    </div>
  );
}

function PriceTape(props: { rows: PriceView[] }) {
  const groups = new Map<string, PriceView[]>();
  for (const row of props.rows) {
    const key = row.unit || row.metric;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return (
    <>
      {[...groups.entries()].map(([unit, items]) => {
        const sorted = [...items].sort((left, right) => (right.amount ?? -1) - (left.amount ?? -1));
        const max = Math.max(...sorted.map((row) => row.amount ?? 0), 0);
        return (
          <div key={unit}>
            <p className="home-unit">{unit}</p>
            <ol className="tape">
              {sorted.map((row) => {
                const width = max > 0 && row.amount !== null ? (row.amount / max) * 100 : 0;
                const official = row.officialPrice && row.officialPrice !== row.price ? `官网 ${row.officialPrice}` : "";
                return (
                  <li key={row.id}>
                    <span className="who">{row.vendor}</span>
                    <span className="track"><span className="bar" style={{ width: `${width}%` }} /></span>
                    <span className="yuan">{row.price}</span>
                    <span className="what">{row.product}{row.condition ? ` · ${row.condition}` : ""}{official ? <small>{official}</small> : null}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
    </>
  );
}

function Changes(props: { count: number; baseline: boolean }) {
  if (props.count > 0) return <b>{props.count} 处变化</b>;
  if (props.baseline) return <b>基线</b>;
  return null;
}

function Pill(props: { on: boolean; label: string; onClick: (event: MouseEvent<HTMLButtonElement>) => void }) {
  return <button type="button" className={props.on ? "on" : ""} aria-pressed={props.on} onClick={props.onClick}>{props.label}</button>;
}
