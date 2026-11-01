import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { WorkerAction, WorkerReply } from "./protocol.js";
import { commandEnvironment } from "./runner.js";

export class WorkerClient {
  private child?: ChildProcess;
  private id = 0;
  private tail = Promise.resolve();
  private closed = false;
  private queued = 0;
  private rejectActive?: (error: Error) => void;

  constructor(private readonly entry = new URL("./worker.ts", import.meta.url)) {}

  request<T>(request: WorkerAction, timeoutMs: number, refresh = false): Promise<T> {
    if (this.queued >= 64) return Promise.reject(new Error("采集队列已满，请稍后重试。"));
    this.queued += 1;
    const deadline = Date.now() + timeoutMs;
    let expired = false;
    let queueTimer: ReturnType<typeof setTimeout>;
    const waiting = new Promise<never>((_resolve, reject) => {
      queueTimer = setTimeout(() => {
        expired = true;
        reject(new Error("采集排队超时，已取消，没有执行。"));
      }, timeoutMs);
    });
    const result = this.tail.then(() => {
      clearTimeout(queueTimer);
      if (expired || Date.now() >= deadline) throw new Error("采集排队超时，已取消，没有执行。");
      if (this.closed) throw new Error("采集进程已经关闭。");
      if (refresh) this.stop();
      return this.send<T>(request, deadline - Date.now());
    });
    const tracked = result.finally(() => { clearTimeout(queueTimer); this.queued -= 1; });
    this.tail = tracked.then(() => undefined, () => undefined);
    return Promise.race([tracked, waiting]);
  }

  private send<T>(request: WorkerAction, timeoutMs: number): Promise<T> {
    const child = this.child ?? fork(fileURLToPath(this.entry), [], {
      execArgv: ["--import", "tsx"], windowsHide: true,
      env: commandEnvironment(process.env), stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    if (!this.child) {
      this.child = child;
      const release = () => { if (this.child === child) this.child = undefined; };
      child.on("exit", release);
      child.on("error", release);
    }
    return new Promise<T>((resolve, reject) => {
      const id = ++this.id;
      let settled = false;
      const finish = (error?: Error, data?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.off("message", onMessage);
        child.off("exit", onExit);
        child.off("error", onError);
        this.rejectActive = undefined;
        if (error) reject(error);
        else resolve(data as T);
      };
      const onMessage = (reply: WorkerReply) => {
        if (reply.id === id) finish(reply.error ? new Error(reply.error) : undefined, reply.data);
      };
      const onExit = () => { if (this.child === child) this.child = undefined; finish(new Error("采集进程意外退出；下次请求会重新启动。")); };
      const onError = () => { if (settled) return; this.stop(); finish(new Error("无法启动采集进程，请检查项目依赖。")); };
      const timer = setTimeout(() => {
        this.stop();
        finish(new Error("采集进程超时，已终止；没有自动重跑。"));
      }, timeoutMs);
      this.rejectActive = (error) => finish(error);
      child.on("message", onMessage);
      child.once("exit", onExit);
      child.once("error", onError);
      child.send({ ...request, id }, (error) => { if (error) onError(); });
    });
  }

  private stop() {
    const child = this.child;
    this.child = undefined;
    child?.kill();
  }

  close() {
    this.closed = true;
    this.rejectActive?.(new Error("采集进程已经关闭。"));
    this.stop();
  }
}
