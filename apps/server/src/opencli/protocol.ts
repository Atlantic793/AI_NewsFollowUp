import type { CommandHelp } from "./parse.js";

export const OPENCLI_VERSION = "2.0.2";
export const RUNTIME_KEY = `opencli-${OPENCLI_VERSION}-catalog-1`;

export interface AdapterCommand {
  command: string;
  description: string;
  help: CommandHelp;
}

export type WorkerAction =
  | { operation: "catalog" }
  | { operation: "search"; command: string; keyword: string }
  | { operation: "login"; sites: string[] };

export type WorkerRequest = WorkerAction & { id: number };

export interface WorkerReply {
  id: number;
  data?: unknown;
  error?: string;
}
