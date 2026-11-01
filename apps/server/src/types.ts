export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(argv: readonly string[], timeoutMs: number): Promise<CommandResult>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelClient {
  available: boolean;
  complete(messages: ChatMessage[]): Promise<string>;
}

export interface RawItem {
  title: string;
  url: string;
  platform: string;
  publishedAt: string;
  summary: string;
}

export interface BrowserRecipe {
  id: string;
  site: string;
  label: string;
  searchUrl(keyword: string): string;
  normalize(text: string, pageUrl: string, platform: string): RawItem[];
}

export interface AppDeps {
  dataDir: string;
  topicsRoot: string;
  runner: CommandRunner;
  model: ModelClient;
  now: () => Date;
  timeZone: string;
  openFolder: (folder: string) => Promise<void>;
  pickFolder: () => Promise<string | null>;
  recipes: BrowserRecipe[];
  fetchImpl: typeof fetch;
  limits?: {
    chatTokens?: number;
    chatWallMs?: number;
    jobSteps?: number;
    jobWallMs?: number;
  };
}

export const THEME_FILE = "主题.md";
export const DIR_BRIEF = "简报";
export const DIR_SNAPSHOT = "快照";
export const DIR_NOTE = "笔记";
export const DIR_MATERIAL = "素材";

export const WRITE_VERBS = new Set([
  "post",
  "publish",
  "like",
  "unlike",
  "comment",
  "reply",
  "send",
  "delete",
  "remove",
  "follow",
  "unfollow",
  "star",
  "unstar",
  "bookmark",
  "upload",
  "create",
  "update",
  "edit",
  "subscribe",
  "unsubscribe",
  "share",
  "vote",
]);
