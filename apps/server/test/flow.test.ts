import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { acceptQuestions } from "../src/chat/service.js";
import { builtinReaders, pickReader } from "../src/notes/create.js";
import type { AppDeps, CommandResult } from "../src/types.js";

function ok(data: unknown): CommandResult {
  return { code: 0, stdout: JSON.stringify({ ok: true, data }), stderr: "" };
}

function row(url: string) {
  return { title: "同一件事", url, pubdate_ts: Math.floor(Date.parse("2026-10-25T08:00:00+08:00") / 1000), desc: "摘要里提到本地模型" };
}

function scriptedDeps(root: string, recipes: AppDeps["recipes"] = [], limits?: AppDeps["limits"]) {
  let now = new Date("2026-10-25T10:00:00+08:00");
  let searches = 0;
  let customRows: (() => unknown[]) | null = null;
  let chatDelay = 0;
  let modelCalls = 0;
  let chatReply = JSON.stringify({
    intent: "discuss",
    answer: "文件夹里没有对应材料。",
    citations: [],
    keywords: [],
    platforms: [],
    url: "",
    materialPath: "",
  });
  const calls: string[] = [];
  const briefs: string[] = [];
  const deps: AppDeps = {
    dataDir: path.join(root, "data"),
    topicsRoot: path.join(root, "topics"),
    now: () => now,
    timeZone: "Asia/Shanghai",
    recipes,
    fetchImpl: fetch,
    limits,
    openFolder: async () => undefined,
    pickFolder: async () => null,
    model: {
      available: true,
      async complete(messages) {
        modelCalls += 1;
        if (chatDelay > 0) await new Promise((resolve) => setTimeout(resolve, chatDelay));
        const system = messages[0]?.content ?? "";
        const user = messages.at(-1)?.content ?? "";
        if (system.includes("预选")) return JSON.stringify({ keywords: ["本地模型"], platforms: ["alpha search"] });
        if (system.includes("分组")) {
          const parsed = JSON.parse(user) as { items: { id: string; title: string }[] };
          const grouped = new Map<string, string[]>();
          for (const item of parsed.items) {
            const list = grouped.get(item.title) ?? [];
            list.push(item.id);
            grouped.set(item.title, list);
          }
          return JSON.stringify({ groups: [...grouped.values()] });
        }
        if (system.includes("正文")) return JSON.stringify({ text: "可读正文" });
        if (system.includes("简报")) briefs.push(user);
        return chatReply;
      },
    },
    runner: {
      async run(argv) {
        calls.push(argv.join(" "));
        if (argv[1] === "--version") return { code: 0, stdout: "2.0.2", stderr: "" };
        if (argv[1] === "list") {
          return ok({
            commands: [
              { command: "alpha search", description: "Alpha", access: "read" },
              { command: "beta search", description: "Beta", access: "read" },
              { command: "beta post", description: "Post", access: "write" },
              { command: "gamma like", description: "Like", access: "read" },
            ],
          });
        }
        if (argv.includes("--help") && argv[1] === "alpha") {
          return ok({
            access: "read",
            browser: true,
            positionals: [{ name: "query", required: true, type: "str" }],
            columns: ["title", "url", "pubdate_ts", "desc"],
            command_options: [],
          });
        }
        if (argv.includes("--help") && argv[1] === "beta") {
          return ok({ access: "read", positionals: [{ name: "query", required: true }], columns: ["title"] });
        }
        if (argv[1] === "auth") {
          return ok([
            { site: "alpha", status: "logged-in" },
            { site: "beta", status: "not-logged-in" },
          ]);
        }
        if (argv[1] === "alpha" && argv[2] === "search") {
          if (argv[3] === "失败词") return { code: 1, stdout: JSON.stringify({ ok: false, error: { message: "这条没有结果" } }), stderr: "" };
          if (customRows) return ok(customRows());
          searches += 1;
          const urls = searches === 1 ? [row("https://alpha.test/1")] : [row("https://alpha.test/1"), row("https://alpha.test/2"), row("https://alpha.test/3")];
          return ok(urls);
        }
        if (argv[1] === "browser" && argv[2] === "get") return ok("演示页正文");
        if (argv[1] === "browser") return ok({ url: argv[3] ?? "" });
        return { code: 1, stdout: JSON.stringify({ ok: false, error: { message: "未知命令" } }), stderr: "" };
      },
    },
  };
  return {
    app: createApp(deps),
    deps,
    calls,
    setNow(value: Date) {
      now = value;
    },
    setChat(value: string) {
      chatReply = value;
    },
    setRows(value: () => unknown[]) {
      customRows = value;
    },
    setChatDelay(value: number) {
      chatDelay = value;
    },
    modelCalls() {
      return modelCalls;
    },
    briefs() {
      return briefs;
    },
  };
}

async function json<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

async function waitJob(app: ReturnType<typeof createApp>, id: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const body = await json<{ job: { state: string; error: string | null } | null }>(await app.request(`/api/topics/${id}/jobs/current`));
    if (body.job && body.job.state !== "running") return body.job;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error("任务没有结束");
}

describe("topic follow-up flow", () => {
  it("drops a platform option that is not in the catalog and keeps a real choice", () => {
    const commands = new Set(["alpha search", "beta search"]);
    const questions = acceptQuestions([
      { id: "aspect", prompt: "想看哪方面", options: ["世界排名", "交手记录", "其他"] },
      { id: "when", prompt: "看多久", options: ["过去 7 天", "过去 30 天"] },
      { id: "where", prompt: "用哪些平台", options: ["alpha search", "beta search", "nope search"] },
      { id: "broken", prompt: "坏掉的平台", options: ["alpha search", "nope search"] },
    ], commands);
    expect(questions.map((question) => question.id)).toEqual(["aspect", "when", "where"]);
    expect(questions[2]).toMatchObject({ options: ["alpha search", "beta search"], multiple: true });
    expect(JSON.stringify(questions)).not.toContain("nope search");
    expect(JSON.stringify(questions)).not.toContain("其他");
  });

  it("confirms a plan, collects, tracks, and keeps chat from collecting early", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "followup-"));
    const { app, calls, setNow, setChat } = scriptedDeps(root);
    const created = await json<{ topic: { id: string; folderPath: string; status: string } }>(await app.request("/api/topics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ utterance: "跟进本地模型" }),
    }));
    expect(created.topic.status).toBe("pending");
    const blocked = await app.request(`/api/topics/${created.topic.id}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "collect" }),
    });
    expect(blocked.status).toBe(409);
    expect(await readdir(path.join(created.topic.folderPath, "快照")).catch(() => [])).toEqual([]);

    const catalog = await json<{ commands: { command: string; selectable: boolean; disabledReason?: string; loginState: string }[] }>(await app.request("/api/catalog"));
    expect(catalog.commands.map((entry) => entry.command)).toContain("alpha search");
    expect(catalog.commands.some((entry) => entry.command === "beta post" || entry.command === "gamma like")).toBe(false);
    expect(catalog.commands.find((entry) => entry.command === "beta search")).toMatchObject({ selectable: false, disabledReason: "not-normalizable" });

    const confirmed = await app.request(`/api/topics/${created.topic.id}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keywords: ["本地模型"], platforms: ["alpha search"], folderPath: created.topic.folderPath }),
    });
    expect(confirmed.status).toBe(200);

    await app.request(`/api/topics/${created.topic.id}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "collect" }),
    });
    expect((await waitJob(app, created.topic.id)).state).toBe("succeeded");
    expect(calls.some((call) => call === "opencli alpha search 本地模型 -f json")).toBe(true);
    expect(calls.some((call) => call.startsWith("opencli alpha search") && call.includes("--limit"))).toBe(false);
    expect(calls.some((call) => call.includes("browser open"))).toBe(false);
    const first = await json<{ hasVerdicts: boolean; heading: string; events: { url: string }[] }>(await app.request(`/api/topics/${created.topic.id}/overview`));
    expect(first.hasVerdicts).toBe(false);
    expect(first.heading).toBe("调研底稿");
    expect(first.events[0]?.url).toBe("https://alpha.test/1");

    setNow(new Date("2026-10-25T12:00:00+08:00"));
    await app.request(`/api/topics/${created.topic.id}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "track" }),
    });
    expect((await waitJob(app, created.topic.id)).state).toBe("succeeded");
    const tracked = await json<{ mode: string; hotspots: { stage: string; url: string }[] }>(await app.request(`/api/topics/${created.topic.id}/overview`));
    expect(tracked.mode).toBe("hotspot");
    expect(tracked.hotspots[0]).toMatchObject({ stage: "高峰", url: "https://alpha.test/1" });
    const brief = await json<{ brief: { text: string } | null }>(await app.request(`/api/topics/${created.topic.id}/brief/latest`));
    expect(brief.brief?.text).toContain("https://alpha.test/1");
    expect(brief.brief?.text).toContain("摘要");

    const beforeChat = (await readdir(path.join(created.topic.folderPath, "快照"))).length;
    setChat(JSON.stringify({ intent: "collect", answer: "再调研一次。", citations: [{ type: "url", url: "https://outside.test" }], keywords: [], platforms: [], url: "", materialPath: "" }));
    const again = await json<{ pending: { type: string } | null; messages: { citations: unknown[] }[] }>(await app.request(`/api/topics/${created.topic.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "再调研一次" }),
    }));
    expect(again.pending?.type).toBe("research");
    expect(again.messages.at(-1)?.citations).toEqual([]);
    expect(await readdir(path.join(created.topic.folderPath, "快照"))).toHaveLength(beforeChat);
    await app.request(`/api/topics/${created.topic.id}/pending/confirm`, { method: "POST" });
    expect((await waitJob(app, created.topic.id)).state).toBe("succeeded");
    expect(await readdir(path.join(created.topic.folderPath, "快照"))).toHaveLength(beforeChat + 1);
    setChat(JSON.stringify({ intent: "track", answer: "请到调控面板确认。", citations: [{ type: "url", url: "https://outside.test" }], keywords: [], platforms: [], url: "", materialPath: "" }));
    const chat = await json<{ pending: { type: string } | null; messages: { citations: unknown[] }[] }>(await app.request(`/api/topics/${created.topic.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "现在追踪" }),
    }));
    expect(chat.pending?.type).toBe("track");
    expect(chat.messages.at(-1)?.citations).toEqual([]);
    await app.request(`/api/topics/${created.topic.id}/pending/confirm`, { method: "POST" });
    expect((await waitJob(app, created.topic.id)).state).toBe("succeeded");
    expect(await readdir(path.join(created.topic.folderPath, "快照"))).toHaveLength(beforeChat + 2);

    await writeFile(path.join(created.topic.folderPath, "素材", "clip.txt"), "素材里的一段话", "utf8");
    const tree = await json<{ entries: { path: string; children?: { path: string }[] }[] }>(await app.request(`/api/topics/${created.topic.id}/tree`));
    expect(tree.entries.map((entry) => entry.path)).toEqual(expect.arrayContaining(["主题.md", "简报", "快照", "笔记", "素材"]));
    expect(tree.entries.find((entry) => entry.path === "素材")?.children?.some((child) => child.path.endsWith("clip.txt"))).toBe(true);
    const notesBefore = await readdir(path.join(created.topic.folderPath, "笔记"));
    const empty = await app.request(`/api/topics/${created.topic.id}/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "" }),
    });
    expect(empty.status).toBe(400);
    expect(await readdir(path.join(created.topic.folderPath, "笔记"))).toEqual(notesBefore);
    const handwritten = await app.request(`/api/topics/${created.topic.id}/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "手写的一条笔记" }),
    });
    expect(handwritten.status).toBe(200);
    expect((await readdir(path.join(created.topic.folderPath, "笔记"))).length).toBe(notesBefore.length + 1);
    const noted = await app.request(`/api/topics/${created.topic.id}/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ materialPath: "素材/clip.txt" }),
    });
    expect(noted.status).toBe(200);
    const escaped = await app.request(`/api/topics/${created.topic.id}/file?path=${encodeURIComponent("../secret.txt")}`);
    expect(escaped.status).toBe(400);

    const reopened = createApp(scriptedDeps(root).deps);
    const cards = await json<{ topics: { id: string; utterance: string; hotspotCount: number }[] }>(await reopened.request("/api/topics"));
    expect(cards.topics.some((topic) => topic.id === created.topic.id && topic.utterance === "跟进本地模型" && topic.hotspotCount > 0)).toBe(true);
    const theme = await readFile(path.join(created.topic.folderPath, "主题.md"), "utf8");
    expect(theme).toContain("本地模型");
  });

  it("confirms a proposed plan from chat before research can start", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "followup-"));
    const { app, setChat } = scriptedDeps(root);
    const created = await json<{ topic: { id: string } }>(await app.request("/api/topics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ utterance: "先谈方案" }),
    }));
    setChat(JSON.stringify({ intent: "propose-plan", answer: "建议先搜这些。", citations: [], keywords: ["本地模型"], platforms: ["alpha search"], url: "", materialPath: "" }));
    const chat = await json<{ pending: { type: string; keywords: string[] } | null }>(await app.request(`/api/topics/${created.topic.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "就按这个方案" }),
    }));
    expect(chat.pending?.type).toBe("agree-plan");
    expect(chat.pending?.keywords).toEqual(["本地模型"]);
    const confirmed = await app.request(`/api/topics/${created.topic.id}/pending/confirm`, { method: "POST" });
    expect(confirmed.status).toBe(200);
    const topic = await json<{ topic: { status: string; keywords: string[] } }>(await app.request(`/api/topics/${created.topic.id}`));
    expect(topic.topic.status).toBe("confirmed");
    expect(topic.topic.keywords).toEqual(["本地模型"]);
    const blocked = await app.request(`/api/topics/${created.topic.id}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "track" }),
    });
    expect(blocked.status).toBe(409);
  });

  it("does not offer a collect confirmation before the plan is confirmed", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "followup-"));
    const { app, setChat } = scriptedDeps(root);
    const created = await json<{ topic: { id: string } }>(await app.request("/api/topics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ utterance: "另一个主题" }),
    }));
    setChat(JSON.stringify({ intent: "collect", answer: "开始吧", citations: [], keywords: [], platforms: [], url: "", materialPath: "" }));
    const chat = await json<{ pending: unknown; messages: { content: string }[] }>(await app.request(`/api/topics/${created.topic.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "现在收集" }),
    }));
    expect(chat.pending).toBeNull();
    expect(chat.messages.at(-1)?.content).toContain("请先同意调研方案");
    await expect(readFile(path.join(root, "data", "topics", created.topic.id, "pending-action.json"), "utf8")).rejects.toThrow();
  });

  it("runs one morning catch-up for the latest due date", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "followup-"));
    const { app, setNow } = scriptedDeps(root);
    const created = await json<{ topic: { id: string; folderPath: string } }>(await app.request("/api/topics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ utterance: "晨报主题" }),
    }));
    await app.request(`/api/topics/${created.topic.id}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keywords: ["本地模型"], platforms: ["alpha search"], folderPath: created.topic.folderPath }),
    });
    await app.request(`/api/topics/${created.topic.id}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "collect" }),
    });
    await waitJob(app, created.topic.id);
    await app.request(`/api/topics/${created.topic.id}/plan`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ morningReport: { enabled: true, time: "08:00" } }),
    });
    setNow(new Date("2026-10-28T09:00:00+08:00"));
    expect((await app.request("/api/scheduler/tick", { method: "POST" })).status).toBe(200);
    expect((await app.request("/api/scheduler/tick", { method: "POST" })).status).toBe(200);
    const names = (await readdir(path.join(created.topic.folderPath, "快照"))).filter((name) => name.endsWith(".json"));
    const snapshots = await Promise.all(names.map(async (name) => JSON.parse(await readFile(path.join(created.topic.folderPath, "快照", name), "utf8")) as { trigger: string; nominalDate: string | null }));
    const mornings = snapshots.filter((snapshot) => snapshot.trigger === "morning");
    expect(mornings.map((snapshot) => snapshot.nominalDate)).toEqual(["2026-10-28"]);
  });

  it("uses the browser session only for a recipe without a search command", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "followup-"));
    const { app, calls } = scriptedDeps(root, [{
      id: "demo",
      site: "demo",
      label: "演示页",
      searchUrl: (keyword) => `https://demo.test/search?q=${encodeURIComponent(keyword)}`,
      normalize: (text) => [{ title: text, url: "https://demo.test/item", platform: "browser:demo", publishedAt: "2026-10-25T10:00:00.000Z", summary: text }],
    }]);
    const created = await json<{ topic: { id: string; folderPath: string } }>(await app.request("/api/topics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ utterance: "浏览器配方" }),
    }));
    await app.request(`/api/topics/${created.topic.id}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keywords: ["本地模型"], platforms: ["browser:demo"], folderPath: created.topic.folderPath }),
    });
    await app.request(`/api/topics/${created.topic.id}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "collect" }),
    });
    expect((await waitJob(app, created.topic.id)).state).toBe("succeeded");
    expect(calls.some((call) => call.startsWith("opencli browser open https://demo.test/search"))).toBe(true);
    expect(calls.some((call) => call.includes("browser close"))).toBe(true);
    const readers = [{ id: "custom", supports: () => true, read: async () => ({ text: "自定义" }) }, ...builtinReaders()];
    expect(pickReader(readers, { url: "https://example.test" })?.id).toBe("custom");
  });

  it("lists topics and deletes one without touching the others", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "followup-"));
    const { app } = scriptedDeps(root);
    const kept = await json<{ topic: { id: string; folderPath: string } }>(await app.request("/api/topics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ utterance: "留下的主题" }),
    }));
    const dropped = await json<{ topic: { id: string; folderPath: string } }>(await app.request("/api/topics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ utterance: "要删的主题" }),
    }));
    const removed = await app.request(`/api/topics/${dropped.topic.id}`, { method: "DELETE" });
    expect(removed.status).toBe(200);
    expect((await json<{ folderKept: boolean }>(removed)).folderKept).toBe(false);
    await expect(readdir(dropped.topic.folderPath)).rejects.toThrow();
    const cards = await json<{ topics: { id: string; utterance: string }[] }>(await app.request("/api/topics"));
    expect(cards.topics.map((topic) => topic.id)).toEqual([kept.topic.id]);
    expect(await readdir(kept.topic.folderPath)).toEqual(expect.arrayContaining(["主题.md"]));
    expect((await app.request(`/api/topics/${dropped.topic.id}`, { method: "DELETE" })).status).toBe(404);
  });

  it("confirms a note before writing and says when the intent is unknown", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "followup-"));
    const fetched: string[] = [];
    const { app, deps, setChat } = scriptedDeps(root);
    deps.fetchImpl = async (input) => {
      fetched.push(String(input));
      return new Response("<p>正文</p>", { status: 200, headers: { "content-type": "text/html" } });
    };
    const created = await json<{ topic: { id: string; folderPath: string } }>(await app.request("/api/topics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ utterance: "整理材料" }),
    }));
    await app.request(`/api/topics/${created.topic.id}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keywords: ["本地模型"], platforms: ["alpha search"], folderPath: created.topic.folderPath }),
    });
    await writeFile(path.join(created.topic.folderPath, "素材", "clip.txt"), "素材里的一段话", "utf8");
    setChat(JSON.stringify({ intent: "organize", answer: "已经写好了。", citations: [], keywords: [], platforms: [], url: "", materialPath: "素材/clip.txt" }));
    const asked = await json<{ pending: { type: string; note?: { preview: string } } | null; messages: { content: string }[] }>(await app.request(`/api/topics/${created.topic.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "把素材整理成笔记" }),
    }));
    expect(asked.pending?.type).toBe("organize");
    expect(asked.pending?.note?.preview).toContain("素材/clip.txt");
    expect(asked.messages.at(-1)?.content).toContain("确认后才会写入");
    expect(await readdir(path.join(created.topic.folderPath, "笔记"))).toEqual([]);
    expect(fetched).toEqual([]);
    const confirmed = await app.request(`/api/topics/${created.topic.id}/pending/confirm`, { method: "POST" });
    expect(confirmed.status).toBe(200);
    expect(await readdir(path.join(created.topic.folderPath, "笔记"))).toHaveLength(1);
    expect(fetched).toEqual([]);

    setChat(JSON.stringify({ intent: "organize", answer: "抓这个。", citations: [], keywords: [], platforms: [], url: "https://evil.example/a", materialPath: "" }));
    const blocked = await json<{ pending: { type: string } | null; messages: { content: string }[] }>(await app.request(`/api/topics/${created.topic.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "整理这个链接" }),
    }));
    expect(blocked.pending).toBeNull();
    expect(blocked.messages.at(-1)?.content).toContain("不会抓取");
    expect(fetched).toEqual([]);
    expect(await readdir(path.join(created.topic.folderPath, "笔记"))).toHaveLength(1);

    setChat(JSON.stringify({ intent: "propose-plan", answer: "先改方案。", citations: [], keywords: ["本地模型"], platforms: ["alpha search"], url: "", materialPath: "" }));
    await app.request(`/api/topics/${created.topic.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "换个方案" }),
    });
    setChat(JSON.stringify({ intent: "frobnicate", answer: "随便。", citations: [], keywords: [], platforms: [], url: "", materialPath: "" }));
    const unknown = await json<{ pending: { type: string; keywords: string[] } | null; messages: { content: string }[] }>(await app.request(`/api/topics/${created.topic.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "听不懂的一句" }),
    }));
    expect(unknown.messages.at(-1)?.content).toBe("没听懂，请换一种说法。");
    expect(unknown.pending?.type).toBe("agree-plan");

    setChat(JSON.stringify({ intent: "propose-plan", answer: "换成新的。", citations: [], keywords: ["新词"], platforms: ["alpha search"], url: "", materialPath: "" }));
    const replaced = await json<{ pending: { keywords: string[] } | null; messages: { content: string }[] }>(await app.request(`/api/topics/${created.topic.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "再换一次" }),
    }));
    expect(replaced.messages.at(-1)?.content).toContain("上一条未确认动作将作废");
    expect(replaced.pending?.keywords).toEqual(["新词"]);
  });

  it("stops a collection at the step budget and does not rerun a morning that died before the snapshot", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "followup-"));
    const { app, calls } = scriptedDeps(root, [], { jobSteps: 0 });
    const created = await json<{ topic: { id: string; folderPath: string } }>(await app.request("/api/topics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ utterance: "预算" }),
    }));
    await app.request(`/api/topics/${created.topic.id}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keywords: ["本地模型"], platforms: ["alpha search"], folderPath: created.topic.folderPath }),
    });
    await app.request(`/api/topics/${created.topic.id}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "research" }),
    });
    const stopped = await waitJob(app, created.topic.id);
    expect(stopped.state).toBe("failed");
    expect(stopped.error).toBe("已停在采集·超过步数上限");
    expect(calls.some((call) => call.includes("alpha search ") && !call.includes("--help"))).toBe(false);
    const overview = await json<{ halted: string | null; empty: boolean }>(await app.request(`/api/topics/${created.topic.id}/overview`));
    expect(overview.halted).toBe("已停在采集·超过步数上限");
    expect(overview.empty).toBe(true);

    const { app: kept } = scriptedDeps(root);
    const made = await json<{ topic: { id: string; folderPath: string } }>(await kept.request("/api/topics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ utterance: "晨报中断" }),
    }));
    await kept.request(`/api/topics/${made.topic.id}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keywords: ["本地模型"], platforms: ["alpha search"], folderPath: made.topic.folderPath }),
    });
    await kept.request(`/api/topics/${made.topic.id}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "collect" }),
    });
    expect((await waitJob(kept, made.topic.id)).state).toBe("succeeded");
    await waitStoredJob(root, made.topic.id);
    const trace = await readFile(path.join(root, "data", "topics", made.topic.id, "trace.jsonl"), "utf8");
    expect(trace).toContain("\"action\":\"search\"");
    expect(trace).not.toContain("OPENAI_API_KEY");
    await kept.request(`/api/topics/${made.topic.id}/plan`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ morningReport: { enabled: true, time: "08:00" } }),
    });
    await writeFile(path.join(root, "data", "topics", made.topic.id, "job.json"), JSON.stringify({
      id: "crashed",
      topicId: made.topic.id,
      kind: "morning",
      state: "running",
      startedAt: "2026-10-28T00:30:00.000Z",
      finishedAt: null,
      snapshotId: null,
      error: null,
      steps: [],
      phase: "聚类",
      nominalDate: "2026-10-28",
    }));
    const restarted = scriptedDeps(root);
    restarted.setNow(new Date("2026-10-28T09:00:00+08:00"));
    expect((await restarted.app.request("/api/scheduler/tick", { method: "POST" })).status).toBe(200);
    const job = await json<{ job: { state: string; error: string | null; phase: string } }>(await restarted.app.request(`/api/topics/${made.topic.id}/jobs/current`));
    expect(job.job).toMatchObject({ state: "incomplete", phase: "聚类", error: "已停在聚类·上次未完成，没有自动重跑" });
    const names = (await readdir(path.join(made.topic.folderPath, "快照"))).filter((name) => name.endsWith(".json"));
    const snapshots = await Promise.all(names.map(async (name) => JSON.parse(await readFile(path.join(made.topic.folderPath, "快照", name), "utf8")) as { trigger: string }));
    expect(snapshots.filter((snapshot) => snapshot.trigger === "morning")).toEqual([]);
    const cards = await json<{ topics: { id: string; jobState: string | null }[] }>(await restarted.app.request("/api/topics"));
    expect(cards.topics.find((topic) => topic.id === made.topic.id)?.jobState).toBe("incomplete");
    await restarted.app.request(`/api/topics/${made.topic.id}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "research" }),
    });
    expect((await waitJob(restarted.app, made.topic.id)).state).toBe("succeeded");
    expect((await restarted.app.request("/api/scheduler/tick", { method: "POST" })).status).toBe(200);
    const after = (await readdir(path.join(made.topic.folderPath, "快照"))).filter((name) => name.endsWith(".json"));
    const mornings = await Promise.all(after.map(async (name) => JSON.parse(await readFile(path.join(made.topic.folderPath, "快照", name), "utf8")) as { trigger: string }));
    expect(mornings.filter((snapshot) => snapshot.trigger === "morning")).toEqual([]);
  });

  it("keeps rows from the keywords that succeeded when one keyword fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "followup-"));
    const { app, calls } = scriptedDeps(root);
    const created = await json<{ topic: { id: string; folderPath: string } }>(await app.request("/api/topics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ utterance: "单词失败" }),
    }));
    await app.request(`/api/topics/${created.topic.id}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keywords: ["本地模型", "失败词"], platforms: ["alpha search"], folderPath: created.topic.folderPath }),
    });
    await app.request(`/api/topics/${created.topic.id}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "research" }),
    });
    const job = await waitJob(app, created.topic.id);
    expect(job.state).toBe("succeeded");
    expect(calls.filter((call) => call.includes("alpha search ") && !call.includes("--help"))).toEqual([
      "opencli alpha search 本地模型 -f json",
      "opencli alpha search 失败词 -f json",
    ]);
    const names = (await readdir(path.join(created.topic.folderPath, "快照"))).filter((name) => name.endsWith(".json"));
    const snapshot = JSON.parse(await readFile(path.join(created.topic.folderPath, "快照", names[0] ?? ""), "utf8")) as { items: { url: string }[] };
    expect(snapshot.items.some((item) => item.url === "https://alpha.test/1")).toBe(true);
  });

  it("finishes the snapshot when the step budget is spent on phases", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "followup-"));
    const { app, calls } = scriptedDeps(root, [], { jobSteps: 1 });
    const created = await json<{ topic: { id: string; folderPath: string } }>(await app.request("/api/topics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ utterance: "阶段步数" }),
    }));
    await app.request(`/api/topics/${created.topic.id}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keywords: ["本地模型"], platforms: ["alpha search"], folderPath: created.topic.folderPath }),
    });
    await app.request(`/api/topics/${created.topic.id}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "research" }),
    });
    const job = await waitJob(app, created.topic.id);
    expect(calls.some((call) => call.includes("alpha search 本地模型") && !call.includes("--help"))).toBe(true);
    expect(job.error).toBe("已停在清洗去重·超过步数上限");
    const overview = await json<{ halted: string | null; empty: boolean }>(await app.request(`/api/topics/${created.topic.id}/overview`));
    expect(overview.halted).toBe("已停在清洗去重·超过步数上限");
    expect(overview.empty).toBe(false);
  });

  it("searches the confirmed query sentences and hands the assignment to the brief", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "followup-"));
    const { app, calls, setChat, briefs } = scriptedDeps(root);
    const created = await json<{ topic: { id: string; folderPath: string } }>(await app.request("/api/topics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ utterance: "任务单" }),
    }));
    await app.request(`/api/topics/${created.topic.id}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keywords: ["本地模型"], platforms: ["alpha search"], folderPath: created.topic.folderPath }),
    });
    setChat(JSON.stringify({
      intent: "research",
      answer: "这次搜原句。",
      citations: [],
      keywords: [],
      platforms: [],
      queries: ["原句检索", "本地模型 本地模型"],
      assignment: "看清退赛原因",
      url: "",
      materialPath: "",
    }));
    const chat = await json<{ pending: { type: string; queries?: string[]; assignment?: string } | null }>(await app.request(`/api/topics/${created.topic.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "开始调研" }),
    }));
    expect(chat.pending?.type).toBe("research");
    expect(chat.pending?.queries).toEqual(["原句检索", "本地模型 本地模型"]);
    expect(chat.pending?.assignment).toBe("看清退赛原因");
    await app.request(`/api/topics/${created.topic.id}/pending/confirm`, { method: "POST" });
    const job = await waitJob(app, created.topic.id);
    expect(job.state).toBe("succeeded");
    expect(calls.filter((call) => call.includes("alpha search ") && !call.includes("--help"))).toEqual([
      "opencli alpha search 原句检索 -f json",
      "opencli alpha search 本地模型 本地模型 -f json",
    ]);
    expect(briefs().some((body) => body.includes("看清退赛原因"))).toBe(true);
  });

  it("stores discuss choices and searches a facet with its subject after the plan is confirmed", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "followup-"));
    const { app, calls, setChat } = scriptedDeps(root);
    const created = await json<{ topic: { id: string; folderPath: string } }>(await app.request("/api/topics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ utterance: "樊振东" }),
    }));
    setChat(JSON.stringify({
      intent: "discuss",
      answer: "先选一下。",
      citations: [],
      keywords: [],
      platforms: [],
      questions: [
        { id: "aspect", prompt: "想看哪方面", options: ["世界排名", "交手记录"] },
        { id: "where", prompt: "用哪些平台", options: ["alpha search", "nope search"] },
      ],
      url: "",
      materialPath: "",
    }));
    await app.request(`/api/topics/${created.topic.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "我想知道排名" }),
    });
    const chat = await json<{ messages: { questions?: { options: string[] }[] }[] }>(await app.request(`/api/topics/${created.topic.id}/chat`));
    const saved = chat.messages.at(-1)?.questions ?? [];
    expect(saved).toHaveLength(1);
    expect(saved[0]?.options).toEqual(["世界排名", "交手记录"]);
    await app.request(`/api/topics/${created.topic.id}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        keywords: ["樊振东", "世界排名", "交手记录"],
        platforms: ["alpha search"],
        folderPath: created.topic.folderPath,
        card: { mustInclude: ["樊振东"] },
      }),
    });
    await app.request(`/api/topics/${created.topic.id}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "research" }),
    });
    await waitJob(app, created.topic.id);
    const searches = calls.filter((call) => call.includes("alpha search ") && !call.includes("--help"));
    expect(searches).toContain("opencli alpha search 世界排名 樊振东 -f json");
    expect(searches).toContain("opencli alpha search 交手记录 樊振东 -f json");
    expect(searches).not.toContain("opencli alpha search 樊振东 -f json");
    expect(searches).not.toContain("opencli alpha search 世界排名 -f json");
  });

  it("stops a chat when the reply exceeds the time limit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "followup-"));
    const { app, setChatDelay } = scriptedDeps(root, [], { chatWallMs: 30 });
    setChatDelay(200);
    const created = await json<{ topic: { id: string } }>(await app.request("/api/topics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ utterance: "对话超时" }),
    }));
    const chat = await json<{ pending: unknown; messages: { content: string }[] }>(await app.request(`/api/topics/${created.topic.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "在吗" }),
    }));
    expect(chat.pending).toBeNull();
    expect(chat.messages.at(-1)?.content).toBe("已停在对话·超过时间上限");
  });

  it("stops a chat when the prompt exceeds the content budget", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "followup-"));
    const { app, modelCalls } = scriptedDeps(root, [], { chatTokens: 1 });
    const created = await json<{ topic: { id: string } }>(await app.request("/api/topics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ utterance: "对话太长" }),
    }));
    const chat = await json<{ messages: { content: string }[] }>(await app.request(`/api/topics/${created.topic.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "在吗" }),
    }));
    expect(chat.messages.at(-1)?.content).toBe("已停在对话·超过内容上限");
    expect(modelCalls()).toBe(0);
  });

  it("drops undated and out-of-window rows from a research brief but keeps them on the snapshot", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "followup-"));
    const { app, setRows, setChat } = scriptedDeps(root);
    const keptTime = Math.floor(Date.parse("2026-10-25T08:00:00+08:00") / 1000);
    const oldTime = Math.floor(Date.parse("2026-10-01T08:00:00+08:00") / 1000);
    setRows(() => [
      { title: "窗内的本地模型", url: "https://alpha.test/kept", pubdate_ts: keptTime, desc: "摘要提到本地模型" },
      { title: "太早的本地模型", url: "https://alpha.test/old", pubdate_ts: oldTime, desc: "摘要提到本地模型" },
      { title: "没有日期的本地模型", url: "https://alpha.test/nodate", desc: "摘要提到本地模型" },
      { title: "跑题报道", url: "https://alpha.test/off", pubdate_ts: keptTime, desc: "和主题无关" },
    ]);
    const created = await json<{ topic: { id: string; folderPath: string } }>(await app.request("/api/topics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ utterance: "筛选调研" }),
    }));
    await app.request(`/api/topics/${created.topic.id}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keywords: ["本地模型"], platforms: ["alpha search"], folderPath: created.topic.folderPath }),
    });
    await app.request(`/api/topics/${created.topic.id}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "research" }),
    });
    expect((await waitJob(app, created.topic.id)).state).toBe("succeeded");
    const view = await json<{ digests: { title: string }[]; digestLead: string }>(await app.request(`/api/topics/${created.topic.id}/overview`));
    expect(view.digests.map((item) => item.title)).toEqual(["窗内的本地模型"]);
    expect(view.digestLead).toBe("过去 7 天留下 1 条。丢掉 3 条：过了时间窗 1，没有日期 1，和主题对不上 1。");
    const brief = await json<{ brief: { text: string } | null }>(await app.request(`/api/topics/${created.topic.id}/brief/latest`));
    expect(brief.brief?.text).toContain("窗内的本地模型");
    expect(brief.brief?.text).toContain(view.digestLead);
    expect(brief.brief?.text).not.toContain("太早的本地模型");
    expect(brief.brief?.text).not.toContain("没有日期的本地模型");
    expect(brief.brief?.text).not.toContain("跑题报道");
    const names = (await readdir(path.join(created.topic.folderPath, "快照"))).filter((name) => name.endsWith(".json"));
    const snapshot = JSON.parse(await readFile(path.join(created.topic.folderPath, "快照", names[0] ?? ""), "utf8")) as {
      platforms: { status: string }[];
      items: { url: string; drop?: string }[];
      events: { title: string }[];
      digests: { title: string }[];
    };
    expect(snapshot.platforms[0]?.status).toBe("success");
    expect(snapshot.items).toHaveLength(4);
    expect(snapshot.items.find((item) => item.url.endsWith("/kept"))?.drop).toBeUndefined();
    expect(snapshot.items.find((item) => item.url.endsWith("/old"))?.drop).toBe("过了时间窗");
    expect(snapshot.items.find((item) => item.url.endsWith("/nodate"))?.drop).toBe("没有日期");
    expect(snapshot.items.find((item) => item.url.endsWith("/off"))?.drop).toBe("和主题对不上");
    expect(snapshot.events.map((event) => event.title)).toEqual(["窗内的本地模型"]);
    expect(snapshot.digests.map((item) => item.title)).toEqual(["窗内的本地模型"]);

    setChat(JSON.stringify({
      intent: "propose-plan",
      answer: "改成一天。",
      citations: [],
      keywords: ["本地模型"],
      platforms: ["alpha search"],
      timeWindow: "1d",
      url: "",
      materialPath: "",
    }));
    await app.request(`/api/topics/${created.topic.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "改成过去一天" }),
    });
    const day = await json<{ topic: { timeWindow: number } }>(await app.request(`/api/topics/${created.topic.id}/pending/confirm`, { method: "POST" }));
    expect(day.topic.timeWindow).toBe(1);
    setChat(JSON.stringify({
      intent: "propose-plan",
      answer: "改成 14 天。",
      citations: [],
      keywords: ["本地模型"],
      platforms: ["alpha search"],
      timeWindow: 14,
      url: "",
      materialPath: "",
    }));
    await app.request(`/api/topics/${created.topic.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "改成过去十四天" }),
    });
    const fortnight = await json<{ topic: { timeWindow: number } }>(await app.request(`/api/topics/${created.topic.id}/pending/confirm`, { method: "POST" }));
    expect(fortnight.topic.timeWindow).toBe(14);

    const themePath = path.join(created.topic.folderPath, "主题.md");
    const stored = await readFile(themePath, "utf8");
    expect(stored).toContain("timeWindow: 14");
    await writeFile(themePath, stored.replace("timeWindow: 14", "timeWindow: 7d"), "utf8");
    const legacy = await json<{ topic: { timeWindow: number } }>(await app.request(`/api/topics/${created.topic.id}`));
    expect(legacy.topic.timeWindow).toBe(7);
    const again = await readFile(themePath, "utf8");
    await writeFile(themePath, again.replace("timeWindow: 7d", "timeWindow: 100"), "utf8");
    const clamped = await json<{ topic: { timeWindow: number } }>(await app.request(`/api/topics/${created.topic.id}`));
    expect(clamped.topic.timeWindow).toBe(90);
  });

  it("keeps a plain title when Firecrawl body matches and drops a headline the body does not support", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "followup-"));
    const previous = process.env.FIRECRAWL_API_KEY;
    process.env.FIRECRAWL_API_KEY = "fc-test-key";
    const opened: string[] = [];
    try {
      const { app, deps, setRows } = scriptedDeps(root);
      deps.fetchImpl = async (input, init) => {
        const target = String(input);
        if (!target.includes("api.firecrawl.dev")) return new Response("", { status: 500 });
        const request = JSON.parse(String(init?.body ?? "{}")) as { url?: string };
        opened.push(request.url ?? "");
        const markdown = request.url?.endsWith("/headline") ? "全文是天气预报" : "这篇在讲本地模型怎么部署";
        return new Response(JSON.stringify({ success: true, data: { markdown } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };
      const keptTime = Math.floor(Date.parse("2026-10-25T08:00:00+08:00") / 1000);
      const oldTime = Math.floor(Date.parse("2026-10-01T08:00:00+08:00") / 1000);
      setRows(() => [
        { title: "今天的消息", url: "https://alpha.test/body", pubdate_ts: keptTime, desc: "短讯" },
        { title: "本地模型震惊", url: "https://alpha.test/headline", pubdate_ts: keptTime, desc: "本地模型" },
        { title: "太早的本地模型", url: "https://alpha.test/old", pubdate_ts: oldTime, desc: "本地模型" },
      ]);
      const created = await json<{ topic: { id: string; folderPath: string } }>(await app.request("/api/topics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ utterance: "正文筛选" }),
      }));
      await app.request(`/api/topics/${created.topic.id}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keywords: ["本地模型"], platforms: ["alpha search"], folderPath: created.topic.folderPath }),
      });
      await app.request(`/api/topics/${created.topic.id}/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "research" }),
      });
      expect((await waitJob(app, created.topic.id)).state).toBe("succeeded");
      const view = await json<{ digests: { title: string }[]; digestLead: string }>(await app.request(`/api/topics/${created.topic.id}/overview`));
      expect(view.digests.map((item) => item.title)).toEqual(["今天的消息"]);
      expect(view.digestLead).toContain("过去 7 天留下 1 条");
      expect(view.digestLead).toContain("和主题对不上 1");
      expect(view.digestLead).toContain("过了时间窗 1");
      const names = (await readdir(path.join(created.topic.folderPath, "快照"))).filter((name) => name.endsWith(".json"));
      const snapshot = JSON.parse(await readFile(path.join(created.topic.folderPath, "快照", names[0] ?? ""), "utf8")) as {
        items: { url: string; drop?: string }[];
      };
      expect(opened).toEqual(["https://alpha.test/body", "https://alpha.test/headline"]);
      expect(snapshot.items.find((item) => item.url.endsWith("/body"))?.drop).toBeUndefined();
      expect(snapshot.items.find((item) => item.url.endsWith("/headline"))?.drop).toBe("和主题对不上");
      expect(snapshot.items.find((item) => item.url.endsWith("/old"))?.drop).toBe("过了时间窗");
      expect(JSON.stringify(snapshot)).not.toContain("fc-test-key");
    } finally {
      if (previous === undefined) delete process.env.FIRECRAWL_API_KEY;
      else process.env.FIRECRAWL_API_KEY = previous;
    }
  });
});

async function waitStoredJob(root: string, id: string) {
  const file = path.join(root, "data", "topics", id, "job.json");
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const job = JSON.parse(await readFile(file, "utf8")) as { state: string };
      if (job.state !== "running") return job;
    } catch {
      // The file is written after the task starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error("任务没有落盘");
}
