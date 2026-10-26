import type { Db } from "../db.js";

export interface ProviderCallRecord {
  provider: string;
  operation: string;
  ok: boolean;
  statusCode?: number;
  latencyMs: number;
  error?: string;
  requestId?: string;
}

export interface CallRecorder {
  record(r: ProviderCallRecord): Promise<void>;
}

export class NoopRecorder implements CallRecorder {
  async record(): Promise<void> {}
}

export class MemoryRecorder implements CallRecorder {
  readonly calls: ProviderCallRecord[] = [];
  async record(r: ProviderCallRecord): Promise<void> {
    this.calls.push(r);
  }
}

/** Writes every call to provider_calls (spec sections 69, 72). Telemetry must never break the request, so errors are swallowed. */
export class DbRecorder implements CallRecorder {
  constructor(
    private readonly db: Db,
    private readonly onError?: (e: unknown) => void,
  ) {}
  async record(r: ProviderCallRecord): Promise<void> {
    try {
      await this.db.providerCall.create({
        data: {
          provider: r.provider,
          operation: r.operation,
          ok: r.ok,
          statusCode: r.statusCode,
          latencyMs: Math.max(0, Math.round(r.latencyMs)),
          error: r.error?.slice(0, 500),
          requestId: r.requestId,
        },
      });
    } catch (e) {
      this.onError?.(e);
    }
  }
}

export type ProviderState = "healthy" | "degraded" | "down" | "unknown";

export interface ProviderHealth {
  provider: string;
  state: ProviderState;
  calls: number;
  failures: number;
  p50Ms: number | null;
  p95Ms: number | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
}

const pct = (sorted: number[], q: number): number | null =>
  sorted.length ? (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? null) : null;

/** Summarise recent calls. No calls in the window means "unknown", never "healthy" (we do not guess). */
export function summariseHealth(
  provider: string,
  calls: { ok: boolean; latencyMs: number; error: string | null; createdAt: Date }[],
): ProviderHealth {
  const failures = calls.filter((c) => !c.ok).length;
  const lat = calls.map((c) => c.latencyMs).sort((a, b) => a - b);
  const newestFirst = (a: { createdAt: Date }, b: { createdAt: Date }) => b.createdAt.getTime() - a.createdAt.getTime();
  const ok = calls.filter((c) => c.ok).sort(newestFirst)[0];
  const bad = calls.filter((c) => !c.ok).sort(newestFirst)[0];
  let state: ProviderState = "unknown";
  if (calls.length) {
    state = failures === 0 ? "healthy" : failures === calls.length ? "down" : failures / calls.length >= 0.2 ? "degraded" : "healthy";
  }
  return {
    provider,
    state,
    calls: calls.length,
    failures,
    p50Ms: pct(lat, 0.5),
    p95Ms: pct(lat, 0.95),
    lastSuccessAt: ok?.createdAt.toISOString() ?? null,
    lastErrorAt: bad?.createdAt.toISOString() ?? null,
    lastError: bad?.error ?? null,
  };
}

export async function providerHealth(db: Db, providers: string[], windowMinutes = 15, now = new Date()): Promise<ProviderHealth[]> {
  const since = new Date(now.getTime() - windowMinutes * 60_000);
  const rows = await db.providerCall.findMany({
    where: { createdAt: { gte: since } },
    select: { provider: true, ok: true, latencyMs: true, error: true, createdAt: true },
  });
  return providers.map((p) =>
    summariseHealth(
      p,
      rows.filter((r) => r.provider === p),
    ),
  );
}
