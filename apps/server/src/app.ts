import { Hono } from "hono";
import { HttpError } from "./http-error.js";
import { mountLedger } from "./ledger/http.js";
import type { AppDeps } from "./types.js";

export function createApp(deps: AppDeps) {
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof HttpError) return c.json({ error: { code: error.code, message: error.message } }, error.status);
    console.error(error);
    return c.json({ error: { code: "JOB_FAILED", message: "这一次没有完成。" } }, 500);
  });

  app.get("/api/health", (c) => c.json({ ok: true }));
  mountLedger(app, deps);
  return app;
}
