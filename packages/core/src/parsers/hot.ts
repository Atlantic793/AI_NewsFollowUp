import { loadHtml, textOf } from "../parse/html.js";
import { absoluteUrl, excerptOf, stripMd } from "../parse/text.js";
import type { HotDraft } from "../rows.js";

// ---------- GitHub Trending：每个 article.Box-row 是一行 ----------

export function githubTrending(html: string, page: string): HotDraft[] {
  const $ = loadHtml(html);
  const drafts: HotDraft[] = [];
  $("article.Box-row").each((index, article) => {
    const href = $(article).find("h2 a").first().attr("href") ?? "";
    const stars = textOf($, $(article).find("span.d-inline-block.float-sm-right").first());
    const language = textOf($, $(article).find("[itemprop='programmingLanguage']").first());
    const summary = textOf($, $(article).find("p").first());
    drafts.push({
      rank: String(index + 1),
      title: href.replace(/^\//, ""),
      url: absoluteUrl(page, href),
      heat: stars,
      summary,
      excerpt: excerptOf(href, summary, language, stars),
    });
  });
  return drafts;
}

// ---------- Hugging Face：/api/models?sort=trendingScore ----------

interface HubModel {
  id?: string;
  trendingScore?: number;
  likes?: number;
  downloads?: number;
  pipeline_tag?: string;
  tags?: string[];
}

const TAG_NOISE = /^(license:|region:|base_model|dataset:|arxiv:|endpoints_compatible$|deploy:|eval-results$|safetensors$|transformers$|gguf$|custom_code$|conversational$)/i;

/** 列表接口没有散文介绍时，只用任务名和能力标签，不把点赞、下载量当成简介。 */
export function hubCapability(model: { pipeline_tag?: string; tags?: string[] }): string {
  const task = (model.pipeline_tag ?? "").trim();
  const tags = (model.tags ?? [])
    .map((tag) => tag.trim())
    .filter((tag) => tag && tag !== task && !TAG_NOISE.test(tag) && !/^[a-z]{2}$/.test(tag));
  return [task, ...tags].filter(Boolean).slice(0, 8).join(" · ");
}

const TASKS: Record<string, string> = {
  "text-generation": "根据文字生成文字",
  "text2text-generation": "把一段文字变成另一段文字",
  "image-text-to-text": "看图片和文字后生成文字",
  "text-to-image": "按文字生成图片",
  "image-to-image": "修改已有图片",
  "image-generation": "生成图片",
  "image-editing": "编辑图片",
  "image-to-video": "按图片生成视频",
  "text-to-video": "按文字生成视频",
  "video-to-video": "把一段视频变成另一段视频",
  "image-text-to-video": "按图片和文字生成视频",
  "audio-to-video": "按音频生成视频",
  "text-to-audio": "按文字生成音频",
  "video-to-audio": "从视频生成音频",
  "text-to-speech": "把文字转成语音",
  "automatic-speech-recognition": "把语音转成文字",
  "speech-to-text": "把语音转成文字",
  "image-to-3d": "把图片变成三维模型",
  "mask-generation": "生成图像遮罩",
  "feature-extraction": "提取特征",
};

/** 列表里只有任务标签时，写成中文能力，不交给模型逐词硬翻。 */
export function capabilitySentence(summary: string): string {
  const parts = summary.split(" · ").map((part) => part.trim()).filter((part) => part && !/\s/.test(part));
  if (parts.length === 0) return "";
  const labels = [...new Set(parts.flatMap((part) => {
    const label = TASKS[part.toLowerCase()];
    return label ? [label] : [];
  }))];
  if (labels.length === 0) return "";
  return `能${labels.slice(0, 4).join("，也能")}。`;
}

/** 模型卡里第一段真正的介绍。徽章、标题和一排链接跳过。 */
export function hubBlurb(markdown: string): string {
  const withoutFront = markdown.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  const blocks = withoutFront.replace(/<!--[\s\S]*?-->/g, "").split(/\n\s*\n/);
  for (const block of blocks) {
    const withoutLinks = block
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/<img\b[^>]*>/gi, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1");
    const text = stripMd(withoutLinks.replace(/<br\s*\/?>/gi, "\n")).replace(/^#+\s*/, "").replace(/^>\s*/gm, "").trim();
    if (text.length < 40 || /^https?:\/\//.test(text) || /^\[!/.test(text) || /^a special thank/i.test(text)) continue;
    if ((text.match(/[A-Za-z\u4e00-\u9fff]{2,}/g) ?? []).length < 6) continue;
    const bars = text.match(/[|·]/g)?.length ?? 0;
    if (bars >= 2 && !/[.。!！?？]/.test(text)) continue;
    return text.slice(0, 500);
  }
  return "";
}

export function huggingFaceTrending(json: string): HotDraft[] {
  const models = JSON.parse(json) as HubModel[];
  return models.map((model, index) => ({
    rank: String(index + 1),
    title: model.id ?? "",
    url: model.id ? `https://huggingface.co/${model.id}` : "",
    heat: typeof model.trendingScore === "number" ? `趋势分 ${model.trendingScore}` : "",
    summary: hubCapability(model),
    excerpt: JSON.stringify({ id: model.id, pipeline_tag: model.pipeline_tag, tags: model.tags ?? [] }),
  }));
}

// ---------- Kaggle：官方 API /api/v1/competitions/list ----------

interface KaggleCompetition {
  ref?: string;
  title?: string;
  url?: string;
  description?: string;
  overview?: string;
  deadline?: string;
  category?: string;
  reward?: string;
  teamCount?: number;
}

export function kaggleCompetitions(json: string): HotDraft[] {
  const items = JSON.parse(json) as KaggleCompetition[];
  return items.map((item, index) => {
    const ref = item.url || item.ref || "";
    const about = stripMd(item.description || item.overview || "").slice(0, 500);
    return {
      rank: String(index + 1),
      title: item.title ?? "",
      url: ref.startsWith("http") ? ref : ref ? `https://www.kaggle.com/competitions/${ref}` : "",
      heat: [item.reward ?? "", typeof item.teamCount === "number" ? `${item.teamCount} 队` : "", item.deadline ? `截止 ${item.deadline.slice(0, 10)}` : ""].filter(Boolean).join(" · "),
      summary: about || item.category || "",
      excerpt: about || JSON.stringify({ title: item.title, category: item.category, reward: item.reward, deadline: item.deadline }),
    };
  });
}
