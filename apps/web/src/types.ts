export type Kind = "hot" | "price" | "rank" | "event";

export type RunStatus = "ok" | "没抽出" | "skipped" | "failed";

export interface RunRecord {
  sourceId: string;
  startedAt: string;
  status: RunStatus;
  httpStatus: number | null;
  error: string;
  bytes: number;
  extracted: number;
  cleaned: number;
  stored: number;
  changed: number;
  rejected: number;
  reasons: Record<string, number>;
}

export interface SourceView {
  id: string;
  vendor: string;
  label: string;
  column: Kind;
  url: string;
  page: string;
  enabled: boolean;
  needs: string;
  run: RunRecord | null;
}

export interface RunState { state: "idle" | "running"; done: number; total: number; current: string; error: string }

interface RowBase { id: number; sourceId: string; fetchedAt: string; excerpt: string }

export interface PriceView extends RowBase {
  vendor: string;
  page: string;
  kind: "api" | "plan";
  product: string;
  tier: string;
  metric: string;
  condition: string;
  price: string;
  amount: number | null;
  currency: "USD" | "CNY" | "";
  unit: string;
  quota: string;
  reset: string;
}

export interface RankView extends RowBase {
  board: string;
  page: string;
  rank: number;
  model: string;
  org: string;
  score: string;
  votes: string;
  boardDate: string;
}

export interface HotView extends RowBase {
  site: string;
  rank: number;
  title: string;
  url: string;
  heat: string;
  summary: string;
}

export type EventType = "release" | "news" | "status" | "incident" | "cn_access";

export interface EventView extends RowBase {
  vendor: string;
  type: EventType;
  title: string;
  date: string;
  detail: string;
  url: string;
}

export interface DiffView {
  id: number;
  sourceId: string;
  column: Kind;
  vendor: string;
  label: string;
  field: string;
  oldValue: string;
  newValue: string;
  fetchedAt: string;
}

export const COLUMN_TITLES: Record<Kind, string> = { hot: "热榜", price: "价目表", rank: "排名", event: "厂商动态" };

export function eventTypeName(type: EventType): string {
  switch (type) {
    case "release":
      return "发布";
    case "news":
      return "新闻";
    case "status":
      return "状态";
    case "incident":
      return "事故";
    case "cn_access":
      return "中国大陆";
    default: {
      const unreachable: never = type;
      return unreachable;
    }
  }
}

export function statusName(run: RunRecord | null, enabled: boolean): string {
  if (!run) return enabled ? "未跑" : "未启用";
  switch (run.status) {
    case "ok":
      return `${run.stored} 行`;
    case "没抽出":
      return "没抽出";
    case "skipped":
      return "跳过";
    case "failed":
      return "失败";
    default: {
      const unreachable: never = run.status;
      return unreachable;
    }
  }
}

export function clock(iso: string): string {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return "—";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
