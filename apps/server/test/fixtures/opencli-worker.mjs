import process from "node:process";
import { setTimeout } from "node:timers";

process.on("disconnect", () => process.exit(0));
let calls = 0;
process.on("message", (request) => {
  calls += 1;
  if (request.keyword === "hang" || (request.operation === "login" && request.sites.includes("hang"))) return;
  if (request.keyword === "crash") process.exit(2);
  const reply = () => process.send({ id: request.id, data: { pid: process.pid, hasModelKey: Boolean(process.env.OPENAI_API_KEY), hasDatabaseSecret: Boolean(process.env.DATABASE_URL), calls } });
  if (request.keyword === "delay") { setTimeout(reply, 200); return; }
  reply();
  if (request.keyword === "idle-exit") setTimeout(() => process.exit(0), 30);
});
