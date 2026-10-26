"use client";

import { useEffect, useState } from "react";
import { api, describeError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { SystemHealth } from "@/lib/types";

const TONE = { healthy: "live", degraded: "updated", down: "unavailable", unknown: "reference" } as const;

/** Spec section 69: honest health. "unknown" means no recent traffic, which is not the same as healthy. */
export default function SystemPage() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      api<SystemHealth>("/api/system/health")
        .then((h) => live && (setHealth(h), setError(null)))
        .catch((e) => live && setError(describeError(e)));
    load();
    const t = setInterval(load, 15_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-bold">System status</h1>
      <p className="mt-1 text-sm text-muted">Computed from the calls AVISHKAR actually made in the last {health?.windowMinutes ?? 15} minutes. A provider with no recent calls is shown as unknown, never as healthy.</p>
      {error && (
        <p role="alert" className="mt-4 rounded-md bg-[color:var(--tone-unavailable-bg)] p-3 text-sm text-[color:var(--tone-unavailable-fg)]">
          {error}
        </p>
      )}
      {health && (
        <>
          <div className="card mt-6 flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <div className="text-sm text-muted">Database</div>
              <div className="font-semibold">
                {health.database.state === "healthy" ? `PostgreSQL with PostGIS ${health.database.postgis ?? ""}` : "Not reachable"}
              </div>
              {health.database.error && <div className="text-sm text-[color:var(--tone-unavailable-fg)]">{health.database.error}</div>}
            </div>
            <span className="badge" data-tone={health.database.state === "healthy" ? "live" : "unavailable"}>
              {health.database.state.toUpperCase()}
            </span>
          </div>
          <table className="card mt-4 w-full border-separate border-spacing-0 overflow-hidden text-sm">
            <caption className="sr-only">External data providers</caption>
            <thead>
              <tr className="bg-surface2 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2">Provider</th>
                <th className="px-4 py-2">State</th>
                <th className="px-4 py-2 text-right">Calls</th>
                <th className="px-4 py-2 text-right">Failed</th>
                <th className="px-4 py-2 text-right">p50</th>
                <th className="px-4 py-2 text-right">p95</th>
                <th className="px-4 py-2">Last error</th>
              </tr>
            </thead>
            <tbody>
              {health.providers.map((p) => (
                <tr key={p.provider} className="border-t border-line">
                  <th scope="row" className="px-4 py-2 text-left font-medium">
                    {p.provider}
                  </th>
                  <td className="px-4 py-2">
                    <span className="badge" data-tone={TONE[p.state]}>
                      {p.state.toUpperCase()}
                    </span>
                  </td>
                  <td className="num px-4 py-2 text-right">{p.calls}</td>
                  <td className="num px-4 py-2 text-right">{p.failures}</td>
                  <td className="num px-4 py-2 text-right">{p.p50Ms === null ? "—" : `${p.p50Ms} ms`}</td>
                  <td className="num px-4 py-2 text-right">{p.p95Ms === null ? "—" : `${p.p95Ms} ms`}</td>
                  <td className="px-4 py-2 text-muted">{p.lastError ? `${p.lastError} (${p.lastErrorAt ? formatDateTime(p.lastErrorAt) : ""})` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted">Updated {formatDateTime(health.generatedAt)}. This page refreshes every 15 seconds.</p>
        </>
      )}
    </div>
  );
}
