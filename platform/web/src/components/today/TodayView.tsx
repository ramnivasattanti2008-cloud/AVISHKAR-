"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, describeError } from "@/lib/api";
import { formatDateTime, formatInr, formatNumber } from "@/lib/format";
import type { Provenance, Today } from "@/lib/types";
import { useAuth } from "../AuthProvider";
import { ProvenanceDetails, StatusBadge } from "../Provenance";
import { PropertyTabs } from "../property/PropertyTabs";
import { usePropertyData } from "../property/usePropertyData";

const RISK_TONE = { LOW: "live", MEDIUM: "updated", HIGH: "unavailable" } as const;

/** One figure with its label, its data status, and the reason when there is none: an UNAVAILABLE value never prints a number. */
function Tile({ title, provenance, value, hint, tone, children }: { title: string; provenance: Provenance; value: string | null; hint?: string; tone?: string; children?: React.ReactNode }) {
  const missing = provenance.status === "UNAVAILABLE" || value === null;
  return (
    <li className="card flex flex-col p-4" aria-label={title}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium text-muted">{title}</h3>
        <StatusBadge status={provenance.status} />
      </div>
      {missing ? (
        <p className="mt-2 text-sm text-muted">{provenance.notes.at(-1) ?? "Not available."}</p>
      ) : (
        <>
          <p className="num mt-1 text-2xl font-semibold" style={tone ? { color: `var(--tone-${tone}-fg)` } : undefined}>{value}</p>
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </>
      )}
      {children}
    </li>
  );
}

/** Where the property stands today and what to do next (spec sections 97 and 98), every figure from the latest stored forecasts and plan. */
export function TodayView({ id }: { id: string }) {
  const { user, loading: authLoading } = useAuth();
  const { property, loading, error, notFound } = usePropertyData(id);
  const [today, setToday] = useState<Today | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const ready = Boolean(user && property);

  useEffect(() => {
    if (!ready) return;
    let live = true;
    api<Today>(`/api/properties/${id}/today`)
      .then((t) => live && setToday(t))
      .catch((e) => live && setFailure(describeError(e)));
    return () => {
      live = false;
    };
  }, [id, ready]);

  if (loading || authLoading) return <p role="status" className="p-6 text-sm text-muted">Loading…</p>;
  if (!user || notFound) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold">Property not found</h1>
        <p className="mt-3 text-muted">
          {user ? "This property does not exist or is not yours." : "Sign in to see today."}{" "}
          <Link className="font-semibold text-accent underline" href={user ? "/properties" : `/login?next=/property/${id}/today`}>
            {user ? "Back to your properties" : "Sign in"}
          </Link>
        </p>
      </div>
    );
  }
  if (error || !property) return <p role="alert" className="p-6 text-sm text-[color:var(--tone-unavailable-fg)]">{error ?? "Could not load the property."}</p>;

  const plan = today?.plan.value;
  const rec = today?.recommendation;
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">Your energy. Understood.</p>
        <h1 className="text-2xl font-bold">{property.name}</h1>
        <p className="text-sm text-muted">{today ? `Today, ${today.localDate}` : "Today"}: where it stands, what is likely next, and what to do</p>
      </header>
      <div className="mt-4"><PropertyTabs id={id} current="/today" demo={property.isDemo} /></div>

      <div aria-live="polite" className="mt-3">
        {failure && <p role="alert" className="text-sm text-[color:var(--tone-unavailable-fg)]">{failure}</p>}
        {!today && !failure && <p role="status" className="text-sm text-muted">Reading the latest forecasts and plan…</p>}
      </div>

      {today && (
        <>
          <h2 className="sr-only">Today at a glance</h2>
          <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Today at a glance">
            <Tile title="Energy autonomy" provenance={today.plan.provenance} value={plan && plan.autonomyScore !== null ? `${plan.autonomyScore} / 100` : null} hint={plan ? "of the energy used, not bought from the grid, in the latest plan" : undefined} />
            <Tile title="Generation today" provenance={today.generation.provenance} value={today.generation.value ? `${formatNumber(today.generation.value.kwh)} kWh` : null} hint={today.generation.value ? `forecast issued ${formatDateTime(today.generation.value.forecastIssuedAt)}` : undefined} />
            <Tile title="Consumption today" provenance={today.consumption.provenance} value={today.consumption.value ? `${formatNumber(today.consumption.value.kwh)} kWh` : null} hint={today.consumption.value ? (today.consumption.value.basis === "FORECAST" ? "from the load forecast" : "your typical day, not a forecast") : undefined} />
            <Tile title="Available surplus" provenance={today.surplus.provenance} value={today.surplus.value ? `${formatNumber(today.surplus.value.kwh)} kWh` : null} hint={today.surplus.value?.note} />
            <Tile title="Weather risk to the sun" provenance={today.weatherRisk.provenance} value={today.weatherRisk.value ? today.weatherRisk.value.level : null} hint={today.weatherRisk.value ? `${today.weatherRisk.value.meanCloudPercent}% cloud over the next ${today.weatherRisk.value.hours} daylight hours` : undefined} tone={today.weatherRisk.value ? RISK_TONE[today.weatherRisk.value.level] : undefined} />
            <Tile title="Critical-load backup" provenance={today.resilience.provenance} value={today.resilience.value ? `${today.resilience.value.atLeast ? "at least " : ""}${formatNumber(today.resilience.value.hours)} h` : null} hint={today.resilience.value ? `if the grid failed now · score ${today.resilience.value.score} / 100${today.resilience.value.chargeAssumed ? ". The battery's charge is not known, so it is taken as at its lowest: enter the real charge for a real answer" : ""}` : undefined} />
            <Tile title="Expected value" provenance={today.plan.provenance} value={plan ? formatInr(plan.savingsInr) : null} hint={plan ? `saved over the plan's hours against no control${plan.stale ? " (an old plan)" : ""}` : undefined} />
            <Tile title="Confidence in the advice" provenance={today.plan.provenance} value={rec ? (rec.confidence.assessed ? `${rec.confidence.agreeing} of ${rec.confidence.total}` : "not assessed") : null} hint={rec ? (rec.confidence.assessed ? "forecasts give the same advice" : "nothing to vary") : undefined} />
          </ul>

          {rec ? (
            <section className="card mt-4 p-4" aria-labelledby="today-next">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="today-next" className="text-lg font-semibold">What to do next</h2>
                <StatusBadge status={today.plan.provenance.status} />
              </div>
              <p className="mt-2 text-xl font-semibold">{rec.headline}</p>
              <p className="mt-1 text-sm text-muted">{rec.confidence.statement}</p>
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-semibold">Why?</summary>
                <div className="mt-2 grid gap-4 text-sm md:grid-cols-3">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">The reasoning</h3>
                    {rec.why.length > 0 ? <ul className="mt-1 list-disc pl-5">{rec.why.map((w) => <li key={w}>{w}</li>)}</ul> : <p className="mt-1 text-muted">It follows from the plan as a whole.</p>}
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Data used</h3>
                    <ul className="mt-1 list-disc pl-5">{rec.dataUsed.map((d) => <li key={d}>{d}</li>)}</ul>
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Assumptions</h3>
                    <ul className="mt-1 list-disc pl-5 text-muted">{rec.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
                  </div>
                </div>
              </details>
              <p className="mt-3 text-sm"><Link className="font-semibold text-accent underline" href={`/property/${id}/plan`}>The whole plan, hour by hour</Link></p>
            </section>
          ) : null}

          <section className="card mt-4 p-4" aria-labelledby="today-achieved">
            <h2 id="today-achieved" className="text-lg font-semibold">What AVISHKAR is expected to achieve</h2>
            <dl className="mt-3 grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted">Money</dt>
                <dd className="num text-lg font-semibold">{today.achieved.expectedSavingsInr === null ? "—" : formatInr(today.achieved.expectedSavingsInr)}</dd>
                <dd className="text-xs text-muted">{today.achieved.basis}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Bought from the grid</dt>
                <dd className="num text-lg font-semibold">{plan ? `${formatNumber(plan.importKwh)} kWh` : "—"}</dd>
                <dd className="text-xs text-muted">{plan ? `with the plan; the same hours with no control cost ${formatInr(plan.baselineNetCostInr)} against ${formatInr(plan.netCostInr)}.` : "No plan yet."}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Carbon</dt>
                <dd className="text-lg font-semibold">not stated</dd>
                <dd className="text-xs text-muted">{today.achieved.carbon.reason}</dd>
              </div>
            </dl>
            {plan && <div className="mt-2"><ProvenanceDetails p={today.plan.provenance} /></div>}
          </section>

          {today.next.length > 0 && (
            <section className="card mt-4 p-4" aria-labelledby="today-missing">
              <h2 id="today-missing" className="text-lg font-semibold">To fill in what is missing</h2>
              <ul className="mt-2 list-disc pl-5 text-sm">
                {today.next.map((n) => (
                  <li key={n.href}>
                    <Link className="font-semibold text-accent underline" href={n.href}>{n.label}</Link>: {n.why}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
