import { useEffect, useRef, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { request } from "./api";
import { CountPills, DeskFrame, Icon, LogTable, Pipeline, SettingRow, StoryCard } from "./desk";
import { fileStamp, stripFrontMatter } from "./format";

interface TopicPayload {
  topic: {
    id: string;
    status: "pending" | "confirmed";
    utterance: string;
    keywords: string[];
    keywordsEn?: string[];
    mustInclude?: string[];
    exclude?: string[];
    timeWindow?: number | string;
    itemCount?: number;
    audience?: "学生" | "从业者" | "管理层" | "随便看看";
    platforms: { command: string; selected: boolean }[];
    morningReport: { enabled: boolean; time: string | null };
    folderPath: string;
    snapshotCount: number;
  };
  pending: { type: "collect" | "research" | "track" | "update-plan" | "agree-plan" | "organize"; keywords: string[]; platforms: string[]; queries?: string[]; assignment?: string; note?: { preview: string } } | null;
  defaultTab: "control" | "overview";
}

interface CatalogEntry {
  command: string;
  description: string;
  selectable: boolean;
  disabledReason?: string;
  loginState: string;
}

interface DigestView { title: string; url: string; what: string; why: string; source: string }
interface Claim { title: string; url: string; detail: string }
interface HotspotView {
  title: string;
  url: string;
  score: number;
  stage: string;
  discussion: string;
  factors: { label: string; note: string }[];
}

interface Overview {
  empty: boolean;
  mode?: "empty" | "research" | "hotspot" | "daily" | "legacy";
  heading: string;
  baselineLabel: string;
  hasVerdicts: boolean;
  quiet?: boolean;
  hotspots?: HotspotView[];
  digests?: DigestView[];
  digestLead?: string;
  digestFollowups?: string[];
  groups: Record<GroupKey, Claim[]>;
  newSources: { title: string; url: string; platform: string }[];
  events: { title: string; url: string; platforms: string[] }[];
  failures: { command: string; error?: string }[];
  clusteringNote: string | null;
  halted?: string | null;
}

interface TreeEntry { path: string; kind: string; children?: { path: string }[] }
interface ChatQuestion { id: string; prompt: string; options: string[]; multiple: boolean }
interface ChatMessage { id: string; role: "user" | "assistant"; content: string; citations: { type: string; path?: string; url?: string }[]; questions?: ChatQuestion[] }
interface JobStep { command: string; state: "pending" | "running" | "success" | "failed" }
interface JobView { state: string; error: string | null; phase?: string; steps: JobStep[] }
interface Reading {
  path: string;
  title: string;
  platforms: { command: string; status: string; error?: string }[] | null;
  events: { title: string; url: string; platforms: string[] }[] | null;
  dropped: { title: string; reason: string; publishedAt?: string }[] | null;
  text: string;
}

const GROUPS = [
  ["appeared", "新出现"],
  ["heating", "升温"],
  ["ongoing", "还在"],
  ["fading", "正在消退"],
] as const;

type GroupKey = (typeof GROUPS)[number][0];
type Center = "board" | "settings";

export function Workspace() {
  const { id = "" } = useParams();
  const [payload, setPayload] = useState<TopicPayload | null>(null);
  const [center, setCenter] = useState<Center>("board");
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [loginChecking, setLoginChecking] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [tree, setTree] = useState<TreeEntry[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordsEn, setKeywordsEn] = useState<string[]>([]);
  const [mustInclude, setMustInclude] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [timeWindow, setTimeWindow] = useState(7);
  const [itemCount, setItemCount] = useState(6);
  const [audience, setAudience] = useState<"学生" | "从业者" | "管理层" | "随便看看">("随便看看");
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [folderPath, setFolderPath] = useState("");
  const [morningTime, setMorningTime] = useState("08:00");
  const [morningOn, setMorningOn] = useState(false);
  const [reading, setReading] = useState<Reading | null>(null);
  const [chatText, setChatText] = useState("");
  const [materialUrl, setMaterialUrl] = useState("");
  const [noteText, setNoteText] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const chatLock = useRef(false);
  const postChatRef = useRef<(text: string) => Promise<void>>(async () => undefined);
  const [formError, setFormError] = useState("");
  const [chatError, setChatError] = useState("");
  const [fileError, setFileError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [job, setJob] = useState<JobView | null>(null);
  const [jobLines, setJobLines] = useState<{ command: string; label: string }[]>([]);
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState<GroupKey | null>(null);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [editor, setEditor] = useState<"keywords" | "platforms" | "window" | "folder" | null>(null);
  const [logOpen, setLogOpen] = useState(true);
  const platformRef = useRef<HTMLDivElement>(null);

  async function load(): Promise<{ job: JobView | null; messages: number }> {
    setLoadError("");
    const next = await request<TopicPayload>(`/api/topics/${id}`);
    setPayload(next);
    setKeywords(next.topic.keywords);
    setKeywordsEn(next.topic.keywordsEn ?? []);
    setMustInclude(next.topic.mustInclude ?? []);
    setExcluded(next.topic.exclude ?? []);
    setTimeWindow(daysOf(next.topic.timeWindow));
    setItemCount(next.topic.itemCount ?? 6);
    setAudience(next.topic.audience ?? "随便看看");
    setPlatforms(next.topic.platforms.filter((item) => item.selected).map((item) => item.command));
    setFolderPath(next.topic.folderPath);
    setMorningOn(next.topic.morningReport.enabled);
    setMorningTime(next.topic.morningReport.time ?? "08:00");
    const [source, status, files, chat, current] = await Promise.all([
      request<{ commands: CatalogEntry[]; loginChecking: boolean }>("/api/catalog"),
      request<Overview>(`/api/topics/${id}/overview`),
      request<{ entries: TreeEntry[] }>(`/api/topics/${id}/tree`),
      request<{ messages: ChatMessage[] }>(`/api/topics/${id}/chat`),
      request<{ job: JobView | null }>(`/api/topics/${id}/jobs/current`),
    ]);
    setCatalog(source.commands);
    setLoginChecking(source.loginChecking);
    setOverview(status);
    setTree(files.entries);
    setMessages(chat.messages);
    setJob(current.job);
    setJobLines(summarizeSteps(current.job?.steps ?? [], current.job?.state === "running"));
    if (current.job?.state === "running") setRunning(true);
    return { job: current.job, messages: chat.messages.length };
  }

  async function refreshQuiet() {
    const status = await request<Overview>(`/api/topics/${id}/overview`);
    const files = await request<{ entries: TreeEntry[] }>(`/api/topics/${id}/tree`);
    const next = await request<TopicPayload>(`/api/topics/${id}`);
    setOverview(status);
    setTree(files.entries);
    setPayload(next);
    setFilter(null);
  }

  async function pollJob() {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const current = await request<{ job: JobView | null }>(`/api/topics/${id}/jobs/current`);
      const next = current.job;
      setJob(next);
      setJobLines(summarizeSteps(next?.steps ?? [], next?.state === "running"));
      if (next && next.state !== "running") {
        if (next.state === "failed") setFormError(next.error ?? "这次没有留下快照。");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  useEffect(() => {
    let stop = false;
    setReading(null);
    setFilter(null);
    setOpenSection(null);
    setEditor(null);
    setCenter("board");
    setRunning(false);
    setJob(null);
    load().then(async (current) => {
      if (stop) return;
      const openingKey = `followup-opening:${id}`;
      const opening = sessionStorage.getItem(openingKey);
      if (opening && current.messages === 0) {
        sessionStorage.removeItem(openingKey);
        await postChatRef.current(opening);
      } else if (opening) {
        sessionStorage.removeItem(openingKey);
      }
      if (stop || current.job?.state !== "running") return;
      await pollJob();
      if (stop) return;
      await refreshQuiet();
      setRunning(false);
    }).catch((reason: Error) => {
      if (!stop) setLoadError(reason.message);
    });
    return () => {
      stop = true;
    };
  }, [id]);

  useEffect(() => {
    if (!loginChecking) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const poll = async () => {
      try {
        const source = await request<{ commands: CatalogEntry[]; loginChecking: boolean }>("/api/catalog");
        if (stopped) return;
        setCatalog(source.commands);
        setLoginChecking(source.loginChecking);
        if (source.loginChecking && ++attempts < 5) timer = setTimeout(() => void poll(), 1_000);
      } catch { /* 登录状态提示不影响主题工作区。 */ }
    };
    timer = setTimeout(() => void poll(), 1_000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [id, loginChecking]);

  useEffect(() => {
    if (editor !== "platforms") return;
    function close(event: PointerEvent) {
      const node = platformRef.current;
      if (node && event.target instanceof Node && node.contains(event.target)) return;
      setEditor((current) => current === "platforms" ? null : current);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [editor]);

  async function run(kind: "research" | "track") {
    setFormError("");
    setRunning(true);
    setJobLines([{ command: kind === "research" ? "调研" : "热点", label: kind === "research" ? "正在调研" : "正在追踪热点" }]);
    try {
      if (payload?.topic.status === "confirmed") {
        await request(`/api/topics/${id}/plan`, {
          method: "PATCH",
          body: JSON.stringify({ keywords, platforms, folderPath, morningReport: { enabled: morningOn, time: morningTime }, card: themeCard() }),
        });
      }
      await request(`/api/topics/${id}/jobs`, { method: "POST", body: JSON.stringify({ kind }) });
      await pollJob();
      await refreshQuiet();
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "这次没有留下快照。");
    } finally {
      setRunning(false);
    }
  }

  function themeCard() {
    return { keywordsEn, mustInclude, exclude: excluded, timeWindow, itemCount, audience };
  }

  async function confirmPlan() {
    setFormError("");
    try {
      if (payload?.topic.status === "pending") {
        await request(`/api/topics/${id}/confirm`, { method: "POST", body: JSON.stringify({ keywords, platforms, folderPath, card: themeCard() }) });
      } else {
        await request(`/api/topics/${id}/plan`, {
          method: "PATCH",
          body: JSON.stringify({ keywords, platforms, folderPath, morningReport: { enabled: morningOn, time: morningTime }, card: themeCard() }),
        });
      }
      await load();
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "没有保存计划。");
    }
  }

  async function confirmPending() {
    const pending = payload?.pending;
    setFormError("");
    try {
      await request(`/api/topics/${id}/pending/confirm`, { method: "POST" });
      if (pending?.type === "collect" || pending?.type === "research" || pending?.type === "track") {
        setRunning(true);
        await pollJob();
      }
      await load();
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "这次没有留下快照。");
    } finally {
      setRunning(false);
    }
  }

  async function postChat(text: string) {
    const content = text.trim();
    if (!content || chatLock.current) return;
    chatLock.current = true;
    setChatBusy(true);
    setChatError("");
    setMessages((current) => current.some((message) => message.role === "user" && message.content === content)
      ? current
      : [...current, { id: "pending-user", role: "user", content, citations: [] }]);
    try {
      const body = await request<{ messages: ChatMessage[]; pending: TopicPayload["pending"] }>(`/api/topics/${id}/chat`, {
        method: "POST",
        body: JSON.stringify({ text: content }),
      });
      setMessages(body.messages);
      if (body.pending) {
        setReading(null);
        setCenter("settings");
        const next = await request<TopicPayload>(`/api/topics/${id}`);
        setPayload(next);
      }
    } catch (reason) {
      setChatError(reason instanceof Error ? reason.message : "对话没有送出。");
      setChatText(content);
      const chat = await request<{ messages: ChatMessage[] }>(`/api/topics/${id}/chat`).catch(() => null);
      if (chat) setMessages(chat.messages);
    } finally {
      chatLock.current = false;
      setChatBusy(false);
    }
  }
  postChatRef.current = postChat;

  async function sendChat() {
    const text = chatText.trim();
    if (!text || chatBusy) return;
    setChatText("");
    await postChat(text);
  }

  async function openFile(relative: string) {
    setFileError("");
        try {
      if (relative.startsWith("快照/") && relative.endsWith(".json")) {
        const snapshotId = relative.slice("快照/".length, -".json".length);
        const body = await request<{
          snapshot: {
            platforms: { command: string; status: string; error?: string }[];
            events: { title: string; itemIds: string[]; platforms: string[] }[];
            items: { id: string; title: string; url: string; publishedAt?: string; drop?: string }[];
          };
          briefText: string;
        }>(`/api/topics/${id}/snapshots/${snapshotId}`);
        const items = new Map(body.snapshot.items.map((item) => [item.id, item.url]));
        setCenter("board");
        setReading({
          path: relative,
          title: fileStamp(relative) ?? relative,
          platforms: body.snapshot.platforms,
          events: body.snapshot.events.map((event) => ({
            title: event.title,
            url: event.itemIds.map((itemId) => items.get(itemId) ?? "").find((url) => /^https?:\/\//i.test(url)) ?? "",
            platforms: event.platforms,
          })),
          dropped: body.snapshot.items.flatMap((item) => item.drop ? [{ title: item.title, reason: item.drop, publishedAt: item.publishedAt }] : []),
          text: stripFrontMatter(body.briefText),
        });
        return;
      }
      const body = await request<{ text: string }>(`/api/topics/${id}/file?path=${encodeURIComponent(relative)}`);
      const raw = relative.startsWith("简报/") ? stripFrontMatter(body.text) : body.text;
      setCenter("board");
      setReading({
        path: relative,
        title: fileStamp(relative) ?? relative.split("/").pop() ?? relative,
        platforms: null,
        events: null,
        dropped: null,
        text: raw,
      });
    } catch (reason) {
      setFileError(reason instanceof Error ? reason.message : "打不开这个文件。");
    }
  }

  async function saveUrl() {
    setFileError("");
    try {
      await request(`/api/topics/${id}/materials`, { method: "POST", body: JSON.stringify({ url: materialUrl }) });
      setMaterialUrl("");
      await refreshQuiet();
    } catch (reason) {
      setFileError(reason instanceof Error ? reason.message : "没有保存链接。");
    }
  }

  async function saveNote() {
    const text = noteText.trim();
    if (!text) return;
    setFileError("");
    try {
      await request(`/api/topics/${id}/notes`, { method: "POST", body: JSON.stringify({ text }) });
      setNoteText("");
      await refreshQuiet();
    } catch (reason) {
      setFileError(reason instanceof Error ? reason.message : "没有记下。");
    }
  }

  async function pickFolder() {
    const picked = await request<{ path: string | null }>("/api/folders/pick", { method: "POST" });
    if (picked.path) setFolderPath(picked.path);
  }

  async function cancelPending() {
    await request(`/api/topics/${id}/pending`, { method: "DELETE" });
    const next = await request<TopicPayload>(`/api/topics/${id}`);
    setPayload(next);
  }

  async function setMorning(enabled: boolean) {
    if (morningLocked) return;
    setMorningOn(enabled);
    try {
      await request(`/api/topics/${id}/plan`, {
        method: "PATCH",
        body: JSON.stringify({ morningReport: { enabled, time: morningTime } }),
      });
    } catch (reason) {
      setMorningOn(!enabled);
      setFormError(reason instanceof Error ? reason.message : "没有保存晨报。");
    }
  }

  const confirmed = payload?.topic.status === "confirmed";
  const noSnapshot = (payload?.topic.snapshotCount ?? 0) === 0;
  const canConfirm = keywords.length > 0 && platforms.length > 0;
  const morningLocked = !confirmed || noSnapshot;
  const primary = primaryAction(confirmed, noSnapshot);

  const comparable = Boolean(overview?.hasVerdicts);
  const listed = (overview?.digests ?? []).length;
  const counts = comparable
    ? GROUPS.map(([key, label]) => ({ key, label: key === "fading" ? "消退" : label, count: overview?.groups[key].length ?? 0 }))
    : [
        { key: "appeared", label: "新出现", count: listed },
        { key: "heating", label: "升温", count: 0 },
        { key: "ongoing", label: "还在", count: 0 },
        { key: "fading", label: "消退", count: 0 },
      ];
  const feed = storiesOf(overview, filter);
  const logs = logRows(platforms, overview, jobLines, noSnapshot);
  const halt = job?.error && (job.state === "incomplete" || job.state === "failed") && job.error.startsWith("已停在") ? job.error : overview?.halted || null;
  const status = deskStatus(running, Boolean(payload?.pending) || !confirmed, noSnapshot, Boolean(overview?.quiet), Boolean(halt));

  return (
    <DeskFrame
      title={payload?.topic.utterance ?? ""}
      status={status}
      action={primary.label}
      actionDisabled={primary.needsPlan ? !canConfirm : running}
      onAction={() => void (primary.kind === "plan" ? confirmPlan() : run(primary.kind))}
      morningOn={morningOn}
      morningLocked={morningLocked}
      onMorning={(enabled) => void setMorning(enabled)}
      settingsOn={!reading && center === "settings"}
      onSettings={() => {
        setReading(null);
        setCenter((current) => current === "settings" ? "board" : "settings");
      }}
      files={
        <div className="archive">
          <h2>档案</h2>
          <ArchiveRow icon="board" label="总工作台" count={null} open={!reading && center === "board"} onClick={() => { setReading(null); setCenter("board"); }} />
          <ArchiveRow icon="grid" label="主题说明" count={null} open={reading?.path === "主题.md"} onClick={() => void openFile("主题.md")} />
          {(["简报", "快照", "笔记", "素材"] as const).map((name) => {
            const entry = tree.find((item) => item.path === name);
            const children = [...(entry?.children ?? [])].sort((left, right) => left.path.localeCompare(right.path));
            const open = openSection === name;
            return (
              <div key={name}>
                <ArchiveRow
                  icon={name === "素材" ? "clip" : name === "笔记" ? "note" : "check"}
                  label={name}
                  count={children.length}
                  open={open}
                  onClick={() => setOpenSection(open ? null : name)}
                />
                {open && (
                  <>
                    {children.length === 0 ? <p className="archive-empty">空</p> : children.map((child) => {
                      const label = fileStamp(child.path) ?? child.path.split("/").pop() ?? child.path;
                      return (
                        <button className={reading?.path === child.path ? "archive-file on" : "archive-file"} key={child.path} type="button" title={child.path} onClick={() => void openFile(child.path)}>{label}</button>
                      );
                    })}
                    {name === "笔记" && (
                      <form className="archive-add" onSubmit={(event) => { event.preventDefault(); void saveNote(); }}>
                        <textarea value={noteText} onChange={(event) => setNoteText(event.target.value)} rows={3} placeholder="写一条笔记" />
                        <button type="submit">记下</button>
                      </form>
                    )}
                    {name === "素材" && (
                      <form className="archive-add" onSubmit={(event) => { event.preventDefault(); void saveUrl(); }}>
                        <input value={materialUrl} onChange={(event) => setMaterialUrl(event.target.value)} placeholder="保存一条链接" />
                        <button type="submit">保存</button>
                      </form>
                    )}
                  </>
                )}
              </div>
            );
          })}
          {fileError && <p className="error">{fileError}</p>}
        </div>
      }
      main={
        <div className="feed">
          {loadError && <p className="error">{loadError}</p>}
          {formError && <p className="error">{formError}</p>}
          {payload?.pending && (
            <div className="desk-pending">
              <p>将要执行：{pendingLabel(payload.pending)}</p>
              {payload.pending.note?.preview && <p className="preview">{payload.pending.note.preview}</p>}
              <button type="button" onClick={() => void confirmPending()}>确认执行</button>
              <button type="button" onClick={() => void cancelPending()}>取消</button>
            </div>
          )}
          {reading ? (
            <article className="reading">
              <h2>{reading.title}</h2>
              {reading.platforms && (
                <ul className="reading-list">
                  {reading.platforms.map((item) => (
                    <li key={item.command}>{item.command} {item.status === "success" ? "成功" : item.status === "failed" ? `失败${item.error ? ` · ${item.error}` : ""}` : item.status}</li>
                  ))}
                </ul>
              )}
              {reading.events?.map((event) => (
                <div className="story" key={`${event.title}${event.url}`}>
                  {event.url ? <a href={event.url} target="_blank" rel="noopener noreferrer">{event.title}</a> : <strong>{event.title}</strong>}
                  {event.platforms.length > 0 && <p className="story-source">来源：{event.platforms.join("、")}</p>}
                </div>
              ))}
              {reading.dropped && reading.dropped.length > 0 && (
                <div className="story">
                  <strong>已丢弃</strong>
                  {reading.dropped.map((item) => (
                    <p className="story-copy" key={`${item.title}${item.reason}`}>{item.title}{item.publishedAt ? ` · ${item.publishedAt.slice(0, 16).replace("T", " ")}` : ""} · {item.reason}</p>
                  ))}
                </div>
              )}
              {reading.text && <Prose text={reading.text} />}
            </article>
          ) : center === "settings" ? (
            <div className="settings-sheet">
              <h2>设置</h2>
              <SettingRow icon="key" label="关键词" value={keywords.join("、") || "未设置"} open={editor === "keywords"} onToggle={() => setEditor(editor === "keywords" ? null : "keywords")}>
                <ChipEditor placeholder="关键词" values={keywords} onChange={setKeywords} />
                <ChipEditor placeholder="英文检索词，可空" values={keywordsEn} onChange={setKeywordsEn} />
                <ChipEditor placeholder="必须照看" values={mustInclude} onChange={setMustInclude} />
                <ChipEditor placeholder="排除" values={excluded} onChange={setExcluded} />
                {!confirmed && <p className="hint">先在右侧对话里把主题卡谈定，也可以在这里填写。</p>}
              </SettingRow>
              <div ref={platformRef}>
                <SettingRow icon="users" label="平台" value={platforms.length === 0 ? "未选平台" : `已选 ${platforms.length} 个`} open={editor === "platforms"} onToggle={() => setEditor(editor === "platforms" ? null : "platforms")}>
                  <div className="platform-panel">
                    {catalog.map((entry) => (
                      <label className={platforms.includes(entry.command) ? "plat on" : "plat"} key={entry.command}>
                        <input
                          type="checkbox"
                          disabled={!entry.selectable}
                          checked={platforms.includes(entry.command)}
                          onChange={(event) => setPlatforms(event.target.checked ? [...platforms, entry.command] : platforms.filter((item) => item !== entry.command))}
                        />
                        <span>
                          {entry.command}
                          {entry.loginState === "not-logged-in" && " · 需要登录"}
                          {!entry.selectable && (entry.disabledReason === "login-required" ? " · 需要登录，暂不纳入" : " · 暂不能纳入对比")}
                        </span>
                      </label>
                    ))}
                  </div>
                </SettingRow>
              </div>
              <SettingRow icon="clock" label="时间窗" value={`过去 ${timeWindow} 天`} open={editor === "window"} onToggle={() => setEditor(editor === "window" ? null : "window")}>
                <div className="choice">
                  <button type="button" className={timeWindow === 1 ? "on" : ""} onClick={() => setTimeWindow(1)}>1 天</button>
                  <button type="button" className={timeWindow === 7 ? "on" : ""} onClick={() => setTimeWindow(7)}>7 天</button>
                  <input
                    type="number"
                    min={1}
                    max={90}
                    aria-label="过去几天"
                    value={timeWindow}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      if (!Number.isFinite(next)) return;
                      setTimeWindow(Math.min(90, Math.max(1, Math.round(next))));
                    }}
                  />
                </div>
                <label>留下几条
                  <select value={itemCount} onChange={(event) => setItemCount(Number(event.target.value))}>
                    <option value={5}>5</option>
                    <option value={6}>6</option>
                    <option value={7}>7</option>
                  </select>
                </label>
                <label>写给谁看
                  <select value={audience} onChange={(event) => setAudience(audienceOf(event.target.value))}>
                    <option value="学生">学生</option>
                    <option value="从业者">从业者</option>
                    <option value="管理层">管理层</option>
                    <option value="随便看看">随便看看</option>
                  </select>
                </label>
                <label>简报时间
                  <input type="time" value={morningTime} disabled={morningLocked} onChange={(event) => setMorningTime(event.target.value)} />
                </label>
              </SettingRow>
              <SettingRow icon="folder" label="文件夹" value={folderPath.split(/[/\\]/).pop() || folderPath} open={editor === "folder"} onToggle={() => setEditor(editor === "folder" ? null : "folder")}>
                <input className="path" value={folderPath} title={folderPath} onChange={(event) => setFolderPath(event.target.value)} />
                <div className="folder-actions">
                  <button className="text" type="button" onClick={() => void request(`/api/topics/${id}/folder/open`, { method: "POST" })}>在文件管理器中打开</button>
                  <button className="text" type="button" onClick={() => void pickFolder()}>改挂文件夹</button>
                </div>
              </SettingRow>
              {confirmed && <button className="text save-plan" type="button" disabled={!canConfirm || running} onClick={() => void confirmPlan()}>保存修改</button>}
            </div>
          ) : (
            <>
              <Pipeline done={!noSnapshot && !running && !overview?.empty && !halt} running={running} mark={halt || running ? job?.phase ?? "采集" : undefined} caption={halt ?? pipelineCaption(running, noSnapshot, overview, jobLines)} />
              {overview && !overview.empty && overview.digestLead ? <p className="quiet-line">{overview.digestLead}</p> : null}
              <CountPills counts={counts} active={filter} onPick={(key) => { if (!comparable) return; setFilter(filter === key ? null : key as GroupKey); }} />
              {overview?.quiet && feed.length > 0 && <p className="quiet-line">今日无明显更新。</p>}
              {!overview || overview.empty ? (
                <div className="feed-empty">
                  <p>尚未调研。</p>
                  <button type="button" onClick={() => { setReading(null); setCenter("settings"); }}>先把调研方案谈定，再开始第一次调研。</button>
                </div>
              ) : feed.length === 0 ? (
                <p className="quiet-line">{filter ? "这一组里没有条目。" : "这一轮没有可展示的条目。"}</p>
              ) : feed.map((item) => <StoryCard key={item.key} title={item.title} url={item.url} what={item.what} why={item.why} source={item.source} />)}
              <LogTable open={logOpen} onToggle={() => setLogOpen((open) => !open)} rows={logs} />
            </>
          )}
        </div>
      }
      inspector={
        <div className="talk">
          <div className="talk-log">
            {messages.length === 0 && <p className="quiet-line">跟这个主题接着说。</p>}
            {messages.map((message, index) => {
              const questions = message.questions ?? [];
              const live = questions.length > 0 && index === messages.length - 1 && message.role === "assistant";
              return (
                <article key={message.id}>
                  <small>{message.role === "user" ? "你" : "跟进"}</small>
                  <p>{message.content}</p>
                  {live ? <AskBox questions={questions} disabled={chatBusy} onSend={(text) => void postChat(text)} /> : <QuestionText questions={questions} />}
                  {message.citations.map((citation, citationIndex) => (
                    citation.url
                      ? <a key={`${citation.url}-${citationIndex}`} href={citation.url} target="_blank" rel="noopener noreferrer">{citation.url}</a>
                      : <span key={`${citation.path ?? "cite"}-${citationIndex}`}>{citation.path}</span>
                  ))}
                </article>
              );
            })}
          </div>
          {chatError && <p className="error">{chatError}</p>}
          <form onSubmit={(event) => { event.preventDefault(); void sendChat(); }}>
            <textarea value={chatText} onChange={(event) => setChatText(event.target.value)} rows={3} placeholder="问问这个主题" disabled={chatBusy} />
            <button type="submit" disabled={chatBusy || !chatText.trim()}>发送</button>
          </form>
        </div>
      }
    />
  );
}

function ArchiveRow(props: { icon: "grid" | "check" | "note" | "clip" | "board"; label: string; count: number | null; open: boolean; onClick: () => void }) {
  return (
    <button className={props.open ? "archive-row on" : "archive-row"} type="button" onClick={props.onClick}>
      <Icon name={props.icon} />
      {props.label}
      {props.count !== null && props.count > 0 && <em>{props.count}</em>}
    </button>
  );
}

function ChipEditor(props: { placeholder: string; values: string[]; onChange: (values: string[]) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <div className="chips-edit">
      <div className="add-row">
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={props.placeholder} />
        <button type="button" onClick={() => { if (!draft.trim()) return; props.onChange([...props.values, draft.trim()]); setDraft(""); }}>添加</button>
      </div>
      <div className="chips">
        {props.values.map((item, index) => (
          <span className="chip" key={`${item}-${index}`}>
            {item}
            <button type="button" onClick={() => props.onChange(props.values.filter((word, wordIndex) => word !== item || wordIndex !== index))}>删除</button>
          </span>
        ))}
      </div>
    </div>
  );
}

function storiesOf(overview: Overview | null, filter: GroupKey | null): { key: string; title: string; url: string; what: string; why: string; source: string }[] {
  if (!overview) return [];
  if (filter) {
    return overview.groups[filter].map((item) => ({
      key: `${item.title}${item.url}`,
      title: item.title,
      url: item.url,
      what: item.detail,
      why: "",
      source: overview.events.find((event) => event.url === item.url)?.platforms.join("、") ? `来源：${overview.events.find((event) => event.url === item.url)?.platforms.join("、")}` : "",
    }));
  }
  return (overview.digests ?? []).map((item) => ({
    key: item.url || item.title,
    title: item.title,
    url: item.url,
    what: item.what,
    why: item.why,
    source: item.source ? `来源：${item.source}` : "",
  }));
}

function logRows(platforms: string[], overview: Overview | null, jobLines: { command: string; label: string }[], noSnapshot: boolean): { command: string; status: string; bad: boolean }[] {
  if (jobLines.length > 0) {
    return jobLines.map((line) => ({ command: line.command, status: line.label, bad: line.label.startsWith("失败") }));
  }
  const failed = new Map((overview?.failures ?? []).map((item) => [item.command, item.error ?? "失败"]));
  const names = platforms.length > 0 ? platforms : [...failed.keys()];
  return names.map((command) => {
    const error = failed.get(command);
    if (error) return { command, status: `失败 · ${error}`, bad: true };
    return { command, status: noSnapshot ? "等待" : "已采集", bad: false };
  });
}

function deskStatus(running: boolean, pending: boolean, noSnapshot: boolean, quiet: boolean, halted: boolean): string {
  if (running) return "进行中·可离开";
  if (halted) return "已停止";
  if (pending) return "待确认";
  if (noSnapshot) return "待调研";
  if (quiet) return "无明显更新";
  return "已更新";
}

function pipelineCaption(running: boolean, noSnapshot: boolean, overview: Overview | null, jobLines: { command: string; label: string }[]): string {
  if (running) {
    const current = jobLines.find((line) => line.label.includes("正在")) ?? jobLines[0];
    return current ? `采集中 · ${current.command} ${current.label}` : "采集中";
  }
  if (noSnapshot || !overview || overview.empty) return "还没有开始";
  const count = (overview.digests ?? []).length;
  return `已整理 ${count} 条${overview.clusteringNote ? ` · ${overview.clusteringNote}` : ""}`;
}

function daysOf(value: unknown): number {
  if (value === "1d") return 1;
  if (value === "7d") return 7;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 7;
  return Math.min(90, Math.max(1, Math.round(parsed)));
}
function Prose({ text }: { text: string }) {
  return (
    <div className="prose">
      {text.split("\n").map((line, index) => {
        if (!line.trim()) return null;
        if (line.startsWith("## ")) return <h3 key={index}>{line.slice(3)}</h3>;
        const body = line.startsWith("- ") ? line.slice(2) : line;
        return <p key={index}>{renderRich(body)}</p>;
      })}
    </div>
  );
}

function renderRich(line: string): ReactNode {
  const matched = line.match(/^(.*?)\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)\s*$/);
  if (!matched?.[1] || !matched[3]) return line;
  const title = matched[1].replace(/[。．]\s*$/, "");
  return <a className="claim-title" href={matched[3]} target="_blank" rel="noopener noreferrer">{title || matched[2]}</a>;
}

function primaryAction(confirmed: boolean, noSnapshot: boolean): { label: string; kind: "plan" | "research" | "track"; needsPlan: boolean } {
  if (!confirmed) return { label: "确认计划", kind: "plan", needsPlan: true };
  if (noSnapshot) return { label: "开始调研", kind: "research", needsPlan: false };
  return { label: "刷新追踪", kind: "track", needsPlan: false };
}

function pendingLabel(pending: NonNullable<TopicPayload["pending"]>): string {
  switch (pending.type) {
    case "collect":
    case "research":
      return actionLabel("开始调研", pending);
    case "track":
      return actionLabel("动态热点追踪", pending);
    case "agree-plan":
    case "update-plan":
      return `同意方案：关键词 ${pending.keywords.join("、")}，平台 ${pending.platforms.join("、")}`;
    case "organize":
      return "整理笔记";
    default: {
      const unreachable: never = pending.type;
      return unreachable;
    }
  }
}

function QuestionText({ questions }: { questions: ChatQuestion[] }) {
  if (questions.length === 0) return null;
  return <p className="ask-locked">{questions.map((question) => `${question.prompt}：${question.options.join("、")}`).join("\n")}</p>;
}

function AskBox({ questions, disabled, onSend }: { questions: ChatQuestion[]; disabled: boolean; onSend: (text: string) => void }) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [otherOn, setOtherOn] = useState<Record<string, boolean>>({});
  const [otherText, setOtherText] = useState<Record<string, string>>({});
  const sentence = questions.flatMap((question) => {
    const chosen = [...(picked[question.id] ?? [])];
    const extra = otherOn[question.id] ? otherText[question.id]?.trim() ?? "" : "";
    if (extra) chosen.push(extra);
    return chosen.length > 0 ? [chosen.join(question.multiple ? "、" : "，")] : [];
  }).join("，");
  function toggle(question: ChatQuestion, option: string) {
    setPicked((current) => {
      const selected = current[question.id] ?? [];
      const next = question.multiple
        ? selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option]
        : selected[0] === option ? [] : [option];
      return { ...current, [question.id]: next };
    });
  }
  return (
    <div className="ask">
      {questions.map((question) => (
        <fieldset key={question.id}>
          <legend>{question.prompt}</legend>
          <div className="ask-options">
            {question.options.map((option) => (
              <button type="button" key={option} className={(picked[question.id] ?? []).includes(option) ? "on" : ""} disabled={disabled} onClick={() => toggle(question, option)}>{option}</button>
            ))}
            <button type="button" className={otherOn[question.id] ? "on" : ""} disabled={disabled} onClick={() => setOtherOn((current) => ({ ...current, [question.id]: !current[question.id] }))}>其他</button>
          </div>
          {otherOn[question.id] && (
            <input value={otherText[question.id] ?? ""} disabled={disabled} placeholder="自己填" onChange={(event) => setOtherText((current) => ({ ...current, [question.id]: event.target.value }))} />
          )}
        </fieldset>
      ))}
      <button type="button" disabled={disabled || !sentence} onClick={() => onSend(sentence)}>就按这个</button>
    </div>
  );
}

function audienceOf(value: string): "学生" | "从业者" | "管理层" | "随便看看" {
  switch (value) {
    case "学生":
    case "从业者":
    case "管理层":
    case "随便看看":
      return value;
    default:
      return "随便看看";
  }
}

function summarizeSteps(steps: JobStep[], running: boolean): { command: string; label: string }[] {
  if (steps.length === 0) return running ? [{ command: "采集", label: "正在采集" }] : [];
  const order: string[] = [];
  const grouped = new Map<string, JobStep["state"][]>();
  for (const step of steps) {
    const states = grouped.get(step.command);
    if (states) states.push(step.state);
    else {
      grouped.set(step.command, [step.state]);
      order.push(step.command);
    }
  }
  return order.map((command) => ({ command, label: stepLabel(grouped.get(command) ?? []) }));
}

function actionLabel(action: string, pending: { queries?: string[]; assignment?: string }): string {
  const queries = (pending.queries ?? []).map((query) => query.trim()).filter(Boolean);
  const assignment = pending.assignment?.trim() ?? "";
  const detail = [queries.join("、"), assignment].filter(Boolean).join("。");
  return detail ? `${action}：${detail}` : action;
}

function stepLabel(states: JobStep["state"][]): string {
  const failed = states.some((state) => state === "failed");
  const success = states.some((state) => state === "success");
  const running = states.some((state) => state === "running");
  const pending = states.some((state) => state === "pending");
  if (failed && success) return "部分失败";
  if (failed) return "失败";
  if (running) return "正在采集";
  if (pending && success) return "已停下";
  if (success) return "成功";
  return "等待";
}
