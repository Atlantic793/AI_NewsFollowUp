import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";

const SIDE_KEY = "desk-side-width";
const PANE_KEY = "desk-pane-width";

function readWidth(key: string, fallback: number): number {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value >= 160 ? value : fallback;
  } catch {
    return fallback;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function DeskFrame(props: {
  title: string;
  status: string;
  action: string;
  actionDisabled: boolean;
  onAction: () => void;
  morningOn: boolean;
  morningLocked: boolean;
  onMorning: (enabled: boolean) => void;
  settingsOn: boolean;
  onSettings: () => void;
  files: ReactNode;
  main: ReactNode;
  inspector: ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const widths = useRef({ side: 228, pane: 320 });
  const drag = useRef<{ edge: "side" | "pane"; startX: number; start: number } | null>(null);
  const [side, setSide] = useState(() => readWidth(SIDE_KEY, 228));
  const [pane, setPane] = useState(() => readWidth(PANE_KEY, 320));
  widths.current = { side, pane };

  useEffect(() => {
    function move(event: PointerEvent) {
      const current = drag.current;
      const body = bodyRef.current;
      if (!current || !body) return;
      const total = body.clientWidth;
      const delta = event.clientX - current.startX;
      if (current.edge === "side") {
        const max = Math.min(480, total - widths.current.pane - 320 - 16);
        const next = clamp(current.start + delta, 180, max);
        widths.current.side = next;
        setSide(next);
        return;
      }
      const max = Math.min(640, total - widths.current.side - 320 - 16);
      const next = clamp(current.start - delta, 240, max);
      widths.current.pane = next;
      setPane(next);
    }
    function up() {
      if (!drag.current) return;
      drag.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        localStorage.setItem(SIDE_KEY, String(widths.current.side));
        localStorage.setItem(PANE_KEY, String(widths.current.pane));
      } catch {
        // 宽度记不住时，这一次拖拽仍然有效。
      }
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  function begin(edge: "side" | "pane", event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    drag.current = { edge, startX: event.clientX, start: edge === "side" ? side : pane };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function nudge(edge: "side" | "pane", delta: number) {
    const body = bodyRef.current;
    const total = body?.clientWidth ?? 1440;
    if (edge === "side") {
      const max = Math.min(480, total - pane - 320 - 16);
      const next = clamp(side + delta, 180, max);
      widths.current.side = next;
      setSide(next);
    } else {
      const max = Math.min(640, total - side - 320 - 16);
      const next = clamp(pane + delta, 240, max);
      widths.current.pane = next;
      setPane(next);
    }
    try {
      localStorage.setItem(SIDE_KEY, String(widths.current.side));
      localStorage.setItem(PANE_KEY, String(widths.current.pane));
    } catch {
      // 宽度记不住时，这一次调整仍然有效。
    }
  }

  return (
    <div className="desk">
      <header className="desk-top">
        <Link className="desk-back" to="/" aria-label="回到主题列表">
          <Icon name="back" />
        </Link>
        <h1 className="desk-title">{props.title || "主题"}</h1>
        <span className="desk-status">{props.status}</span>
        <div className="desk-top-gap" />
        <button className="desk-go" type="button" disabled={props.actionDisabled} onClick={props.onAction}>
          <Icon name="refresh" />
          {props.action}
        </button>
        <label className="desk-morning">
          晨报
          <button
            className={props.morningOn ? "desk-switch on" : "desk-switch"}
            type="button"
            role="switch"
            aria-checked={props.morningOn}
            aria-label="晨报"
            disabled={props.morningLocked}
            onClick={() => props.onMorning(!props.morningOn)}
          >
            <i />
          </button>
        </label>
        <button className={props.settingsOn ? "desk-settings on" : "desk-settings"} type="button" aria-label="设置" aria-pressed={props.settingsOn} onClick={props.onSettings}>
          <Icon name="settings" />
        </button>
      </header>
      <div className="desk-body" ref={bodyRef}>
        <aside className="desk-side" style={{ width: side }}>{props.files}</aside>
        <div
          className="desk-split"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整档案宽度"
          aria-valuemin={180}
          aria-valuemax={480}
          aria-valuenow={Math.round(side)}
          tabIndex={0}
          onPointerDown={(event) => begin("side", event)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") nudge("side", -16);
            if (event.key === "ArrowRight") nudge("side", 16);
          }}
        />
        <main className="desk-main">{props.main}</main>
        <div
          className="desk-split"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整对话宽度"
          aria-valuemin={240}
          aria-valuemax={640}
          aria-valuenow={Math.round(pane)}
          tabIndex={0}
          onPointerDown={(event) => begin("pane", event)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") nudge("pane", 16);
            if (event.key === "ArrowRight") nudge("pane", -16);
          }}
        />
        <aside className="desk-pane" style={{ width: pane }}>{props.inspector}</aside>
      </div>
    </div>
  );
}

export function Pipeline(props: { done: boolean; running: boolean; mark?: string; caption: string }) {
  const steps = ["采集", "清洗去重", "聚类", "分析", "成稿"];
  const marked = props.mark ? steps.indexOf(props.mark) : -1;
  return (
    <div className="pipe">
      <ol>
        {steps.map((label, index) => {
          const state = props.done ? "done" : marked >= 0 ? (index < marked ? "done" : index === marked ? "now" : "wait") : props.running && index === 0 ? "now" : "wait";
          return (
            <li className={state} key={label}>
              <span>{state === "wait" ? "" : <Icon name="check" />}</span>
              {label}
            </li>
          );
        })}
      </ol>
      <p>{props.caption}</p>
    </div>
  );
}

export function CountPills(props: {
  counts: { key: string; label: string; count: number }[];
  active: string | null;
  onPick: (key: string) => void;
}) {
  const peak = Math.max(0, ...props.counts.map((item) => item.count));
  return (
    <div className="pills" role="group" aria-label="按结论筛选">
      {props.counts.map((item) => (
        <button key={item.key} type="button" className={props.active === item.key ? "on" : ""} aria-pressed={props.active === item.key} onClick={() => props.onPick(item.key)}>
          {item.label} <b className={item.count > 0 && item.count === peak ? "hot" : ""}>{item.count}</b>
        </button>
      ))}
    </div>
  );
}

export function StoryCard(props: { title: string; url: string; what: string; why: string; source: string }) {
  return (
    <article className="story">
      {props.url ? <a href={props.url} target="_blank" rel="noopener noreferrer">{props.title}</a> : <strong>{props.title}</strong>}
      {(props.what || props.why) && (
        <p className="story-notes">
          {props.what && <span>发生了什么</span>}
          {props.why && <span>为何关注</span>}
        </p>
      )}
      {props.what && <p className="story-copy">{props.what}</p>}
      {props.why && <p className="story-copy">{props.why}</p>}
      {props.source && <p className="story-source"><Icon name="link" />{props.source}</p>}
    </article>
  );
}

export function LogTable(props: {
  open: boolean;
  onToggle: () => void;
  rows: { command: string; status: string; bad: boolean }[];
}) {
  return (
    <section className="log">
      <button type="button" onClick={props.onToggle}>
        <Icon name={props.open ? "down" : "right"} />
        平台与日志
      </button>
      {props.open && (
        <ul>
          {props.rows.length === 0 && <li><span>这次还没有平台记录</span></li>}
          {props.rows.map((row) => (
            <li key={row.command}>
              <Icon name="source" />
              <span>{row.command}</span>
              <em className={row.bad ? "bad" : ""}>{row.status}</em>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SettingRow(props: { icon: "key" | "users" | "clock" | "folder"; label: string; value: string; open: boolean; onToggle: () => void; children?: ReactNode }) {
  return (
    <div className={props.open ? "set-row open" : "set-row"}>
      <button type="button" onClick={props.onToggle}>
        <Icon name={props.icon} />
        <span>
          <small>{props.label}</small>
          <b>{props.value}</b>
        </span>
        <Icon name="right" />
      </button>
      {props.open && <div className="set-body">{props.children}</div>}
    </div>
  );
}

export function Icon(props: { name: "back" | "refresh" | "check" | "link" | "down" | "right" | "key" | "users" | "clock" | "folder" | "source" | "grid" | "note" | "clip" | "board" | "settings" }) {
  const common = { viewBox: "0 0 24 24", width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (props.name) {
    case "back":
      return <svg {...common}><path d="M15 6 9 12l6 6" /></svg>;
    case "refresh":
      return <svg {...common}><path d="M20 12a8 8 0 1 1-2.2-5.5" /><path d="M20 4v5h-5" /></svg>;
    case "check":
      return <svg {...common}><path d="m6 12 4 4 8-8" /></svg>;
    case "link":
      return <svg {...common}><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" /></svg>;
    case "down":
      return <svg {...common}><path d="m6 9 6 6 6-6" /></svg>;
    case "right":
      return <svg {...common}><path d="m9 6 6 6-6 6" /></svg>;
    case "key":
      return <svg {...common}><circle cx="8" cy="14" r="3" /><path d="M10.5 12.5 20 3" /><path d="M16 7h4M18 5v4" /></svg>;
    case "users":
      return <svg {...common}><circle cx="9" cy="8" r="3" /><path d="M3 19c1-3 3.2-4.5 6-4.5S14 16 15 19" /><circle cx="17" cy="9" r="2" /><path d="M16 14.5c2 .3 3.5 1.5 4.2 3.5" /></svg>;
    case "clock":
      return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M12 8v5l3 2" /></svg>;
    case "folder":
      return <svg {...common}><path d="M3 7h6l2 2h10v10H3z" /></svg>;
    case "source":
      return <svg {...common}><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 12h8" /></svg>;
    case "grid":
      return <svg {...common}><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></svg>;
    case "note":
      return <svg {...common}><path d="M7 3h8l5 5v13H7z" /><path d="M15 3v5h5" /></svg>;
    case "clip":
      return <svg {...common}><path d="m16 8-6.5 6.5a3 3 0 0 1-4-4L12 4a4 4 0 0 1 6 6l-7 7a5 5 0 0 1-7-7l1-1" /></svg>;
    case "board":
      return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M3 9h6" /></svg>;
    case "settings":
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8 5.6 18.4" /></svg>;
    default: {
      const unreachable: never = props.name;
      return unreachable;
    }
  }
}
