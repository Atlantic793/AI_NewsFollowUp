export type ColumnKind = "hot" | "price" | "rank" | "event";

export type PriceParser =
  | "openai_api_price"
  | "codex_plans"
  | "claude_api_price"
  | "claude_plans"
  | "gemini_api_price"
  | "deepseek_price"
  | "aliyun_price"
  | "aliyun_coding_plan"
  | "kimi_price"
  | "zhipu_price"
  | "zhipu_coding_plan";

export type EventParser =
  | "openai_changelog"
  | "rss"
  | "statuspage_json"
  | "statuspage_html"
  | "claude_release_notes"
  | "claude_code_changelog"
  | "anthropic_news"
  | "gemini_changelog"
  | "deepseek_updates"
  | "kimi_changelog"
  | "zhipu_releases";

export type RankParser = "lmarena_dataset" | "swebench" | "artificial_analysis";

export type HotParser = "github_trending" | "hf_trending" | "kaggle_competitions";

export type SourceDef =
  | (SourceBase & { column: "price"; parser: PriceParser })
  | (SourceBase & { column: "event"; parser: EventParser })
  | (SourceBase & { column: "rank"; parser: RankParser })
  | (SourceBase & { column: "hot"; parser: HotParser });

interface SourceBase {
  id: string;
  vendor: string;
  label: string;
  /** 实际请求的地址，可能是官方的 Markdown、JSON 或 RSS 版本。 */
  url: string;
  /** 给人看的官方页面。 */
  page: string;
  /** 首次建库时是否打开。 */
  enabled: boolean;
  /** 需要 .env 里的凭据才能请求。 */
  needs?: "kaggle";
}

export const SOURCES: readonly SourceDef[] = [
  { id: "P01", column: "price", parser: "openai_api_price", vendor: "OpenAI", label: "API 定价", url: "https://developers.openai.com/api/docs/pricing.md", page: "https://developers.openai.com/api/docs/pricing", enabled: true },
  { id: "P02", column: "price", parser: "codex_plans", vendor: "OpenAI", label: "Codex / ChatGPT 套餐", url: "https://learn.chatgpt.com/docs/pricing.md", page: "https://learn.chatgpt.com/docs/pricing", enabled: true },
  { id: "P03", column: "price", parser: "claude_api_price", vendor: "Anthropic", label: "Claude API 定价", url: "https://platform.claude.com/docs/en/about-claude/pricing.md", page: "https://platform.claude.com/docs/en/about-claude/pricing", enabled: true },
  { id: "P04", column: "price", parser: "claude_plans", vendor: "Anthropic", label: "Claude 套餐", url: "https://claude.com/pricing", page: "https://claude.com/pricing", enabled: true },
  { id: "P05", column: "price", parser: "gemini_api_price", vendor: "Google", label: "Gemini API 定价", url: "https://aistudio.google.com/docs/pricing.md", page: "https://ai.google.dev/gemini-api/docs/pricing", enabled: true },
  { id: "P06", column: "price", parser: "deepseek_price", vendor: "DeepSeek", label: "模型与价格", url: "https://api-docs.deepseek.com/quick_start/pricing/", page: "https://api-docs.deepseek.com/quick_start/pricing/", enabled: true },
  { id: "P07", column: "price", parser: "aliyun_price", vendor: "阿里云", label: "百炼模型调用价格", url: "https://help.aliyun.com/zh/model-studio/model-pricing", page: "https://help.aliyun.com/zh/model-studio/model-pricing", enabled: true },
  { id: "P08", column: "price", parser: "aliyun_coding_plan", vendor: "阿里云", label: "百炼 Coding Plan", url: "https://help.aliyun.com/zh/model-studio/coding-plan", page: "https://help.aliyun.com/zh/model-studio/coding-plan", enabled: true },
  { id: "P09", column: "price", parser: "kimi_price", vendor: "月之暗面", label: "Kimi 模型推理定价", url: "https://platform.kimi.com/docs/pricing/chat", page: "https://platform.kimi.com/docs/pricing/chat", enabled: true },
  { id: "P10", column: "price", parser: "zhipu_price", vendor: "智谱", label: "API 定价", url: "https://docs.bigmodel.cn/cn/guide/start/pricing.md", page: "https://docs.bigmodel.cn/cn/guide/start/pricing", enabled: true },
  { id: "P11", column: "price", parser: "zhipu_coding_plan", vendor: "智谱", label: "GLM Coding Plan", url: "https://docs.bigmodel.cn/cn/coding-plan/overview.md", page: "https://docs.bigmodel.cn/cn/coding-plan/overview", enabled: true },

  { id: "N01", column: "event", parser: "openai_changelog", vendor: "OpenAI", label: "API 更新日志", url: "https://developers.openai.com/api/docs/changelog.md", page: "https://developers.openai.com/api/docs/changelog", enabled: true },
  { id: "N02", column: "event", parser: "rss", vendor: "OpenAI", label: "新闻", url: "https://openai.com/news/rss.xml", page: "https://openai.com/news", enabled: true },
  { id: "N03", column: "event", parser: "statuspage_json", vendor: "OpenAI", label: "服务状态", url: "https://status.openai.com/api/v2/summary.json", page: "https://status.openai.com", enabled: true },
  { id: "N04", column: "event", parser: "claude_release_notes", vendor: "Anthropic", label: "Claude Platform 发布说明", url: "https://platform.claude.com/docs/en/release-notes/overview.md", page: "https://platform.claude.com/docs/en/release-notes/overview", enabled: true },
  { id: "N05", column: "event", parser: "claude_code_changelog", vendor: "Anthropic", label: "Claude Code 更新日志", url: "https://code.claude.com/docs/en/changelog.md", page: "https://code.claude.com/docs/en/changelog", enabled: true },
  { id: "N06", column: "event", parser: "anthropic_news", vendor: "Anthropic", label: "新闻", url: "https://www.anthropic.com/news", page: "https://www.anthropic.com/news", enabled: true },
  { id: "N07", column: "event", parser: "statuspage_html", vendor: "Anthropic", label: "服务状态", url: "https://status.claude.com/", page: "https://status.claude.com/", enabled: true },
  { id: "N08", column: "event", parser: "gemini_changelog", vendor: "Google", label: "Gemini API 发布说明", url: "https://aistudio.google.com/docs/changelog.md", page: "https://ai.google.dev/gemini-api/docs/changelog", enabled: true },
  { id: "N09", column: "event", parser: "rss", vendor: "Google", label: "DeepMind 博客", url: "https://deepmind.google/blog/rss.xml", page: "https://deepmind.google/blog/", enabled: true },
  { id: "N10", column: "event", parser: "deepseek_updates", vendor: "DeepSeek", label: "Change Log", url: "https://api-docs.deepseek.com/updates/", page: "https://api-docs.deepseek.com/updates/", enabled: true },
  { id: "N11", column: "event", parser: "kimi_changelog", vendor: "月之暗面", label: "平台发布记录", url: "https://platform.kimi.com/docs/changelog.md", page: "https://platform.kimi.com/docs/changelog", enabled: true },
  { id: "N12", column: "event", parser: "zhipu_releases", vendor: "智谱", label: "模型与产品发布记录", url: "https://docs.bigmodel.cn/cn/update/new-releases.md", page: "https://docs.bigmodel.cn/cn/update/new-releases", enabled: true },

  { id: "R01", column: "rank", parser: "lmarena_dataset", vendor: "LMArena", label: "Text Arena 总榜", url: "https://datasets-server.huggingface.co/rows?dataset=lmarena-ai/leaderboard-dataset&config=text&split=latest&offset=0&length=100", page: "https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset", enabled: true },
  { id: "R02", column: "rank", parser: "swebench", vendor: "SWE-bench", label: "Verified", url: "https://www.swebench.com/", page: "https://www.swebench.com/", enabled: true },
  { id: "R03", column: "rank", parser: "artificial_analysis", vendor: "Artificial Analysis", label: "Intelligence Index", url: "https://artificialanalysis.ai/leaderboards/models", page: "https://artificialanalysis.ai/leaderboards/models", enabled: true },

  { id: "H01", column: "hot", parser: "github_trending", vendor: "GitHub", label: "Trending", url: "https://github.com/trending", page: "https://github.com/trending", enabled: true },
  { id: "H02", column: "hot", parser: "hf_trending", vendor: "Hugging Face", label: "模型趋势", url: "https://huggingface.co/api/models?sort=trendingScore&limit=30", page: "https://huggingface.co/models?sort=trending", enabled: true },
  { id: "H03", column: "hot", parser: "kaggle_competitions", vendor: "Kaggle", label: "竞赛", url: "https://www.kaggle.com/api/v1/competitions/list?sortBy=latestDeadline", page: "https://www.kaggle.com/competitions", enabled: false, needs: "kaggle" },
];

export function sourceById(id: string): SourceDef | undefined {
  return SOURCES.find((source) => source.id === id);
}

export function sourcesFor(column: ColumnKind): SourceDef[] {
  return SOURCES.filter((source) => source.column === column);
}
