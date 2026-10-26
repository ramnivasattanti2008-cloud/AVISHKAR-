"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api, describeError } from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { ResilienceReport } from "@/lib/types";
import { useAuth } from "../AuthProvider";
import { ProvenanceDetails, StatusBadge } from "../Provenance";
import { PropertyTabs } from "../property/PropertyTabs";
import { usePropertyData } from "../property/usePropertyData";

function Figure({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`num ${strong ? "text-3xl" : "text-lg"} font-semibold`}>{value}</dd>
      {hint && <dd className="text-xs text-muted">{hint}</dd>}
    </div>
  );
}

const hours = (h: number, atLeast = false): string => `${atLeast ? "at least " : ""}${formatNumber(h)} h`;

/** How long the critical load would last in an outage, and how autonomous the latest plan is (spec sections 26 and 34). */
export function ResilienceView({ id }: { id: string }) {
  const { user, loading: authLoading } = useAuth();
  const { property, loading, error, notFound } = usePropertyData(id);
  const [report, setReport] = useState<ResilienceReport | null>(null);
  const [failure, setFailure] = useState<{ message: string; missingCritical: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState("4");
  const [soc, setSoc] = useState("");
  const ready = Boolean(user && property);

  const fetchReport = useCallback((targetHours: number, startSocPercent: number | null) => api<ResilienceReport>(`/api/properties/${id}/resilience`, { query: { targetHours, startSocPercent } }), [id]);
  const toFailure = (e: unknown) => {
    const d = e instanceof ApiError ? (e.details as { missing?: { what: string; why: string }[] } | undefined) : undefined;
    return { message: describeError(e), missingCritical: Boolean(d?.missing?.some((m) => m.what === "critical")) };
  };

  // the first answer, with the defaults, when the page opens
  useEffect(() => {
    if (!ready) return;
    let live = true;
    fetchReport(4, null)
      .then((r) => live && setReport(r))
      .catch((e) => live && setFailure(toFailure(e)));
    return () => {
      live = false;
    };
  }, [ready, fetchReport]);

  async function run() {
    const t = Number(target);
    const pct = soc.trim() === "" ? null : Number(soc);
    if (!(t >= 1 && t <= 24)) return setFailure({ message: "The time you want the critical load to last must be between 1 and 24 hours.", missingCritical: false });
    if (pct !== null && !(pct >= 0 && pct <= 100)) return setFailure({ message: "The battery charge must be between 0 and 100 percent, or left empty if you do not know it.", missingCritical: false });
    setBusy(true);
    setFailure(null);
    try {
      setReport(await fetchReport(t, pct));
    } catch (e) {
      setReport(null);
      setFailure(toFailure(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading || authLoading) return <p role="status" className="p-6 text-sm text-muted">Loading…</p>;
  if (!user || notFound) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold">Property not found</h1>
        <p className="mt-3 text-muted">
          {user ? "This property does not exist or is not yours." : "Sign in to see resilience."}{" "}
          <Link className="font-semibold text-accent underline" href={user ? "/properties" : `/login?next=/property/${id}/resilience`}>
            {user ? "Back to your properties" : "Sign in"}
          </Link>
        </p>
      </div>
    );
  }
  if (error || !property) return <p role="alert" className="p-6 text-sm text-[color:var(--tone-unavailable-fg)]">{error ?? "Could not load the property."}</p>;

  const r = report?.resilience.value;
  const a = report?.autonomy.value;
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <header>
        <h1 className="text-2xl font-bold">{property.name}</h1>
        <p className="text-sm text-muted">If the grid fails, and how much of your energy comes from the grid</p>
      </header>
      <div className="mt-4"><PropertyTabs id={id} current="/resilience" demo={property.isDemo} /></div>

      <section className="card mt-4 p-4" aria-label="Ask about an outage">
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <div>
            <label htmlFor="res-target" className="text-sm font-medium">I want the critical load to last, hours</label>
            <input id="res-target" className="field mt-1" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
          </div>
          <div>
            <label htmlFor="res-soc" className="text-sm font-medium">Battery charge now, % (optional)</label>
            <input id="res-soc" className="field mt-1" inputMode="decimal" placeholder="not known" value={soc} onChange={(e) => setSoc(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Working it out…" : "Work it out"}</button>
        </form>
        <p className="mt-2 text-sm text-muted">This does not predict an outage. It answers: if the grid failed at the start of the next hour, how long would your critical appliances be served?</p>
      </section>

      <div aria-live="polite" className="mt-3">
        {(busy || (ready && !report && !failure)) && <p role="status" className="text-sm text-muted">Working it out from your battery and the sun forecast…</p>}
        {failure && (
          <div role="alert" className="rounded-md bg-[color:var(--tone-unavailable-bg)] p-3 text-sm text-[color:var(--tone-unavailable-fg)]">
            <p>{failure.message}</p>
            {failure.missingCritical && (
              <p className="mt-2"><Link className="font-semibold underline" href={`/property/${id}/assets`}>Mark critical appliances on the Assets tab</Link></p>
            )}
          </div>
        )}
      </div>

      {report && r && (
        <>
          <section className="card mt-4 p-4" aria-labelledby="backup">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="backup" className="text-lg font-semibold">If the grid failed now</h2>
              <StatusBadge status={report.resilience.provenance.status} />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Figure label="Resilience score" value={`${r.score} / 100`} strong hint="out of 24 hours of cover" />
              <Figure label="With the forecast sun" value={hours(r.backupHours.withForecastSun, r.backupHours.atLeast)} hint="the battery and the sun together" />
              <Figure label="Battery alone" value={hours(r.backupHours.withoutSun)} hint="as at night or under heavy cloud" />
              <Figure label="Critical load" value={`${formatNumber(r.criticalKw)} kW`} hint={r.criticalLoads.map((l) => `${l.quantity > 1 ? `${l.quantity} × ` : ""}${l.name}`).join(", ")} />
            </dl>
            <p className="mt-3 text-sm text-muted">{r.scoreMethod}</p>
            {r.battery && (
              <p className="mt-2 text-sm">
                The battery holds <span className="num">{formatNumber(r.battery.usableKwh)} kWh</span> usable and starts at <span className="num">{formatNumber(r.battery.startSocKwh)} kWh</span>
                {r.battery.startSocBasis === "ASSUMPTION" ? " (assumed: enter the real charge above for an answer that fits tonight)" : " (as you entered it)"}.
              </p>
            )}
            {!r.battery && <p className="mt-2 text-sm">There is no battery, so the critical load is not served when the grid is down. A battery with an inverter that can run the home on its own is what gives backup.</p>}
            <div className="mt-2"><ProvenanceDetails p={report.resilience.provenance} /></div>
          </section>

          {r.recommendedReserve && (
            <section className="card mt-4 p-4" aria-labelledby="reserve">
              <h2 id="reserve" className="text-lg font-semibold">The reserve to keep</h2>
              <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Figure label={`To last ${formatNumber(r.recommendedReserve.targetHours)} h with no sun`} value={`${formatNumber(r.recommendedReserve.reserveKwh)} kWh`} hint={`${formatNumber(r.recommendedReserve.reservePercentOfCapacity)}% of the battery`} />
                <Figure label="Kept back now" value={`${formatNumber(r.recommendedReserve.currentReserveKwh)} kWh`} />
                <Figure label="To add" value={r.recommendedReserve.gapKwh > 0.005 ? `${formatNumber(r.recommendedReserve.gapKwh)} kWh` : "nothing"} hint={r.recommendedReserve.gapKwh > 0.005 ? "to hold back, on top of what is" : "the reserve already covers it"} />
                <Figure label="Longest possible" value={hours(r.recommendedReserve.longestPossibleHours)} hint="the full battery, no sun" />
              </dl>
              {!r.recommendedReserve.feasible && (
                <p role="status" className="mt-3 rounded-md bg-[color:var(--tone-updated-bg)] p-3 text-sm text-[color:var(--tone-updated-fg)]">
                  This battery cannot hold {formatNumber(r.recommendedReserve.targetHours)} hours of the critical load: the most it can carry with no sun is about {formatNumber(r.recommendedReserve.longestPossibleHours)} hours.
                </p>
              )}
            </section>
          )}
        </>
      )}

      {report && (
        <section className="card mt-4 p-4" aria-labelledby="autonomy">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="autonomy" className="text-lg font-semibold">Autonomy</h2>
            <StatusBadge status={report.autonomy.provenance.status} />
          </div>
          {a ? (
            <>
              <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-5">
                <Figure label="Autonomy score" value={`${a.score} / 100`} strong hint={`${formatNumber(a.parts.gridDependencyPercent)}% from the grid`} />
                <Figure label="Energy used" value={`${formatNumber(a.parts.consumedKwh)} kWh`} />
                <Figure label="Solar put to use" value={`${formatNumber(a.parts.solarUsedKwh)} kWh`} />
                <Figure label="Released by the battery" value={`${formatNumber(a.parts.batteryReleasedKwh)} kWh`} />
                <Figure label="Bought from the grid" value={`${formatNumber(a.parts.boughtKwh)} kWh`} />
              </dl>
              <p className="mt-3 text-sm text-muted">{a.methodology}</p>
              <p className="mt-1 text-sm text-muted">From the plan made {formatDateTime(a.planMadeAt)}. {a.criticalCoverageHours !== null && `Critical load cover if the grid failed now: ${formatNumber(a.criticalCoverageHours)} h.`}</p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">
              {report.autonomy.provenance.notes.at(-1)} <Link className="font-semibold text-accent underline" href={`/property/${id}/plan`}>Make a plan</Link>
            </p>
          )}
          <div className="mt-2"><ProvenanceDetails p={report.autonomy.provenance} /></div>
        </section>
      )}

      {report && (
        <section className="card mt-4 p-4" aria-label="What this does not know">
          <h2 className="text-base font-semibold">Grid outage risk</h2>
          <p role="note" className="mt-1 text-sm">
            <span className="badge" data-tone="unavailable">UNAVAILABLE</span> {report.outageRisk.reason}
          </p>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-medium">{report.assumptions.length} assumptions</summary>
            <ul className="mt-2 list-disc pl-5 text-muted">
              {report.assumptions.map((x) => <li key={x}>{x}</li>)}
            </ul>
          </details>
          {report.notes.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-sm text-muted">
              {report.notes.map((x) => <li key={x}>{x}</li>)}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
