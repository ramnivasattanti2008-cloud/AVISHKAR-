"use client";

import Link from "next/link";
import { useApi } from "@/lib/useApi";
import { formatDateTime, formatInr, formatNumber } from "@/lib/format";
import type { EnergyHealth, EnergyWaste, Provenance } from "@/lib/types";
import { useAuth } from "../AuthProvider";
import { ProvenanceDetails, StatusBadge } from "../Provenance";
import { PropertyTabs } from "../property/PropertyTabs";
import { usePropertyData } from "../property/usePropertyData";

const DIRECTION = { HIGHER_IS_BETTER: "higher is better", LOWER_IS_BETTER: "lower is better" } as const;
const STATE = {
  FOUND: { text: "Found", tone: "updated" },
  NONE: { text: "None found", tone: "live" },
  UNAVAILABLE: { text: "Cannot tell", tone: "unavailable" },
} as const;

function Metric({ m }: { m: EnergyHealth["metrics"][number] }) {
  const has = m.result.value !== null && m.result.provenance.status !== "UNAVAILABLE";
  const unit = m.result.unit === "h" ? "h" : "%";
  return (
    <li className="card flex flex-col p-4" aria-label={m.label}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium">{m.label}</h3>
        <StatusBadge status={m.result.provenance.status} />
      </div>
      {has ? (
        <>
          <p className="num mt-1 text-2xl font-semibold">
            {formatNumber(m.result.value as number)}
            <span className="ml-1 text-sm font-normal text-muted">{unit}</span>
          </p>
          {unit === "%" && (
            <div aria-hidden className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface2">
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, Math.max(0, m.result.value as number))}%` }} />
            </div>
          )}
          <p className="mt-1 text-xs text-muted">{DIRECTION[m.direction]}</p>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">{m.detail}</p>
      )}
      {has && <p className="mt-1 text-sm">{m.detail}</p>}
      <details className="mt-2 text-xs text-muted">
        <summary className="cursor-pointer select-none underline decoration-dotted underline-offset-2">how it is worked out</summary>
        <p className="mt-1">{m.formula}</p>
      </details>
      <div className="mt-1">
        <ProvenanceDetails p={m.result.provenance} />
      </div>
    </li>
  );
}

function Tile({ title, provenance, value, hint }: { title: string; provenance: Provenance; value: string | null; hint?: string }) {
  const missing = value === null || provenance.status === "UNAVAILABLE";
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
          <p className="num mt-1 text-2xl font-semibold">{value}</p>
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </>
      )}
      <div className="mt-1">
        <ProvenanceDetails p={provenance} />
      </div>
    </li>
  );
}

/** Energy health and energy waste (spec sections 35 and 36): ratios and findings worked out from the latest plan, never a score somebody chose. */
export function HealthView({ id }: { id: string }) {
  const { user, loading: authLoading } = useAuth();
  const { property, loading, error, notFound } = usePropertyData(id);
  const ready = Boolean(user && property);
  const health = useApi<EnergyHealth>(ready ? `/api/properties/${id}/health` : null);
  const waste = useApi<EnergyWaste>(ready ? `/api/properties/${id}/waste` : null);

  if (loading || authLoading) return <p role="status" className="p-6 text-sm text-muted">Loading…</p>;
  if (!user || notFound) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold">Property not found</h1>
        <p className="mt-3 text-muted">
          {user ? "This property does not exist or is not yours." : "Sign in to see energy health."}{" "}
          <Link className="font-semibold text-accent underline" href={user ? "/properties" : `/login?next=/property/${id}/health`}>
            {user ? "Back to your properties" : "Sign in"}
          </Link>
        </p>
      </div>
    );
  }
  if (error || !property) return <p role="alert" className="p-6 text-sm text-[color:var(--tone-unavailable-fg)]">{error ?? "Could not load the property."}</p>;

  const h = health.data;
  const w = waste.data;
  const basedOn = h?.basedOn ?? w?.basedOn ?? null;
  const next = [...(h?.next ?? []), ...(w?.next ?? [])].filter((n, i, all) => all.findIndex((x) => x.href === n.href && x.label === n.label) === i);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <header>
        <h1 className="text-2xl font-bold">{property.name}</h1>
        <p className="text-sm text-muted">How well the energy is used, and where it is wasted</p>
      </header>
      <div className="mt-4"><PropertyTabs id={id} current="/health" demo={property.isDemo} /></div>

      <div aria-live="polite" className="mt-3">
        {(health.loading || waste.loading) && <p role="status" className="text-sm text-muted">Reading the latest plan…</p>}
        {health.error && <p role="alert" className="text-sm text-[color:var(--tone-unavailable-fg)]">{health.error}</p>}
        {waste.error && <p role="alert" className="text-sm text-[color:var(--tone-unavailable-fg)]">{waste.error}</p>}
      </div>

      {basedOn && (
        <p role="note" className="mt-2 rounded-md bg-surface2 px-3 py-2 text-sm">
          Worked out from the plan made {formatDateTime(basedOn.madeAt)}, a simulated day on forecasts, not a measurement of what the property did. {basedOn.stale && <strong>{basedOn.note}</strong>}
        </p>
      )}
      {h && !basedOn && (
        <p role="status" className="mt-2 rounded-md bg-surface2 px-3 py-2 text-sm">
          There is no plan yet, so there is nothing to work these out from.{" "}
          {next.map((n) => (
            <Link key={n.href} className="font-semibold text-accent underline" href={n.href}>{n.label}</Link>
          ))}
        </p>
      )}

      {h && h.metrics.length > 0 && (
        <section className="mt-4" aria-labelledby="health">
          <h2 id="health" className="text-lg font-semibold">Energy health</h2>
          <ul className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {h.metrics.map((m) => <Metric key={m.key} m={m} />)}
          </ul>
          <p className="mt-3 text-sm text-muted">{h.noOverallScore}</p>
        </section>
      )}

      {w && w.findings.length > 0 && (
        <section className="mt-6" aria-labelledby="waste">
          <h2 id="waste" className="text-lg font-semibold">Energy waste</h2>
          <ul className="mt-2 grid gap-3 sm:grid-cols-2">
            <Tile
              title="Avoidable cost, per day"
              provenance={w.avoidable.perDay.provenance}
              value={w.avoidable.perDay.value === null ? null : formatInr(w.avoidable.perDay.value)}
              hint="the plan's saving over the same day with no control"
            />
            <Tile
              title="Potential avoidable cost in an average month"
              provenance={w.avoidable.averageMonth.provenance}
              value={w.avoidable.averageMonth.value === null ? null : formatInr(w.avoidable.averageMonth.value)}
              hint="from a what-if run's typical year, divided by twelve"
            />
          </ul>
          <ul className="mt-3 divide-y divide-line rounded-md border border-line">
            {w.findings.map((f) => (
              <li key={f.key} className="p-4" aria-label={f.label}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">{f.label}</h3>
                  <span className="flex items-center gap-2">
                    <span className="badge" data-tone={STATE[f.state].tone}>{STATE[f.state].text}</span>
                    <StatusBadge status={f.amount.provenance.status} />
                  </span>
                </div>
                {f.amount.value && (f.amount.value.kwh !== null || f.amount.value.valueInr !== null) && (
                  <p className="num mt-1 text-lg font-semibold">
                    {f.amount.value.kwh !== null && `${formatNumber(f.amount.value.kwh)} kWh`}
                    {f.amount.value.kwh !== null && f.amount.value.valueInr !== null && <span className="mx-2 text-muted">·</span>}
                    {f.amount.value.valueInr !== null && formatInr(f.amount.value.valueInr)}
                  </p>
                )}
                <p className="mt-1 text-sm">{f.explanation}</p>
                <details className="mt-1 text-xs text-muted">
                  <summary className="cursor-pointer select-none underline decoration-dotted underline-offset-2">how it is found</summary>
                  <p className="mt-1">{f.how}</p>
                </details>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted">{w.note}</p>
        </section>
      )}

      {basedOn && next.length > 0 && (
        <p className="mt-4 text-sm">
          {next.map((n) => (
            <span key={n.href} className="mr-3"><Link className="font-semibold text-accent underline" href={n.href}>{n.label}</Link>: {n.why}</span>
          ))}
        </p>
      )}
    </div>
  );
}
