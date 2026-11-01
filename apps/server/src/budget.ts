import type { AppDeps } from "./types.js";

export const PHASES = ["采集", "清洗去重", "聚类", "分析", "成稿"] as const;
export type PhaseName = (typeof PHASES)[number];

const DEFAULT_LIMITS = {
  chatTokens: 6_000,
  chatWallMs: 45_000,
  jobSteps: 24,
  jobWallMs: 4 * 60 * 1000,
};

export interface RunLimits {
  chatTokens: number;
  chatWallMs: number;
  jobSteps: number;
  jobWallMs: number;
}

export function limitsOf(deps: AppDeps): RunLimits {
  return { ...DEFAULT_LIMITS, ...deps.limits };
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2);
}

export class BudgetStop extends Error {
  readonly phase: string;
  readonly reason: string;

  constructor(phase: string, reason: string) {
    super(`已停在${phase}·${reason}`);
    this.name = "BudgetStop";
    this.phase = phase;
    this.reason = reason;
  }
}

export function isPhaseName(value: string): value is PhaseName {
  switch (value) {
    case "采集":
    case "清洗去重":
    case "聚类":
    case "分析":
    case "成稿":
      return true;
    default:
      return false;
  }
}

export function withDeadline<T>(work: Promise<T>, ms: number, phase: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new BudgetStop(phase, "超过时间上限")), ms);
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
