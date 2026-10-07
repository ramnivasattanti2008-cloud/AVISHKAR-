"use client";

import Link from "next/link";
import { useState } from "react";
import { api, describeError } from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { EnergyDna, EnergyImport, EnergySummary } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { useAuth } from "../AuthProvider";
import { Measure } from "../Provenance";
import { PropertyTabs } from "../property/PropertyTabs";
import { usePropertyData } from "../property/usePropertyData";
import { ImportPanel } from "./ImportPanel";
import { DailyChart, PatternChart } from "./MeterCharts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;

/** The property's own meter readings, what was learned from them, and how to add or remove them (spec sections 9, 10, 14). */
export function MeterDataView({ id }: { id: string }) {
  const { user, loading: authLoading } = useAuth();
  const { property, loading, error, notFound } = usePropertyData(id);
  const summary = useApi<EnergySummary>(user && property ? `/api/properties/${id}/energy` : null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  if (loading || authLoading) return <p role="status" className="p-6 text-sm text-muted">Loading…</p>;
  if (!user || notFound) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold">Property not found</h1>
        <p className="mt-3 text-muted">
          {user ? "This property does not exist or is not yours." : "Sign in to import meter data."}{" "}
          <Link className="font-semibold text-accent underline" href={user ? "/properties" : `/login?next=/property/${id}/meter-data`}>
            {user ? "Back to your properties" : "Sign in"}
          </Link>
        </p>
      </div>
    );
  }
  if (error || !property) return <p role="alert" className="p-6 text-sm text-[color:var(--tone-unavailable-fg)]">{error ?? "Could not load the property."}</p>;

  const data = summary.data;

  async function remove(imp: EnergyImport) {
    setBusy(true);
    setMessage(null);
    try {
      await api(`/api/properties/${id}/energy/imports/${imp.id}`, { method: "DELETE" });
      summary.reload();
      setMessage({ tone: "ok", text: `${imp.filename ?? "The import"} and its ${formatNumber(imp.accepted)} readings were deleted, and the Energy DNA was rebuilt from what is left.` });
    } catch (e) {
      setMessage({ tone: "error", text: describeError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <header>
        <h1 className="text-2xl font-bold">{property.name}</h1>
        <p className="text-sm text-muted">Meter data and Energy DNA</p>
      </header>
      <div className="mt-4">
        <PropertyTabs id={id} current="/meter-data" />
      </div>

      <div aria-live="polite" className="mt-3 min-h-6">
        {message && (
          <p role={message.tone === "error" ? "alert" : "status"} className={`rounded-md p-2 text-sm ${message.tone === "error" ? "bg-[color:var(--tone-unavailable-bg)] text-[color:var(--tone-unavailable-fg)]" : "bg-[color:var(--tone-live-bg)] text-[color:var(--tone-live-fg)]"}`}>
            {message.text}
          </p>
        )}
      </div>

      <div className="mt-2 grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <div className="flex flex-col gap-4">
          <ImportPanel propertyId={id} onImported={summary.reload} />
          <section className="card p-4" aria-label="Imported files">
            <h2 className="text-base font-semibold">What you have imported</h2>
            {summary.error && <p role="alert" className="mt-2 text-sm text-[color:var(--tone-unavailable-fg)]">{summary.error}</p>}
            {!data && !summary.error && <p role="status" className="mt-2 text-sm text-muted">Loading…</p>}
            {data && !data.coverage && <p className="mt-2 text-sm text-muted">No readings yet. AVISHKAR does not guess a household&rsquo;s consumption: until you import a meter file the Energy Twin lists it as unavailable.</p>}
            {data?.coverage && (
              <p className="mt-2 text-sm text-muted">
                {formatNumber(data.coverage.observations)} readings over {formatNumber(data.coverage.days)} day{data.coverage.days === 1 ? "" : "s"}, every {data.coverage.intervalMinutes} minutes, {formatDateTime(data.coverage.from)} to {formatDateTime(data.coverage.to)}.
              </p>
            )}
            {data && data.imports.length > 0 && (
              <ul className="mt-3 divide-y divide-line text-sm">
                {data.imports.map((imp) => (
                  <li key={imp.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <strong>{imp.filename ?? "Unnamed file"}</strong>
                      <span className="block text-xs text-muted">
                        {formatNumber(imp.accepted)} readings, {imp.unit}, every {imp.intervalMinutes} min; imported {formatDateTime(imp.uploadedAt)}
                        {imp.rejected ? `; ${formatNumber(imp.rejected)} rows refused` : ""}
                      </span>
                    </span>
                    <button type="button" className="btn" onClick={() => remove(imp)} disabled={busy} aria-label={`Delete ${imp.filename ?? "import"} and its readings`}>
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-4">
          {data && data.dailyKwh.length > 0 && (
            <section className="card p-4" aria-label="Energy per day">
              <h2 className="text-base font-semibold">Energy read per day</h2>
              <p className="mt-0.5 text-xs text-muted">Local days (India Standard Time). Your readings, not an estimate; a partial day is shown as such.</p>
              <div className="mt-2">
                <DailyChart days={data.dailyKwh} />
              </div>
            </section>
          )}
          {data && <DnaPanel dna={data.dna} reason={data.dnaUnavailableReason} />}
        </div>
      </div>
    </div>
  );
}

function DnaPanel({ dna, reason }: { dna: EnergyDna | null; reason: string | null }) {
  if (!dna) {
    return (
      <section className="card p-4" aria-label="Energy DNA">
        <h2 className="text-base font-semibold">Energy DNA</h2>
        <p className="mt-2 text-sm text-muted">{reason ?? "Import a meter file to build your Energy DNA."}</p>
      </section>
    );
  }
  const b = dna.baseline;
  const months = Object.entries(dna.patterns.monthlyDailyKwh);
  return (
    <section className="card p-4" aria-label="Energy DNA">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Energy DNA</h2>
        <span className="text-xs text-muted">
          Version {dna.version}: {dna.period.completeDays} complete days, {formatDateTime(dna.period.from).split(",")[0]} to {formatDateTime(dna.period.to).split(",")[0]}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-muted">How this property uses electricity, from its own readings only. Every figure is an estimate from those days.</p>
      <div className="mt-2 divide-y divide-line">
        <Measure label="Average day" m={b.meanDailyKwh} digits={1} />
        <Measure label="Average weekday" m={b.weekdayDailyKwh} digits={1} />
        <Measure label="Average weekend day" m={b.weekendDailyKwh} digits={1} />
        <Measure label="Base load (the level it rarely goes below)" m={b.baseloadKw} digits={2} />
        <Measure label="Highest power seen" m={b.peakKw} digits={2} />
        <Measure label="Busiest hour of the day" m={b.peakHour} digits={0} />
      </div>
      <h3 className="mt-4 text-sm font-semibold">A typical day</h3>
      <PatternChart hourly={dna.patterns.hourlyKw} weekday={dna.patterns.weekdayHourlyKw} weekend={dna.patterns.weekendHourlyKw} />
      {months.length > 0 && (
        <>
          <h3 className="mt-4 text-sm font-semibold">Average day by month</h3>
          <table className="mt-1 w-full text-sm">
            <caption className="sr-only">Average daily energy by month, for months with at least seven complete days</caption>
            <tbody>
              {months.map(([m, kwh]) => (
                <tr key={m} className="border-t border-line">
                  <td className="py-1">{monthLabel(m)}</td>
                  <td className="num py-1 text-right">{formatNumber(kwh, "kWh")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {dna.unavailable.length > 0 && (
        <ul className="mt-4 list-disc pl-5 text-sm text-muted">
          {dna.unavailable.map((g) => (
            <li key={g.what}>
              <strong className="text-ink">{g.what}:</strong> {g.reason}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
