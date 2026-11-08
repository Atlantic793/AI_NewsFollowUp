import {
  anthropicNews,
  claudeCodeChangelog,
  claudeReleaseNotes,
  deepSeekUpdates,
  geminiChangelog,
  kimiChangelog,
  openAiChangelog,
  rssItems,
  statuspageHtml,
  statuspageJson,
  zhipuReleases,
} from "./parsers/event.js";
import { githubTrending, huggingFaceTrending, kaggleCompetitions } from "./parsers/hot.js";
import {
  aliyunCodingPlan,
  aliyunPrices,
  claudeApiPrices,
  claudePlans,
  codexPlans,
  deepSeekPrices,
  geminiApiPrices,
  kimiPrices,
  openAiApiPrices,
  zhipuCodingPlan,
  zhipuPrices,
} from "./parsers/price.js";
import { artificialAnalysisRanks, lmarenaRanks, swebenchVerified } from "./parsers/rank.js";
import type { EventDraft, Extracted, HotDraft, PriceDraft, RankDraft } from "./rows.js";
import type { EventParser, HotParser, PriceParser, RankParser, SourceDef } from "./sources.js";

/** 抽取步：按来源登记的解析器，从原始响应里摘出候选行。页面结构对不上时会抛错。 */
export function extract(source: SourceDef, body: string): Extracted {
  switch (source.column) {
    case "price":
      return { column: "price", drafts: priceDrafts(source.parser, body) };
    case "event":
      return { column: "event", drafts: eventDrafts(source.parser, body, source.page) };
    case "rank":
      return { column: "rank", drafts: rankDrafts(source.parser, body) };
    case "hot":
      return { column: "hot", drafts: hotDrafts(source.parser, body, source.page) };
    default: {
      const unreachable: never = source;
      return unreachable;
    }
  }
}

function priceDrafts(parser: PriceParser, body: string): PriceDraft[] {
  switch (parser) {
    case "openai_api_price":
      return openAiApiPrices(body);
    case "codex_plans":
      return codexPlans(body);
    case "claude_api_price":
      return claudeApiPrices(body);
    case "claude_plans":
      return claudePlans(body);
    case "gemini_api_price":
      return geminiApiPrices(body);
    case "deepseek_price":
      return deepSeekPrices(body);
    case "aliyun_price":
      return aliyunPrices(body);
    case "aliyun_coding_plan":
      return aliyunCodingPlan(body);
    case "kimi_price":
      return kimiPrices(body);
    case "zhipu_price":
      return zhipuPrices(body);
    case "zhipu_coding_plan":
      return zhipuCodingPlan(body);
    default: {
      const unreachable: never = parser;
      return unreachable;
    }
  }
}

function eventDrafts(parser: EventParser, body: string, page: string): EventDraft[] {
  switch (parser) {
    case "openai_changelog":
      return openAiChangelog(body, page);
    case "rss":
      return rssItems(body);
    case "statuspage_json":
      return statuspageJson(body, page);
    case "statuspage_html":
      return statuspageHtml(body, page);
    case "claude_release_notes":
      return claudeReleaseNotes(body, page);
    case "claude_code_changelog":
      return claudeCodeChangelog(body, page);
    case "anthropic_news":
      return anthropicNews(body, page);
    case "gemini_changelog":
      return geminiChangelog(body, page);
    case "deepseek_updates":
      return deepSeekUpdates(body, page);
    case "kimi_changelog":
      return kimiChangelog(body, page);
    case "zhipu_releases":
      return zhipuReleases(body, page);
    default: {
      const unreachable: never = parser;
      return unreachable;
    }
  }
}

function rankDrafts(parser: RankParser, body: string): RankDraft[] {
  switch (parser) {
    case "lmarena_dataset":
      return lmarenaRanks(body);
    case "swebench":
      return swebenchVerified(body);
    case "artificial_analysis":
      return artificialAnalysisRanks(body);
    default: {
      const unreachable: never = parser;
      return unreachable;
    }
  }
}

function hotDrafts(parser: HotParser, body: string, page: string): HotDraft[] {
  switch (parser) {
    case "github_trending":
      return githubTrending(body, page);
    case "hf_trending":
      return huggingFaceTrending(body);
    case "kaggle_competitions":
      return kaggleCompetitions(body);
    default: {
      const unreachable: never = parser;
      return unreachable;
    }
  }
}
