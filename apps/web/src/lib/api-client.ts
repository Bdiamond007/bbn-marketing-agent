/** Client de l'API /api/v1 côté navigateur. Les cookies de session sont gérés par le navigateur (HttpOnly). */
export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; code: string; messageKey: string; requestId: string | null; fields: string[] };

export async function api<T = unknown>(path: string, init: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown } = {}): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      credentials: "same-origin",
      headers: init.body === undefined ? {} : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    return { ok: false, status: 0, code: "network", messageKey: "errors.network", requestId: null, fields: [] };
  }
  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  // 204 sans corps : succès explicite (objet vide), jamais confondu avec un échec.
  if (res.ok) return { ok: true, status: res.status, data: (json ?? {}) as T };
  const err = (json?.error ?? {}) as { code?: string; messageKey?: string; requestId?: string; details?: { fields?: string[] } };
  return {
    ok: false,
    status: res.status,
    code: err.code ?? "internal_error",
    messageKey: err.messageKey ?? "errors.generic",
    requestId: err.requestId ?? null,
    fields: err.details?.fields ?? [],
  };
}
