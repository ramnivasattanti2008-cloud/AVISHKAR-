"use client";

import { useEffect, useState } from "react";
import { api, describeError } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import type { PlanDrift } from "@/lib/types";

/**
 * How the latest plan's expected demand compares with the meter readings imported for the hours that have passed. Only whole
 * hours fully covered by readings count; a drift beyond the tolerance suggests a new plan, nothing re-plans by itself.
 */
export function DriftPanel({ id, planId }: { id: string; planId: string }) {
  const [state, setState] = useState<{ planId: string; drift: PlanDrift | null; error: string | null } | null>(null);

  useEffect(() => {
    let live = true;
    api<PlanDrift>(`/api/properties/${id}/plan/drift`)
      .then((d) => live && setState({ planId, drift: d, error: null }))
      .catch((e) => live && setState({ planId, drift: null, error: describeError(e) }));
    return () => {
      live = false;
    };
  }, [id, planId]);

  const current = state?.planId === planId ? state : null;
  const d = current?.drift;
  return (
    <section className="card mt-4 p-4" aria-label="Plan against the meter">
      <h2 className="text-base font-semibold">Plan against the meter</h2>
      {!current && <p role="status" className="mt-1 text-sm text-muted">Comparing with your readings…</p>}
      {current?.error && <p role="alert" className="mt-1 text-sm text-[color:var(--tone-unavailable-fg)]">{current.error}</p>}
      {d && d.planId === planId && (
        <>
          <p className={`mt-1 text-sm ${d.replanRecommended ? "font-semibold text-[color:var(--tone-updated-fg)]" : "text-muted"}`}>{d.reason}</p>
          {d.plannedKwh !== null && d.observedKwh !== null && (
            <dl className="mt-2 grid grid-cols-3 gap-4 text-sm">
              <div>
                <dt className="text-xs text-muted">Planned</dt>
                <dd className="num font-semibold">{formatNumber(d.plannedKwh)} kWh</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Metered</dt>
                <dd className="num font-semibold">{formatNumber(d.observedKwh)} kWh</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Hours compared</dt>
                <dd className="num font-semibold">{d.hoursCompared}</dd>
              </div>
            </dl>
          )}
        </>
      )}
      {d && d.planId !== planId && d.status !== "NO_PLAN" && <p className="mt-1 text-sm text-muted">This is an earlier plan; only the latest plan is compared with the meter.</p>}
    </section>
  );
}
