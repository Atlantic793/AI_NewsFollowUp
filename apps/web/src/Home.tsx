import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { request } from "./api";
import { formatStamp } from "./format";

interface Card {
  id: string;
  utterance: string;
  keywords?: string[];
  createdAt?: string;
  lastCollectedAt: string | null;
  morningEnabled: boolean;
  morningTime?: string | null;
  hotspotCount?: number;
  folderMissing?: boolean;
  jobState?: "running" | "incomplete" | null;
  jobError?: string | null;
}

type Chip = "resume" | "today" | "morning";

const RECENT_LIMIT = 5;

const CHIPS: { id: Chip; label: string }[] = [
  { id: "resume", label: "继续上次" },
  { id: "today", label: "今日有更新" },
  { id: "morning", label: "晨报已开" },
];

export function Home() {
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement>(null);
  const [topics, setTopics] = useState<Card[] | null>(null);
  const [utterance, setUtterance] = useState("");
  const [query, setQuery] = useState("");
  const [chips, setChips] = useState<Chip[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [creating, setCreating] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    request<{ topics: Card[] }>("/api/topics").then((body) => setTopics(body.topics)).catch((reason: Error) => setError(reason.message));
  }, []);

  useEffect(() => {
    if (!menuId) return;
    function onPointer(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node) || menuRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".bench-more")) return;
      setMenuId(null);
      setPendingDelete(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMenuId(null);
      setPendingDelete(null);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuId]);

  async function createTopic() {
    if (creating || !utterance.trim()) return;
    setCreating(true);
    setError("");
    try {
      const body = await request<{ topic: { id: string } }>("/api/topics", { method: "POST", body: JSON.stringify({ utterance }) });
      navigate(`/topics/${body.topic.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "没有建成主题。");
      setCreating(false);
    }
  }

  async function removeTopic(id: string) {
    setError("");
    try {
      const body = await request<{ folderKept: boolean }>(`/api/topics/${id}`, { method: "DELETE" });
      setTopics((current) => current?.filter((topic) => topic.id !== id) ?? null);
      setMenuId(null);
      setPendingDelete(null);
      if (body.folderKept) setError("主题已从工作台拿下。文件夹在工作台外面，所以还留在原处。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "没有删掉。");
    }
  }

  function toggleChip(chip: Chip) {
    setChips((current) => current.includes(chip) ? current.filter((item) => item !== chip) : [...current, chip]);
  }

  const needle = query.trim().toLocaleLowerCase();
  const narrowed = (topics ?? []).filter((topic) => {
    if (needle && ![topic.utterance, ...(topic.keywords ?? [])].join("\n").toLocaleLowerCase().includes(needle)) return false;
    if (chips.includes("resume") && !topic.lastCollectedAt) return false;
    if (chips.includes("today") && !collectedToday(topic.lastCollectedAt)) return false;
    if (chips.includes("morning") && !topic.morningEnabled) return false;
    return true;
  }).sort((left, right) => activityTime(right) - activityTime(left));
  const visible = showAll || needle ? narrowed : narrowed.slice(0, RECENT_LIMIT);
  const canExpand = !needle && narrowed.length > RECENT_LIMIT;

  return (
    <main className="bench">
      <div className="bench-lights" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="bench-stage">
        <header>
          <div className="bench-brand">
            <Mark />
            <h1>headline-chaser</h1>
          </div>
          <p className="bench-tagline">个人工作台 · 持续追踪每一条线索</p>
          <form className="bench-composer" onSubmit={(event) => { event.preventDefault(); void createTopic(); }}>
            <label className="sr-only" htmlFor="utterance">建立主题</label>
            <input id="utterance" type="text" value={utterance} placeholder="用一句话写下要追的事" onChange={(event) => setUtterance(event.target.value)} />
            <button type="submit" disabled={!utterance.trim() || creating}>放入工作台</button>
          </form>
          {error && <p className="bench-error" role="alert">{error}</p>}
          <div className="bench-chips" role="group" aria-label="筛选主题">
            {CHIPS.map((chip) => (
              <button key={chip.id} type="button" aria-pressed={chips.includes(chip.id)} onClick={() => toggleChip(chip.id)}>{chip.label}</button>
            ))}
          </div>
        </header>
        <section className="bench-list" aria-label="主题">
          <div className="bench-list-head">
            <span className="bench-recent">最近</span>
            <div className="bench-list-tools">
              <label className="sr-only" htmlFor="find">查找</label>
              <input id="find" className="bench-find" type="text" value={query} placeholder="查找" onChange={(event) => setQuery(event.target.value)} />
              {canExpand && (
                <button className="bench-all" type="button" onClick={() => setShowAll((open) => !open)}>{showAll ? "只看最近" : "查看全部"}</button>
              )}
            </div>
          </div>
          {topics !== null && visible.length === 0 && (
            <p className="bench-empty">{topics.length === 0 ? "还没有主题。用上面那句话放入第一个。" : "没有对上的主题。"}</p>
          )}
          {visible.map((topic) => (
            <article className="bench-row" key={topic.id}>
              <Link to={`/topics/${topic.id}`}>
                <span>{topic.utterance}</span>
              </Link>
              <p className={topic.folderMissing ? "bench-status warn" : "bench-status"} title={topic.jobError ?? undefined}>
                {topic.folderMissing ? "文件夹不在了" : topicStatus(topic)}
              </p>
              <button
                className="bench-more"
                type="button"
                aria-label={`${topic.utterance}的更多操作`}
                aria-expanded={menuId === topic.id}
                onClick={() => {
                  setPendingDelete(null);
                  setMenuId(menuId === topic.id ? null : topic.id);
                }}
              >
                ···
              </button>
              {menuId === topic.id && (
                <div className="bench-menu" ref={menuRef} role="menu">
                  {pendingDelete === topic.id ? (
                    <>
                      <button className="danger" type="button" role="menuitem" onClick={() => void removeTopic(topic.id)}>确认删除</button>
                      <button type="button" role="menuitem" onClick={() => setPendingDelete(null)}>留下</button>
                    </>
                  ) : (
                    <button className="danger" type="button" role="menuitem" onClick={() => setPendingDelete(topic.id)}>删除</button>
                  )}
                </div>
              )}
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}

function Mark() {
  return (
    <svg className="bench-mark" viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="15.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <path d="M13.5 24h21" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function topicStatus(topic: Card): string {
  if (topic.jobState === "running") return "进行中·可离开";
  if (topic.jobState === "incomplete") return "未完成";
  if (!topic.lastCollectedAt) return "尚未调研";
  return `追踪中 · ${formatStamp(topic.lastCollectedAt)}`;
}

function collectedToday(value: string | null): boolean {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

function collectedTime(value: string | null | undefined): number {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

function activityTime(topic: Card): number {
  return Math.max(collectedTime(topic.createdAt), collectedTime(topic.lastCollectedAt));
}
