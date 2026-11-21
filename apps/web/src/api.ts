export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new Error("无法连接服务器，请检查服务是否正在运行。");
  }
  const body = await response.json().catch(() => null) as (T & { error?: { message?: unknown } }) | null;
  if (!response.ok) throw new Error(typeof body?.error?.message === "string" ? body.error.message : "请求没有完成。");
  if (body === null) throw new Error("服务器没有返回可用数据，请稍后重试。");
  return body;
}
