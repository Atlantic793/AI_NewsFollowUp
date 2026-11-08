import { loadHtml, textOf } from "../parse/html.js";
import { absoluteUrl, excerptOf } from "../parse/text.js";
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
      summary: [summary, language].filter(Boolean).join(" · "),
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
}

export function huggingFaceTrending(json: string): HotDraft[] {
  const models = JSON.parse(json) as HubModel[];
  return models.map((model, index) => ({
    rank: String(index + 1),
    title: model.id ?? "",
    url: model.id ? `https://huggingface.co/${model.id}` : "",
    heat: typeof model.trendingScore === "number" ? `趋势分 ${model.trendingScore}` : "",
    summary: [model.pipeline_tag ?? "", typeof model.likes === "number" ? `${model.likes} likes` : "", typeof model.downloads === "number" ? `${model.downloads} downloads` : ""].filter(Boolean).join(" · "),
    excerpt: JSON.stringify({ id: model.id, trendingScore: model.trendingScore, likes: model.likes, downloads: model.downloads, pipeline_tag: model.pipeline_tag }),
  }));
}

// ---------- Kaggle：官方 API /api/v1/competitions/list ----------

interface KaggleCompetition {
  ref?: string;
  title?: string;
  url?: string;
  deadline?: string;
  category?: string;
  reward?: string;
  teamCount?: number;
}

export function kaggleCompetitions(json: string): HotDraft[] {
  const items = JSON.parse(json) as KaggleCompetition[];
  return items.map((item, index) => {
    const ref = item.url || item.ref || "";
    return {
      rank: String(index + 1),
      title: item.title ?? "",
      url: ref.startsWith("http") ? ref : ref ? `https://www.kaggle.com/competitions/${ref}` : "",
      heat: [item.reward ?? "", typeof item.teamCount === "number" ? `${item.teamCount} 队` : ""].filter(Boolean).join(" · "),
      summary: [item.category ?? "", item.deadline ? `截止 ${item.deadline.slice(0, 10)}` : ""].filter(Boolean).join(" · "),
      excerpt: JSON.stringify(item),
    };
  });
}
