import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { request } from "../api";
import { clock } from "../types";

interface DigestEntry { day: string; bytes: number; updatedAt: string }

export function DigestsPage() {
  const [entries, setEntries] = useState<DigestEntry[]>([]);
  const [day, setDay] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    request<{ digests: DigestEntry[] }>("/api/ledger/digests").then((body) => {
      setEntries(body.digests);
      setDay(body.digests[0]?.day ?? "");
    }).catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!day) return;
    let active = true;
    setText("");
    setError("");
    setNotice("");
    request<{ text: string }>(`/api/ledger/digests/${day}`).then((body) => { if (active) setText(body.text); }).catch((reason: Error) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [day]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("简报已复制。");
    } catch {
      setError("浏览器未允许复制，请选中正文复制，或下载 Markdown 文件。");
    }
  }

  return <div className="desk ledger-desk">
    <header className="desk-top">
      <Link className="desk-back" to="/" aria-label="回到首页">←</Link>
      <h1 className="desk-title">采集简报</h1>
      <span className="desk-status">{entries.length} 天的本地记录</span>
      <div className="desk-top-gap" />
      <Link to="/collect">去采集</Link>
      <button className="secondary-button" type="button" disabled={!text} onClick={() => void copy()}>复制简报</button>
      {text ? <a className="download-button" href={`/api/ledger/digests/${day}?download=1`} download={`headline-chaser-${day}.md`}>下载 Markdown</a> : null}
    </header>
    {error ? <p className="ledger-error" role="alert">{error}</p> : null}
    {notice ? <p className="action-notice" role="status">{notice}</p> : null}
    <div className="desk-body">
      <aside className="desk-side" style={{ width: 220 }}><div className="archive"><h2>日期</h2>{entries.map((entry) => <button type="button" key={entry.day} className={day === entry.day ? "archive-row on" : "archive-row"} onClick={() => setDay(entry.day)}><span>{entry.day}</span><em>{Math.max(1, Math.ceil(entry.bytes / 1024))} KB</em></button>)}</div></aside>
      <main className="desk-main ledger-main">
        <p className="ledger-note">在各栏目打开“生成本地简报”后，采集结束会将该栏目本轮变化追加到当天简报。同一天可能包含多轮记录；这里可查看、复制和下载，不会发送到邮箱或其他应用。</p>
        {day ? <p className="digest-meta">最后更新 {clock(entries.find((entry) => entry.day === day)?.updatedAt ?? "")}</p> : null}
        {text ? <pre className="digest-content" tabIndex={0}>{text}</pre> : <p className="ledger-empty">{loading || day && !error ? "正在读取简报…" : "还没有简报。先在栏目页打开“生成本地简报”，再进行一次采集。"}</p>}
      </main>
    </div>
  </div>;
}
