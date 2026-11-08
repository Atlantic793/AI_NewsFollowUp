import type { Element } from "domhandler";
import { flat, headRowCount, loadHtml, mergedHead, tableGrid, textOf, type Doc } from "../parse/html.js";
import { excerptOf, lastHeading, mdTables, readJsonAt, stripMd, type MdTable } from "../parse/text.js";
import type { PriceDraft } from "../rows.js";

type DraftInput = Pick<PriceDraft, "product" | "metric" | "price" | "excerpt"> & Partial<PriceDraft>;

function draft(input: DraftInput): PriceDraft {
  return { kind: "api", tier: "", condition: "", unit: "", quota: "", reset: "", ...input };
}

const join = (...parts: string[]) => parts.map((part) => part.trim()).filter(Boolean).join(" · ");

/** 把英文表头里的计价项换成统一的中文名；认不出就原样留着。 */
export function metricName(head: string): string {
  const text = stripMd(head).toLowerCase();
  if (/cache hits?|cached input|cache read|缓存命中/.test(text)) return "缓存读取";
  if (/5m cache write/.test(text)) return "5 分钟缓存写入";
  if (/1h cache write/.test(text)) return "1 小时缓存写入";
  if (/30m write/.test(text)) return "30 分钟缓存写入";
  if (/12h write/.test(text)) return "12 小时缓存写入";
  if (/^(base |batch )?input( tokens)?$/.test(text)) return "输入";
  if (/^(batch )?output( tokens| \/ cost)?$/.test(text)) return "输出";
  if (/^training$/.test(text)) return "训练";
  if (/price per minute/.test(text)) return "按分钟计费";
  if (/estimated cost/.test(text)) return "估算费用";
  return stripMd(head);
}

// ---------- OpenAI API 定价（Markdown 版） ----------

const OPENAI_TIER = /^(?:#{3,4}\s+)?(Standard|Batch|Flex|Fast|Ultrafast|Priority)(?:\s+pricing data)?$/;
const OPENAI_GROUP = /^[A-Z][A-Za-z -]{2,60}(?:models?|model configurations|sessions)$|^Fine-tuning$/;

export function openAiApiPrices(markdown: string): PriceDraft[] {
  const lines = markdown.split(/\r?\n/);
  const tables = new Map(mdTables(lines).map((table) => [table.line, table]));
  const shortNote = markdown.match(/Short context:\s*([^.]+?)\s+input tokens/i)?.[1] ?? "";
  const longNote = markdown.match(/Long context:\s*([^.]+?)\s+input tokens/i)?.[1] ?? "";
  const drafts: PriceDraft[] = [];
  let group = "";
  let tier = "Standard";
  for (let index = 0; index < lines.length; index += 1) {
    const table = tables.get(index);
    if (table) {
      drafts.push(...openAiTable(table, group, tier, shortNote, longNote));
      index = table.line + 1 + table.rows.length;
      continue;
    }
    const line = (lines[index] ?? "").trim();
    if (!line || line.startsWith("|")) continue;
    const tierHit = line.match(OPENAI_TIER);
    if (tierHit) {
      tier = tierHit[1] ?? tier;
      continue;
    }
    if (OPENAI_GROUP.test(line)) {
      group = line;
      tier = "Standard";
    }
  }
  return drafts;
}

function openAiTable(table: MdTable, group: string, tier: string, shortNote: string, longNote: string): PriceDraft[] {
  const modelAt = table.header.findIndex((head) => /^model( configuration)?$/i.test(head));
  if (modelAt < 0) return [];
  const qualifiers = table.header.flatMap((head, index) => (index !== modelAt && /^(modality|use case|category)$/i.test(head) ? [index] : []));
  const drafts: PriceDraft[] = [];
  table.rows.forEach((cells, rowIndex) => {
    const qualifier = qualifiers.map((index) => cells[index] ?? "").join(" · ");
    table.header.forEach((head, index) => {
      if (index === modelAt || qualifiers.includes(index)) return;
      const context = head.match(/^(Short|Long) context\s+(.+)$/i);
      const span = context ? (/short/i.test(context[1] ?? "") ? `短上下文 ${shortNote}` : `长上下文 ${longNote}`) : "";
      drafts.push(draft({
        product: cells[modelAt] ?? "",
        tier,
        metric: metricName(context ? context[2] ?? head : head),
        condition: join(group, qualifier, span),
        price: cells[index] ?? "",
        unit: /minute/i.test(head) ? "每分钟" : "每百万 token",
        excerpt: excerptOf(join(group, tier), table.rawHeader, table.rawRows[rowIndex] ?? ""),
      }));
    });
  });
  return drafts;
}

// ---------- Codex / ChatGPT 套餐（learn.chatgpt.com Markdown 版） ----------

export function codexPlans(markdown: string): PriceDraft[] {
  const usage = codexUsage(markdown);
  const drafts: PriceDraft[] = [];
  for (const card of markdown.matchAll(/<PricingCard\b([\s\S]*?)>([\s\S]*?)<\/PricingCard>/g)) {
    const attrs = Object.fromEntries([...(card[1] ?? "").matchAll(/(\w+)="([^"]*)"/g)].map((match) => [match[1] ?? "", match[2] ?? ""]));
    const name = attrs.name ?? "";
    const plan = usage.get(name);
    drafts.push(draft({
      kind: "plan",
      product: name,
      tier: "订阅",
      metric: "订阅价",
      condition: /\d|billed|annual|monthly|users?\b/i.test(attrs.footnoteLabel ?? "") ? (attrs.footnoteLabel ?? "").replace(/^\*+/, "") : "",
      price: [attrs.priceEyebrow ?? "", attrs.price ?? ""].join(" ").trim(),
      unit: attrs.interval ?? "",
      quota: plan?.quota ?? "",
      reset: plan?.reset ?? "",
      excerpt: excerptOf((card[0] ?? "").replace(/\n\s*\n/g, "\n"), plan?.excerpt ?? ""),
    }));
  }
  return drafts;
}

interface PlanUsage {
  quota: string;
  reset: string;
  excerpt: string;
}

function codexUsage(markdown: string): Map<string, PlanUsage> {
  const usage = new Map<string, PlanUsage>();
  const block = markdown.match(/<TableWrapper[\s\S]*?<\/TableWrapper>/);
  if (!block || block.index === undefined) return usage;
  const before = markdown.slice(Math.max(0, block.index - 900), block.index);
  const $ = loadHtml(block[0].replace(/<TableWrapper[^>]*>/, "<table>").replace(/<\/TableWrapper>/, "</table>"));
  const heads = $("thead th").map((_, th) => textOf($, th)).get();
  const rows = $("tbody tr").map((_, tr) => [$(tr).find("td").map((__, td) => textOf($, td)).get()]).get() as string[][];
  const fiveHour = /per five-hour period/i.test(before);
  const weekly = /Weekly limits may also apply/i.test(block[0]);
  const sentence = before.match(/[^.]*per five-hour period[^.]*\./)?.[0]?.replace(/\s+/g, " ").trim() ?? "";
  heads.slice(1).forEach((head, index) => {
    const quota = rows.map((cells) => `${cells[0] ?? ""} ${cells[index + 1] ?? ""}`.trim()).join("；");
    usage.set(head.replace(/^Standard\s+/i, ""), {
      quota: quota ? `每 5 小时本地消息（估计）：${quota}` : "",
      reset: fiveHour ? (weekly ? "每 5 小时；可能另有每周上限" : "每 5 小时") : "",
      excerpt: excerptOf(sentence, `${heads.join(" | ")}`, ...rows.map((cells) => cells.join(" | "))),
    });
  });
  const proNote = before.match(/Pro plans currently have no five-hour limit\./i)?.[0];
  if (proNote) usage.set("Pro", { quota: "", reset: "目前没有 5 小时上限", excerpt: proNote });
  return usage;
}

// ---------- Claude API 定价（Markdown 版） ----------

export function claudeApiPrices(markdown: string): PriceDraft[] {
  const lines = markdown.split(/\r?\n/);
  const drafts: PriceDraft[] = [];
  for (const table of mdTables(lines)) {
    const heading = lastHeading(lines, table.line);
    const tier = /^#+\s*model pricing/i.test(heading) ? "Standard" : /batch processing/i.test(heading) ? "Batch" : /fast mode pricing/i.test(heading) ? "Fast" : "";
    if (!tier || !/^model$/i.test(table.header[0] ?? "")) continue;
    table.rows.forEach((cells, rowIndex) => {
      table.header.slice(1).forEach((head, index) => {
        drafts.push(draft({
          product: cells[0] ?? "",
          tier,
          metric: metricName(head),
          price: cells[index + 1] ?? "",
          unit: "每百万 token",
          excerpt: excerptOf(heading, table.rawHeader, table.rawRows[rowIndex] ?? ""),
        }));
      });
    });
  }
  return drafts;
}

// ---------- Claude 套餐（claude.com/pricing，读 data-plan 属性） ----------

export function claudePlans(html: string): PriceDraft[] {
  const $ = loadHtml(html);
  const drafts: PriceDraft[] = [];
  $("[data-plan]").each((_, element) => {
    const key = $(element).attr("data-plan") ?? "";
    if (($(element).attr("data-plan-field") ?? "") === "amount_total") return;
    const card = $(element).parents().filter((__, parent) => $(parent).find("[class*='__planName']").length === 1).first();
    const name = textOf($, card.find("[class*='__planName']").first());
    const seat = $(element).parents().filter((__, parent) => /__seat(\s|$)/.test($(parent).attr("class") ?? "")).first();
    const seatName = seat.length ? textOf($, seat.find("[class*='__seatName']").first()) : "";
    const box = seat.length ? seat : $(element).parents().filter((__, parent) => /__priceWrap/.test($(parent).attr("class") ?? "")).first();
    drafts.push(draft({
      kind: "plan",
      product: join(name, seatName),
      tier: "订阅",
      metric: "订阅价",
      condition: claudePlanTerm(key),
      price: textOf($, element),
      unit: /per_seat/.test(key) ? "每席位每月" : "每月",
      excerpt: excerptOf(`${name} ${seatName}`.trim(), `data-plan="${key}"`, textOf($, box.length ? box : $(element).parent())),
    }));
  });
  return drafts;
}

function claudePlanTerm(key: string): string {
  const usage = key.match(/_(\d+x)_/)?.[1] ?? "";
  const billing = /_annual/.test(key) ? "按年付费" : /_monthly/.test(key) ? "按月付费" : "";
  return join(usage ? `${usage} 用量` : "", billing);
}

// ---------- Gemini API 定价（Markdoc 版） ----------

export function geminiApiPrices(markdown: string): PriceDraft[] {
  const lines = markdown.split(/\r?\n/);
  const drafts: PriceDraft[] = [];
  let heading = "";
  let product = "";
  let tier = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? "").trim();
    const h2 = line.match(/^##\s+(.+?)\s*(?:\{%.*%\})?$/);
    if (h2) {
      heading = stripMd(h2[1] ?? "");
      product = heading;
      tier = "";
      continue;
    }
    const id = line.match(/^\*\[`([^`]+)`\]/);
    if (id) {
      product = id[1] ?? product;
      continue;
    }
    const tab = line.match(/\{%\s*tab\s+title="([^"]+)"\s*%\}/);
    if (tab) {
      tier = tab[1] ?? "";
      continue;
    }
    if (!/\{%\s*table\s*%\}/.test(line) || !heading || /pricing for/i.test(heading)) continue;
    let stop = index + 1;
    while (stop < lines.length && !/\{%\s*\/table\s*%\}/.test(lines[stop] ?? "")) stop += 1;
    drafts.push(...geminiTable(lines.slice(index + 1, stop), product, tier || "Standard", heading));
    index = stop;
  }
  return drafts;
}

function markdocRows(lines: readonly string[]): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "---") {
      if (row.length > 0) rows.push(row);
      row = [];
      continue;
    }
    if (line.startsWith("* ")) {
      row.push(line.slice(2));
      continue;
    }
    if (line && row.length > 0) row[row.length - 1] += `\n${line}`;
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

const GEMINI_MONEY = /\$\s?\d[\d,]*(?:\.\d+)?(?:\s*\/\s*[\d,]+\s*(?:tokens?|requests?|images?|seconds?|minutes?)(?:\s+per\s+\w+)?|\s+per\s+(?:[\d,]+\s+)?\w+)?/i;

function geminiTable(lines: readonly string[], product: string, tier: string, heading: string): PriceDraft[] {
  const rows = markdocRows(lines);
  const header = (rows[0] ?? []).map(stripMd);
  const paidAt = header.findIndex((head) => /paid tier/i.test(head));
  if (paidAt < 0) return [];
  const perRequest = /per request/i.test(header[paidAt] ?? "");
  const drafts: PriceDraft[] = [];
  for (const cells of rows.slice(1)) {
    const feature = stripMd(cells[0] ?? "");
    const metric = perRequest ? "按次计费" : geminiMetric(feature);
    if (!metric) continue;
    const excerpt = excerptOf(heading, tier, `${feature}：${stripMd(cells[paidAt] ?? "")}`);
    const push = (price: string, condition: string) => drafts.push(draft({
      product: perRequest ? `${product} · ${feature}` : product,
      tier,
      metric,
      condition: join(geminiModality(feature), condition),
      price,
      unit: perRequest ? "每次请求" : "每百万 token",
      excerpt,
    }));
    for (const raw of (cells[paidAt] ?? "").split("\n")) {
      const stated = stripMd(raw);
      const line = stated.replace(/\s*Equivalent to .*$/i, "");
      const labelled = [...line.matchAll(/(\$\s?\d[\d,]*(?:\.\d+)?)\s*\(([^)]+)\)/g)];
      if (labelled.length >= 2) {
        for (const pair of labelled) push(pair[1] ?? "", pair[2] ?? "");
      } else {
        const money = line.match(GEMINI_MONEY);
        if (money) push(money[0], line.replace(money[0], "").replace(/^[\s,.:;()]+|[\s,.:;()]+$/g, "").replace(/[()]/g, ""));
      }
      if (line !== stated) break;
    }
  }
  return drafts;
}

function geminiMetric(feature: string): string {
  if (/^(text |image |video |audio )?input price/i.test(feature)) return "输入";
  if (/^output price/i.test(feature)) return "输出";
  if (/context caching price/i.test(feature)) return "缓存读取";
  if (/context caching \(storage\)/i.test(feature)) return "缓存存储";
  if (/tuning price/i.test(feature)) return "微调";
  return "";
}

function geminiModality(feature: string): string {
  const prefix = feature.match(/^(text|image|video|audio) input price/i)?.[1]?.toLowerCase();
  const names: Record<string, string> = { text: "文本", image: "图像", video: "视频", audio: "音频" };
  if (prefix) return names[prefix] ?? prefix;
  const inner = feature.match(/^input price \(([^)]+)\)/i)?.[1];
  return inner ?? "";
}

// ---------- DeepSeek 模型与价格（HTML 表格） ----------

export function deepSeekPrices(html: string): PriceDraft[] {
  const $ = loadHtml(html);
  const peak = $("body").text().match(/Peak hours are[^.]+\./)?.[0] ?? "";
  const drafts: PriceDraft[] = [];
  $("table").each((_, table) => {
    const grid = tableGrid($, table).map((row) => row.map(flat));
    const modelRow = grid.find((row) => /^MODEL$/i.test(row[0] ?? ""));
    if (modelRow) {
      const models = modelRow.slice(3);
      for (const row of grid) {
        if (!/^PRICING/i.test(row[0] ?? "")) continue;
        const band = row[2] ?? "";
        models.forEach((model, index) => {
          drafts.push(draft({
            product: model,
            tier: "Standard",
            metric: deepSeekMetric(row[1] ?? ""),
            condition: /^OFF-PEAK$/i.test(band) ? "低谷时段" : /^PEAK$/i.test(band) ? "高峰时段" : band,
            price: row[3 + index] ?? "",
            unit: "每百万 token",
            excerpt: excerptOf(`MODEL | ${models.join(" | ")}`, row.join(" | "), /^PEAK$/i.test(band) ? peak : ""),
          }));
        });
      }
      return;
    }
    const head = grid[0] ?? [];
    if (/^API$/i.test(head[0] ?? "") && head.some((cell) => /price/i.test(cell))) {
      const priceAt = head.findIndex((cell) => /price/i.test(cell));
      for (const row of grid.slice(1)) {
        drafts.push(draft({
          product: `${row[0] ?? ""} API`,
          tier: "Standard",
          metric: "调用",
          price: row[priceAt] ?? "",
          unit: row[1] ?? "",
          excerpt: excerptOf(head.join(" | "), row.join(" | ")),
        }));
      }
    }
  });
  return drafts;
}

function deepSeekMetric(group: string): string {
  if (/CACHE HIT/i.test(group)) return "输入（缓存命中）";
  if (/CACHE MISS/i.test(group)) return "输入（缓存未命中）";
  if (/OUTPUT/i.test(group)) return "输出";
  return group;
}

// ---------- 阿里云百炼（正文在 __ICE_PAGE_PROPS__ 里） ----------

export function aliyunContent(html: string): string {
  const marker = "window.__ICE_PAGE_PROPS__=";
  const at = html.indexOf(marker);
  if (at < 0) return "";
  const raw = readJsonAt(html, at + marker.length);
  if (!raw) return "";
  try {
    const data = JSON.parse(raw) as { docDetailData?: { storeData?: { data?: { content?: unknown } } } };
    const content = data.docDetailData?.storeData?.data?.content;
    return typeof content === "string" ? content : "";
  } catch {
    return "";
  }
}

const MAINLAND_REGION = /北京|杭州|上海|深圳|中国内地|中国大陆|华北|华东|华南/;

export function aliyunPrices(html: string): PriceDraft[] {
  const content = aliyunContent(html);
  if (!content) return [];
  const $ = loadHtml(content);
  const drafts: PriceDraft[] = [];
  let category = "";
  let family = "";
  let region = "";
  $("h2, h3, h4, table").each((_, element) => {
    const tag = element.tagName.toLowerCase();
    if (tag === "h2") {
      category = textOf($, element);
      family = "";
      region = "";
      return;
    }
    if (tag === "h3") {
      family = textOf($, element);
      region = "";
      return;
    }
    if (tag === "h4") {
      region = textOf($, element);
      return;
    }
    if (region && !MAINLAND_REGION.test(region)) return;
    drafts.push(...aliyunTable($, element, join(category, family), region));
  });
  return drafts;
}

function aliyunTable($: Doc, table: Element, family: string, region: string): PriceDraft[] {
  const grid = tableGrid($, table);
  const headRows = headRowCount($, table);
  const head = mergedHead(grid, headRows);
  const modelAt = head.findIndex((cell) => /^模型\s*(ID|名称|Code)?/i.test(cell));
  const priceCols = head.flatMap((cell, index) => (/单价/.test(cell) ? [index] : []));
  if (modelAt < 0 || priceCols.length === 0) return [];
  const quotaAt = head.findIndex((cell) => /免费额度/.test(cell));
  const condCols = head.flatMap((_, index) => (index === modelAt || index === quotaAt || priceCols.includes(index) ? [] : [index]));
  const drafts: PriceDraft[] = [];
  for (const row of grid.slice(headRows)) {
    const first = flat(row[modelAt] ?? "").split(" ")[0] ?? "";
    const product = /^[A-Za-z0-9][\w.\-/:]*$/.test(first) ? first : flat(row[modelAt] ?? "");
    for (const index of priceCols) {
      const cell = head[index] ?? "";
      const base = cell.match(/^(输入|输出)/)?.[1] ?? cell.replace(/单价.*$/, "");
      const rest = cell.replace(/^(输入|输出)?单价\s*[（(]每[^）)]*[）)]\s*/, "").trim();
      const priced = (row[index] ?? "").split(/\n|；/).map((part) => part.trim()).filter((part) => /\d/.test(part) && /元|\$|¥/.test(part));
      for (const segment of priced.length > 1 ? priced : [flat(row[index] ?? "")]) {
        const labelled = segment.match(/^(.{2,30}?)[：:]\s*(.*\d.*)$/);
        drafts.push(draft({
          product,
          tier: "标准",
          metric: rest && rest !== cell ? `${base}（${rest}）` : base || cell,
          condition: join(...condCols.map((col) => flat(row[col] ?? "")), labelled?.[1] ?? "", region),
          price: labelled?.[2] ?? segment,
          unit: /每百万\s*Token/i.test(cell) ? "每百万 token" : /每张/.test(cell) ? "每张" : /每秒/.test(cell) ? "每秒" : "",
          quota: quotaAt >= 0 ? flat(row[quotaAt] ?? "") : "",
          excerpt: excerptOf(join(family, region), head.join(" | "), row.map(flat).join(" | ")),
        }));
      }
    }
  }
  return drafts;
}

export function aliyunCodingPlan(html: string): PriceDraft[] {
  const content = aliyunContent(html);
  if (!content) return [];
  const $ = loadHtml(content);
  const resets = $("li").map((_, li) => flat(textOf($, li))).get()
    .filter((text) => /^(每\s?5\s?小时额度|每周额度|每月额度)/.test(text))
    .map((text) => text.replace(/\s*例：[\s\S]*$/, "").replace(/。$/, "").trim());
  const drafts: PriceDraft[] = [];
  $("table").each((_, table) => {
    const grid = tableGrid($, table).map((row) => row.map(flat));
    const priceRow = grid.find((row) => (row[0] ?? "").trim() === "价格");
    if (!priceRow) return;
    const quotaRow = grid.find((row) => /用量限制|额度/.test(row[0] ?? ""));
    (grid[0] ?? []).slice(1).forEach((plan, index) => {
      drafts.push(draft({
        kind: "plan",
        product: plan,
        tier: "订阅",
        metric: "订阅价",
        price: priceRow[index + 1] ?? "",
        quota: (quotaRow?.[index + 1] ?? "").replace(/\s*；\s*/g, "；"),
        reset: resets.join("；"),
        excerpt: excerptOf(...grid.filter((row) => !/支持的模型/.test(row[0] ?? "")).map((row) => row.join(" | ")), ...resets),
      }));
    });
  });
  return drafts;
}

// ---------- Kimi 模型推理定价（Mintlify 编译后的 DocTable） ----------

export function kimiPrices(html: string): PriceDraft[] {
  const drafts: PriceDraft[] = [];
  const seen = new Set<string>();
  for (const block of html.matchAll(/columns:\[([\s\S]*?)\],rows:\[([\s\S]*?)\]\]\}/g)) {
    const text = block[0];
    if (seen.has(text)) continue;
    seen.add(text);
    const titles = [...(block[1] ?? "").matchAll(/title:(?:`([^`]*)`|_jsx\([\s\S]*?children:`([^`]*)`)/g)].map((match) => match[1] ?? match[2] ?? "");
    const rows = `${block[2] ?? ""}]`.slice(1).split(/\],\s*\[/).map((row) => [...row.matchAll(/(\w+:)?`([^`]*)`/g)]
      .filter((match) => !match[1] || match[1] === "children:")
      .map((match) => match[2] ?? ""));
    for (const cells of rows) {
      const product = cells[0] ?? "";
      titles.slice(1).forEach((title, index) => {
        drafts.push(draft({
          product,
          tier: "标准",
          metric: title === "输入" || title === "输出" ? title : metricName(title),
          price: cells[index + 1] ?? "",
          unit: "每百万 token",
          excerpt: excerptOf(titles.join(" | "), cells.join(" | ")),
        }));
      });
    }
  }
  return drafts;
}

// ---------- 智谱 API 定价（Markdown 版） ----------

export function zhipuPrices(markdown: string): PriceDraft[] {
  const lines = markdown.split(/\r?\n/);
  const drafts: PriceDraft[] = [];
  for (const table of mdTables(lines)) {
    if (!/^(模型名称|工具名称)$/.test(table.header[0] ?? "")) continue;
    const section = lastHeading(lines, table.line).replace(/^#+\s*/, "");
    const contextAt = table.header.findIndex((head) => /^上下文/.test(head));
    const priceCols = table.header.flatMap((head, index) => (/单价|价格|定价|缓存存储|缓存命中/.test(head) ? [index] : []));
    table.rows.forEach((cells, rowIndex) => {
      const condition = contextAt >= 0 && /输入|输出/.test(cells[contextAt] ?? "") ? cells[contextAt] ?? "" : "";
      for (const index of priceCols) {
        const head = table.header[index] ?? "";
        for (const part of (cells[index] ?? "").split(/[；;]/).map((item) => item.trim()).filter(Boolean)) {
          const labelled = part.match(/^([^：:\d]{1,8})[：:]\s*(.+)$/);
          drafts.push(draft({
            product: cells[0] ?? "",
            tier: /batch/i.test(head) ? "Batch" : "标准",
            metric: `${zhipuMetric(head)}${labelled ? `（${labelled[1]}）` : ""}`,
            condition,
            price: labelled ? labelled[2] ?? "" : part,
            unit: head.match(/[（(]([^）)]*)[）)]/)?.[1] ?? "",
            excerpt: excerptOf(section, table.rawHeader, table.rawRows[rowIndex] ?? ""),
          }));
        }
      }
    });
  }
  return drafts;
}

function zhipuMetric(head: string): string {
  if (/输入单价/.test(head)) return "输入";
  if (/输出单价/.test(head)) return "输出";
  if (/缓存存储/.test(head)) return "缓存存储";
  if (/缓存命中/.test(head)) return "缓存读取";
  return "调用";
}

export function zhipuCodingPlan(markdown: string): PriceDraft[] {
  const lines = markdown.split(/\r?\n/);
  const table = mdTables(lines).find((item) => /套餐类型/.test(item.header[0] ?? ""));
  if (!table) return [];
  const family = stripMd(lines.find((line) => /^#\s/.test(line))?.replace(/^#\s+/, "") ?? "");
  const intro = lines.find((line) => /Coding Plan/.test(line) && !/^#/.test(line)) ?? "";
  const planName = intro.match(/(GLM Coding Plan)/)?.[1] ?? family;
  const resets = lines.map((line) => line.trim()).filter((line) => /^\*\s+\*\*(5 小时积分|周积分)\*\*/.test(line)).map((line) => stripMd(line.replace(/^\*\s+/, "")));
  const offPeak = stripMd(lines.find((line) => /非高峰时段/.test(line)) ?? "");
  return table.rows.map((cells, rowIndex) => draft({
    kind: "plan",
    product: `${planName} ${cells[0] ?? ""}`.trim(),
    tier: "订阅",
    metric: "订阅价",
    price: "",
    quota: table.header.slice(1).map((head, index) => `${head} ${cells[index + 1] ?? ""}`).join("；"),
    reset: resets.join("；"),
    excerpt: excerptOf(table.rawHeader, table.rawRows[rowIndex] ?? "", ...resets, offPeak),
  }));
}
