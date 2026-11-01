import { OpenCliRuntime } from "./runtime.js";
import type { WorkerReply, WorkerRequest } from "./protocol.js";

const runtime = new OpenCliRuntime();
let chain = Promise.resolve();

process.on("disconnect", () => process.exit(0));
process.on("message", (request: WorkerRequest) => {
  // 上游执行器有全局会话状态，同一常驻进程内串行执行，隔离不同主题。
  chain = chain.then(async () => {
    const reply: WorkerReply = { id: request.id };
    try {
      switch (request.operation) {
        case "catalog": reply.data = await runtime.catalog(); break;
        case "search": reply.data = await runtime.search(request.command, request.keyword); break;
        case "login": reply.data = await runtime.login(request.sites); break;
        default: throw new Error("不支持的采集动作。");
      }
    } catch (error) {
      reply.error = error instanceof Error ? error.message : "采集进程执行失败。";
    }
    if (process.connected) process.send?.(reply);
  }).catch(() => undefined);
});
