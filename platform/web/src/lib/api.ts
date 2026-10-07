/**
 * The only way the web app talks to the AVISHKAR API. Same-origin (/api is proxied, see next.config.ts), so the HttpOnly
 * session cookie travels automatically and the CSRF token is echoed from its readable cookie on state-changing calls.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function readCookie(name: string, cookieString?: string): string | undefined {
  const source = cookieString ?? (typeof document === "undefined" ? "" : document.cookie);
  for (const part of source.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

type Query = Record<string, string | number | boolean | undefined | null>;

export interface ApiInit {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
}

function url(path: string, query?: Query): string {
  if (!query) return path;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) q.set(k, String(v));
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = { accept: "application/json" };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") {
    const csrf = readCookie("avk_csrf");
    if (csrf) headers["x-csrf-token"] = csrf;
  }
  let res: Response;
  try {
    res = await fetch(url(path, init.query), { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), credentials: "same-origin", signal: init.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "NETWORK", "Could not reach the AVISHKAR server. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string; details?: unknown; requestId?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? "HTTP_ERROR", err?.message ?? `The server answered ${res.status}.`, err?.details, err?.requestId);
  }
  return body as T;
}

/** A readable one-liner for any error, for banners. */
export function describeError(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}
