export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json() as T & { error?: { message: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "请求没有完成。");
  return body;
}
