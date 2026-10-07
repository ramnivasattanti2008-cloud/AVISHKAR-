import type { z } from "zod";
import { AppError } from "../errors.js";
import { EngineHealth, OptimiseResponse, type OptimiseRequest } from "./schemas.js";

export interface EngineOptions {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

interface Ctx {
  requestId?: string;
}

const UNAVAILABLE = "The planning engine is not answering, so plans and model forecasts are unavailable right now.";

/**
 * The only way the API talks to the Python engine. Every failure becomes one of three honest errors, and every reply is
 * validated against its schema: an engine that is down, mis-keyed, rejecting our inputs or speaking a different version never
 * produces a number that looks real.
 */
export class EngineClient {
  constructor(private readonly o: EngineOptions) {}

  async health(ctx: Ctx = {}): Promise<EngineHealth> {
    return this.call("GET", "/health", undefined, EngineHealth, ctx, Math.min(this.o.timeoutMs, 5_000));
  }

  async optimise(req: OptimiseRequest, ctx: Ctx = {}): Promise<OptimiseResponse> {
    return this.call("POST", "/v1/optimise", req, OptimiseResponse, ctx, this.o.timeoutMs);
  }

  private async call<S extends z.ZodType>(method: "GET" | "POST", path: string, body: unknown, schema: S, ctx: Ctx, timeoutMs: number): Promise<z.output<S>> {
    const f = this.o.fetchImpl ?? fetch;
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.o.apiKey) headers["x-engine-key"] = this.o.apiKey;
    if (ctx.requestId) headers["x-request-id"] = ctx.requestId;

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await f(new URL(path, this.o.baseUrl), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
      throw new AppError("ENGINE_UNAVAILABLE", UNAVAILABLE, { reason: timedOut ? `no answer within ${Math.round(timeoutMs / 1000)} s` : "could not connect" });
    } finally {
      clearTimeout(timer);
    }

    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      /* not JSON */
    }
    if (res.status === 401 || res.status === 403) {
      throw new AppError("ENGINE_UNAVAILABLE", `${UNAVAILABLE} (It refused this server's key: check ENGINE_API_KEY on both sides.)`, { reason: "key refused" });
    }
    if (res.status === 400 || res.status === 413) {
      const msg = (payload as { error?: { message?: string } } | null)?.error?.message ?? "no reason given";
      throw new AppError("ENGINE_REJECTED", `The planning engine could not use the inputs: ${msg}`, { reason: msg });
    }
    if (!res.ok) throw new AppError("ENGINE_UNAVAILABLE", UNAVAILABLE, { reason: `engine answered ${res.status}` });

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new AppError("ENGINE_BAD_RESPONSE", "The planning engine answered in a shape this server does not understand: it may be a different version.", {
        issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
    return parsed.data;
  }
}
