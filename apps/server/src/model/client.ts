import type { ChatMessage, ModelClient } from "../types.js";

export function rejectSecretArgv(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): void {
  const key = env.OPENAI_API_KEY ?? "";
  for (const arg of argv) {
    const lowered = arg.toLowerCase();
    if (lowered.includes("openai_api_key=") || lowered.startsWith("--api-key") || lowered.startsWith("--apikey") || /^bearer\s+\S+/i.test(arg)) {
      throw new Error("密钥只能放在环境变量里，不能写进启动命令。");
    }
    if (key.length >= 8 && arg.includes(key)) throw new Error("密钥只能放在环境变量里，不能写进启动命令。");
  }
}

export function envModel(fetchImpl: typeof fetch = fetch): ModelClient {
  const key = process.env.OPENAI_API_KEY ?? "";
  const model = process.env.OPENAI_MODEL ?? "";
  const base = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  return {
    available: Boolean(key && model),
    async complete(messages: ChatMessage[]) {
      if (!key || !model) throw new Error("MODEL_UNAVAILABLE");
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetchImpl(`${base}/chat/completions`, {
            method: "POST",
            headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
            body: JSON.stringify({ model, temperature: 0, messages, response_format: { type: "json_object" } }),
          });
          if (!response.ok) throw new Error(`model ${response.status}`);
          const payload = await response.json() as { choices?: { message?: { content?: string } }[] };
          const content = payload.choices?.[0]?.message?.content;
          if (!content) throw new Error("empty model");
          return content;
        } catch (error) {
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
      throw lastError instanceof Error ? lastError : new Error("model");
    },
  };
}
