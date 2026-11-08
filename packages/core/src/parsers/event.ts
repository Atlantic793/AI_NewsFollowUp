import * as cheerio from "cheerio";
import { loadHtml, textOf } from "../parse/html.js";
import { absoluteUrl, excerptOf, firstSentence, isoDate, stripMd } from "../parse/text.js";
import type { EventDraft } from "../rows.js";

function release(input: Omit<EventDraft, "type"> & Partial<Pick<EventDraft, "type">>): EventDraft {
  return { type: "release", ...input };
}

/** 读一串 Markdown 列表项，缩进的续行接到上一项后面。 */
function bulletsOf(lines: readonly string[]): string[] {
  const items: string[] = [];
  for (const raw of lines) {
    const bullet = raw.match(/^\s*[*-]\s+(.*)$/);
    if (bullet) {
      items.push(bullet[1] ?? "");
      continue;
    }
    if (raw.trim() && items.length > 0 && /^\s{2,}/.test(raw)) items[items.length - 1] += ` ${raw.trim()}`;
  }
  return items;
}

// ---------- OpenAI API 更新日志：## 月份 → ### 日期 → 标签行 → 正文 ----------

export function openAiChangelog(markdown: string, page: string): EventDraft[] {
  const drafts: EventDraft[] = [];
  let year: number | undefined;
  let current: { date: string; tags: string; body: string[]; raw: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const text = current.body.join(" ");
    drafts.push(release({
      title: firstSentence(text),
      date: current.date,
      detail: [current.tags, stripMd(text)].filter(Boolean).join(" — "),
      url: page,
      excerpt: excerptOf(current.raw.join("\n")),
    }));
    current = null;
  };
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    const month = line.match(/^##\s+([A-Za-z]+),?\s+(\d{4})$/);
    if (month) {
      flush();
      year = Number(month[2]);
      continue;
    }
    const day = line.match(/^###\s+(.+)$/);
    if (day) {
      flush();
      current = { date: isoDate(day[1] ?? "", year), tags: "", body: [], raw: [line] };
      continue;
    }
    if (!current || !line) continue;
    current.raw.push(line);
    if (!current.tags && current.body.length === 0 && /^(Feature|Update|Fix|Deprecation|Change|Announcement|Launch|Release|Removal)\b/.test(line)) {
      current.tags = line;
      continue;
    }
    current.body.push(line);
  }
  flush();
  return drafts;
}

// ---------- RSS ----------

export function rssItems(xml: string): EventDraft[] {
  const $ = cheerio.load(xml, { xml: true });
  const drafts: EventDraft[] = [];
  $("item").each((_, item) => {
    const node = $(item);
    const title = node.children("title").text().trim();
    const link = node.children("link").text().trim();
    const date = node.children("pubDate").text().trim();
    const description = cheerio.load(node.children("description").text()).text().replace(/\s+/g, " ").trim();
    const category = node.children("category").map((__, element) => $(element).text().trim()).get().join(" / ");
    drafts.push({
      type: "news",
      title,
      date,
      detail: [category, description].filter(Boolean).join(" — "),
      url: link,
      excerpt: excerptOf(`<title>${title}</title>`, `<link>${link}</link>`, `<pubDate>${date}</pubDate>`, description ? `<description>${description}</description>` : ""),
    });
  });
  return drafts;
}

// ---------- Statuspage：JSON 接口（OpenAI）和 HTML 页面（Claude） ----------

interface StatusJson {
  components?: Array<{ id?: string; name?: string; status?: string; updated_at?: string; position?: number; group?: boolean; group_id?: string | null }>;
  incidents?: Array<{ name?: string; status?: string; impact?: string; created_at?: string; shortlink?: string }>;
}

export function statuspageJson(json: string, page: string): EventDraft[] {
  const data = JSON.parse(json) as StatusJson;
  const drafts: EventDraft[] = [];
  const groups = new Map((data.components ?? []).filter((item) => item.group).map((item) => [item.id ?? "", item.name ?? ""]));
  for (const component of data.components ?? []) {
    if (component.group) continue;
    const group = groups.get(component.group_id ?? "") ?? "";
    drafts.push({
      type: "status",
      title: [group, component.name ?? ""].filter(Boolean).join(" · "),
      date: component.updated_at ?? "",
      detail: component.status ?? "",
      url: component.id ? `${page}#${component.id}` : page,
      excerpt: JSON.stringify({ id: component.id, position: component.position, group: group || undefined, name: component.name, status: component.status, updated_at: component.updated_at }),
    });
  }
  for (const incident of data.incidents ?? []) {
    drafts.push({
      type: "incident",
      title: incident.name ?? "",
      date: incident.created_at ?? "",
      detail: [incident.status ?? "", incident.impact ? `impact ${incident.impact}` : ""].filter(Boolean).join(" · "),
      url: incident.shortlink || page,
      excerpt: JSON.stringify({ name: incident.name, status: incident.status, impact: incident.impact, created_at: incident.created_at }),
    });
  }
  return drafts;
}

export function statuspageHtml(html: string, page: string): EventDraft[] {
  const $ = loadHtml(html);
  const drafts: EventDraft[] = [];
  $(".component-inner-container").each((_, element) => {
    const name = textOf($, $(element).find(".name").first());
    const status = textOf($, $(element).find(".component-status").first());
    drafts.push({ type: "status", title: name, date: "", detail: status, url: page, excerpt: `${name} — ${status}` });
  });
  $(".unresolved-incident").each((_, element) => {
    const title = textOf($, $(element).find(".incident-title").first());
    const update = textOf($, $(element).find(".update").first()).replace(/\n/g, " ");
    const href = $(element).find(".incident-title a").attr("href") ?? "";
    drafts.push({ type: "incident", title, date: update, detail: update, url: href ? absoluteUrl(page, href) : page, excerpt: excerptOf(title, update) });
  });
  $(".status-day").slice(0, 7).each((_, day) => {
    const date = textOf($, $(day).find(".date").first());
    $(day).find(".incident-container").each((__, incident) => {
      const link = $(incident).find(".incident-title a").first();
      const update = textOf($, $(incident).find(".update").first()).replace(/\n/g, " ");
      drafts.push({
        type: "incident",
        title: textOf($, link),
        date,
        detail: update,
        url: absoluteUrl(page, link.attr("href") ?? ""),
        excerpt: excerptOf(date, textOf($, link), update),
      });
    });
  });
  return drafts;
}

// ---------- Claude Platform 发布说明：### 日期 → 每条列表项一条 ----------

export function claudeReleaseNotes(markdown: string, page: string): EventDraft[] {
  return datedBullets(markdown, /^###\s+([A-Z][a-z]+ \d{1,2}, \d{4})\s*$/, page);
}

// ---------- Gemini API 发布说明：## 日期 {% id %} → **标题**：正文 ----------

export function geminiChangelog(markdown: string, page: string): EventDraft[] {
  return datedBullets(markdown, /^##\s+([A-Z][a-z]+ \d{1,2}, \d{4})\b/, page).map((item) => {
    const bold = item.excerpt.match(/\*\*([^*]+)\*\*\s*:?/);
    if (!bold) return item;
    return { ...item, title: stripMd(bold[1] ?? "").replace(/:$/, "") };
  });
}

function datedBullets(markdown: string, dateLine: RegExp, page: string): EventDraft[] {
  const lines = markdown.split(/\r?\n/);
  const drafts: EventDraft[] = [];
  let date = "";
  let block: string[] = [];
  const flush = () => {
    for (const bullet of bulletsOf(block)) {
      drafts.push(release({ title: firstSentence(bullet), date, detail: stripMd(bullet), url: page, excerpt: excerptOf(date, `* ${bullet}`) }));
    }
    block = [];
  };
  for (const line of lines) {
    const found = line.trim().match(dateLine);
    if (found) {
      flush();
      date = found[1] ?? "";
      continue;
    }
    if (/^#{1,3}\s/.test(line.trim())) {
      flush();
      date = "";
      continue;
    }
    if (date) block.push(line);
  }
  flush();
  return drafts;
}

// ---------- Claude Code 更新日志：**版本** → 日期 → 分组列表 ----------

export function claudeCodeChangelog(markdown: string, page: string): EventDraft[] {
  const lines = markdown.split(/\r?\n/);
  const drafts: EventDraft[] = [];
  let version = "";
  let date = "";
  let block: string[] = [];
  const flush = () => {
    if (!version) return;
    const changes = bulletsOf(block).map(stripMd);
    drafts.push(release({
      title: `Claude Code ${version}`,
      date,
      detail: `${changes.length} 条变更：${changes.slice(0, 3).join("；")}`,
      url: page,
      excerpt: excerptOf(`**${version}**`, date, ...changes.slice(0, 6).map((change) => `* ${change}`)),
    }));
    block = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    const found = line.match(/^\*\*(\d+\.\d+\.\d+)\*\*$/);
    if (found) {
      flush();
      version = found[1] ?? "";
      date = "";
      continue;
    }
    if (version && !date && line && !line.startsWith("*")) {
      date = line;
      continue;
    }
    if (version) block.push(raw);
  }
  flush();
  return drafts;
}

// ---------- Anthropic 新闻：<article> 卡片里的 time / h3 / p ----------

export function anthropicNews(html: string, page: string): EventDraft[] {
  const $ = loadHtml(html);
  const drafts: EventDraft[] = [];
  $("a[class*='title-link'], a[class*='tileLink']").each((_, anchor) => {
    const card = $(anchor).closest("article, [class*='_summary']");
    if (!card.length) return;
    const heading = $(anchor).find("h1, h2, h3, h4").first();
    drafts.push({
      type: "news",
      title: textOf($, heading.length ? heading : card.find("h1, h2, h3, h4").first()),
      date: textOf($, card.find("time").first()),
      detail: card.find("p").map((__, paragraph) => textOf($, paragraph)).get().find((text) => text.split(" ").length > 4) ?? "",
      url: absoluteUrl(page, $(anchor).attr("href") ?? ""),
      excerpt: excerptOf(textOf($, card), `链接：${$(anchor).attr("href") ?? ""}`),
    });
  });
  return drafts;
}

// ---------- DeepSeek Change Log：h2 Date → h3 标题 → 段落 ----------

export function deepSeekUpdates(html: string, page: string): EventDraft[] {
  const $ = loadHtml(html);
  const root = $(".theme-doc-markdown").first();
  const drafts: EventDraft[] = [];
  let date = "";
  root.find("h2, h3").each((_, heading) => {
    const text = textOf($, heading);
    if (heading.tagName.toLowerCase() === "h2") {
      date = text.replace(/^Date:\s*/i, "");
      return;
    }
    const body = $(heading).nextUntil("h2, h3").map((__, element) => textOf($, element)).get().join(" ").replace(/\s+/g, " ").trim();
    const id = $(heading).attr("id");
    drafts.push(release({ title: text, date, detail: body, url: id ? `${page}#${id}` : page, excerpt: excerptOf(`Date: ${date}`, text, body.slice(0, 600)) }));
  });
  return drafts;
}

// ---------- Kimi 平台发布记录：**YYYY年M月** → ### 标题 / 列表项 ----------

export function kimiChangelog(markdown: string, page: string): EventDraft[] {
  const lines = markdown.split(/\r?\n/);
  const drafts: EventDraft[] = [];
  let month = "";
  let title = "";
  let block: string[] = [];
  const flush = () => {
    if (title) {
      const lines = block.map((line) => line.trim()).filter(Boolean);
      const detail = lines.map((line) => stripMd(line.replace(/^[*-]\s+/, ""))).join("；");
      drafts.push(release({ title, date: month, detail, url: page, excerpt: excerptOf(month, `### ${title}`, ...lines).slice(0, 900) }));
    } else {
      for (const bullet of bulletsOf(block)) {
        drafts.push(release({ title: firstSentence(bullet), date: month, detail: stripMd(bullet), url: page, excerpt: excerptOf(month, `* ${bullet}`) }));
      }
    }
    title = "";
    block = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    const found = line.match(/^\*\*(\d{4})年(\d{1,2})月\*\*$/);
    if (found) {
      flush();
      month = `${found[1]}年${found[2]}月`;
      continue;
    }
    const heading = line.match(/^###\s+(.+)$/);
    if (heading && month) {
      flush();
      title = stripMd(heading[1] ?? "").replace(/^[^\p{L}\p{N}]+/u, "");
      continue;
    }
    if (month) block.push(raw);
  }
  flush();
  return drafts;
}

// ---------- 智谱发布记录：**日期** → 标题行 → 链接行 → 列表 ----------

export function zhipuReleases(markdown: string, page: string): EventDraft[] {
  const lines = markdown.split(/\r?\n/);
  const drafts: EventDraft[] = [];
  let date = "";
  let block: string[] = [];
  const flush = () => {
    if (!date) return;
    const text = block.map((line) => line.trim()).filter(Boolean);
    const title = text.find((line) => !line.startsWith("*") && !/\]\(/.test(line)) ?? "";
    const link = text.join(" ").match(/\]\((https?:[^)]+)\)/)?.[1] ?? page;
    const bullets = bulletsOf(block).map(stripMd);
    drafts.push(release({ title: stripMd(title), date, detail: bullets.join("；"), url: link.replace(/\.md$/, ""), excerpt: excerptOf(`**${date}**`, ...text.slice(0, 6)) }));
    block = [];
  };
  for (const raw of lines) {
    const found = raw.trim().match(/^\*\*(\d{4}-\d{1,2}-\d{1,2})\*\*$/);
    if (found) {
      flush();
      date = found[1] ?? "";
      continue;
    }
    if (/^#{1,3}\s/.test(raw.trim())) {
      flush();
      date = "";
      continue;
    }
    if (date) block.push(raw);
  }
  flush();
  return drafts;
}
