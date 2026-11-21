import type { AppDeps } from "../types.js";

export const BODY_CAP = 24_000;

export function clipBody(body: string): { text: string; truncated: boolean } {
  if (body.length <= BODY_CAP) return { text: body, truncated: false };
  return { text: `${body.slice(0, 16_000)}\n…（中段已省略）…\n${body.slice(-8_000)}`, truncated: true };
}

export function readJsonContent(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  return JSON.parse(trimmed) as unknown;
}

export interface Completion {
  ok: boolean;
  value: unknown;
  error: string;
}

/** 没有密钥、超时或不是 JSON 时返回空结果。错误文案里不带密钥。 */
export async function completeJson(deps: AppDeps, system: string, user: string): Promise<Completion> {
  const key = process.env.OPENAI_API_KEY ?? "";
  if (!key) return { ok: false, value: null, error: "" };
  const base = (process.env.OPENAI_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL || "deepseek-chat";
  try {
    const response = await deps.fetchImpl(`${base}/chat/completions`, {
      method: "POST",
      redirect: "follow",
      signal: AbortSignal.timeout(45_000),
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!response.ok) return { ok: false, value: null, error: "模型没有返回可用结果" };
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return { ok: true, value: readJsonContent(data.choices?.[0]?.message?.content ?? ""), error: "" };
  } catch {
    return { ok: false, value: null, error: "模型没有返回可用结果" };
  }
}
