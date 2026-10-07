import type { z } from "zod";
import { ProviderError } from "../errors.js";
import type { CallRecorder } from "./recorder.js";

export interface HttpOptions {
  provider: string;
  baseUrl: string;
  userAgent: string;
  timeoutMs: number;
  recorder: CallRecorder;
  /** Public providers publish limits (Nominatim: 1 request per second). Calls are spaced at least this far apart. */
  minIntervalMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface RequestOptions<T> {
  schema: z.ZodType<T>;
  /** JSON request body; makes the call a POST. */
  body?: unknown;
  headers?: Record<string, string>;
  requestId?: string;
  /** Overrides the client's base URL for this call (used when one provider has several hosts). */
  baseUrl?: string;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
type Query = Record<string, string | number | boolean | undefined>;

/**
 * Isolated outbound HTTP for one provider: identifying User-Agent, timeout, bounded retries with backoff (honouring
 * Retry-After), spacing between calls, response validation against a schema, and a telemetry record per attempt.
 */
export class ProviderHttp {
  private nextAllowed = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly o: HttpOptions) {
    this.fetchImpl = o.fetchImpl ?? fetch;
    this.sleep = o.sleep ?? defaultSleep;
    this.now = o.now ?? Date.now;
  }

  private async gate(): Promise<void> {
    const gap = this.o.minIntervalMs ?? 0;
    if (!gap) return;
    const t = this.now();
    const start = Math.max(t, this.nextAllowed);
    this.nextAllowed = start + gap;
    if (start > t) await this.sleep(start - t);
  }

  async getJson<T>(operation: string, path: string, query: Query, opts: RequestOptions<T>): Promise<T> {
    return this.request("GET", operation, path, query, opts);
  }

  /** POST a JSON body (for example a STAC search) with the same retry, validation and telemetry as getJson. */
  async postJson<T>(operation: string, path: string, body: unknown, opts: RequestOptions<T>): Promise<T> {
    return this.request("POST", operation, path, {}, { ...opts, body });
  }

  private async request<T>(method: "GET" | "POST", operation: string, path: string, query: Query, opts: RequestOptions<T>): Promise<T> {
    const url = new URL(path.replace(/^\//, ""), (opts.baseUrl ?? this.o.baseUrl).replace(/\/?$/, "/"));
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
    const attempts = 1 + (this.o.retries ?? 2);
    let lastErr: ProviderError | undefined;

    for (let attempt = 0; attempt < attempts; attempt++) {
      await this.gate();
      const started = this.now();
      let status: number | undefined;
      try {
        const res = await this.fetchImpl(url, {
          method,
          headers: {
            "user-agent": this.o.userAgent,
            accept: "application/json",
            ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
            ...opts.headers,
          },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout(this.o.timeoutMs),
        });
        status = res.status;
        if (res.status === 429 || res.status >= 500) {
          const wait = Math.min(5000, Number(res.headers.get("retry-after") ?? 0) * 1000 || 300 * 2 ** attempt);
          lastErr = new ProviderError(this.o.provider, operation, `${this.o.provider} answered HTTP ${res.status}`);
          await this.record(operation, false, status, started, lastErr.message, opts.requestId);
          if (attempt < attempts - 1) await this.sleep(wait);
          continue;
        }
        if (!res.ok) {
          const err = new ProviderError(this.o.provider, operation, `${this.o.provider} answered HTTP ${res.status}`, "PROVIDER_BAD_RESPONSE");
          await this.record(operation, false, status, started, err.message, opts.requestId);
          throw err;
        }
        let body: unknown;
        try {
          body = await res.json();
        } catch (e) {
          const err = new ProviderError(this.o.provider, operation, `${this.o.provider} returned a body that is not JSON`, "PROVIDER_BAD_RESPONSE", e);
          await this.record(operation, false, status, started, err.message, opts.requestId);
          throw err;
        }
        const parsed = opts.schema.safeParse(body);
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          const err = new ProviderError(
            this.o.provider,
            operation,
            `${this.o.provider} response did not match the expected shape at ${first?.path.join(".") || "(root)"}: ${first?.message}`,
            "PROVIDER_BAD_RESPONSE",
          );
          await this.record(operation, false, status, started, err.message, opts.requestId);
          throw err;
        }
        await this.record(operation, true, status, started, undefined, opts.requestId);
        return parsed.data;
      } catch (e) {
        if (e instanceof ProviderError && e.code === "PROVIDER_BAD_RESPONSE") throw e;
        const reason = e instanceof Error && e.name === "TimeoutError" ? `timed out after ${this.o.timeoutMs} ms` : e instanceof Error ? e.message : String(e);
        lastErr = new ProviderError(this.o.provider, operation, `${this.o.provider} unreachable: ${reason}`, "PROVIDER_UNAVAILABLE", e);
        await this.record(operation, false, status, started, lastErr.message, opts.requestId);
        if (attempt < attempts - 1) await this.sleep(Math.min(2000, 300 * 2 ** attempt));
      }
    }
    throw lastErr ?? new ProviderError(this.o.provider, operation, `${this.o.provider} failed`);
  }

  private record(operation: string, ok: boolean, statusCode: number | undefined, started: number, error: string | undefined, requestId?: string) {
    return this.o.recorder.record({ provider: this.o.provider, operation, ok, statusCode, latencyMs: this.now() - started, error, requestId });
  }
}
