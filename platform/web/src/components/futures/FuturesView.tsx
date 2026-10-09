"use client";

import Link from "next/link";
import { useState } from "react";
import { ApiError, api, describeError } from "@/lib/api";
import { formatDateTime, formatInr, formatNumber } from "@/lib/format";
import type { EnergyFutures } from "@/lib/types";
import { useAuth } from "../AuthProvider";
import { ProvenanceDetails, StatusBadge } from "../Provenance";
import { PropertyTabs } from "../property/PropertyTabs";
import { usePropertyData } from "../property/usePropertyData";

const BASIS = {
  REFERENCE: { text: "The day expected", tone: "reference" },
  DATA: { text: "From the forecast's own band", tone: "forecast" },
  ASSUMPTION: { text: "Your assumption", tone: "updated" },
} as const;


/** The same 24 hours planned on several different days (spec section 16): what each would cost and how much the plan can still do about it. */
export function FuturesView({ id }: { id: string }) {
  const { user, loading: authLoading } = useAuth();
  const { property, loading, error, notFound } = usePropertyData(id);
  const [rain, setRain] = useState("20");
  const [outageHour, setOutageHour] = useState("18");
  const [outageHours, setOutageHours] = useState("4");
  const [soc, setSoc] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<EnergyFutures | null>(null);

  async function run() {
    const r = Number(rain);
    const h = Number(outageHour);
    const n = Number(outageHours);
    const pct = soc.trim() === "" ? null : Number(soc);
    if (!(r >= 0 && r <= 100)) return setFailure("The share of the sun that comes through on a rainy day must be between 0 and 100 percent.");
    if (!(Number.isInteger(h) && h >= 0 && h <= 23)) return setFailure("The outage must start at an hour between 0 and 23.");
    if (!(Number.isInteger(n) && n >= 1 && n <= 12)) return setFailure("The outage must last a whole number of hours between 1 and 12.");
    if (pct !== null && !(pct >= 0 && pct <= 100)) return setFailure("The battery charge must be between 0 and 100 percent, or left empty if you do not know it.");
    setBusy(true);
    setFailure(null);
    try {
      setResult(await api<EnergyFutures>(`/api/properties/${id}/futures`, { method: "POST", body: { rainSolarPercent: r, outage: { startHour: h, hours: n }, startSocPercent: pct } }));
    } catch (e) {
      const missing = e instanceof ApiError ? (e.details as { missing?: { why: string }[] } | undefined)?.missing : undefined;
      setFailure(missing?.length ? `${describeError(e)} ${missing.map((m) => m.why).join(" ")}` : describeError(e));
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
          {user ? "This property does not exist or is not yours." : "Sign in to see energy futures."}{" "}
          <Link className="font-semibold text-accent underline" href={user ? "/properties" : `/login?next=/property/${id}/futures`}>
            {user ? "Back to your properties" : "Sign in"}
          </Link>
        </p>
      </div>
    );
  }
  if (error || !property) return <p role="alert" className="p-6 text-sm text-[color:var(--tone-unavailable-fg)]">{error ?? "Could not load the property."}</p>;

  const ran = result?.futures.filter((f) => f.state === "RUN") ?? [];
  const anyOutage = ran.some((f) => (f.result.value?.shedKwh ?? 0) > 0);
  const costs = ran.map((f) => f.result.value!.netCostInr);
  const widest = Math.max(1, ...costs);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <header>
        <h1 className="text-2xl font-bold">{property.name}</h1>
        <p className="text-sm text-muted">The next 24 hours on different days</p>
      </header>
      <div className="mt-4"><PropertyTabs id={id} current="/futures" demo={property.isDemo} /></div>

      <section className="card mt-4 p-4" aria-labelledby="futures-form">
        <h2 id="futures-form" className="text-lg font-semibold">Plan the same day on different days</h2>
        <p className="mt-1 text-sm text-muted">
          The next 24 hours are planned afresh on a sunny day, a heavy-cloud day, a rainy day, a high-demand day, a day with the battery offline and a day with a grid outage. These are not
          predictions and they carry no probability: the sunny, cloudy and high-demand days are the ends of the bands the forecasts measured from your own past errors, and the rain and the
          outage are what you set below.
        </p>
        <form
          aria-label="The days to try"
          className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,1fr)_auto] lg:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <div>
            <label htmlFor="fu-rain" className="text-sm font-medium">On a rainy day the sun gives, % of expected</label>
            <input id="fu-rain" className="field mt-1" inputMode="decimal" value={rain} onChange={(e) => setRain(e.target.value)} />
          </div>
          <div>
            <label htmlFor="fu-hour" className="text-sm font-medium">An outage starts at, hour (0 to 23)</label>
            <input id="fu-hour" className="field mt-1" inputMode="numeric" value={outageHour} onChange={(e) => setOutageHour(e.target.value)} />
          </div>
          <div>
            <label htmlFor="fu-hours" className="text-sm font-medium">and lasts, hours</label>
            <input id="fu-hours" className="field mt-1" inputMode="numeric" value={outageHours} onChange={(e) => setOutageHours(e.target.value)} />
          </div>
          <div>
            <label htmlFor="fu-soc" className="text-sm font-medium">Battery charge now, % (optional)</label>
            <input id="fu-soc" className="field mt-1" inputMode="decimal" placeholder="not known" value={soc} onChange={(e) => setSoc(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Planning each day…" : "Run the futures"}</button>
        </form>
        <div aria-live="polite" className="mt-3">
          {busy && <p role="status" className="text-sm text-muted">Planning the day on each of the days. This takes up to half a minute.</p>}
          {failure && <p role="alert" className="rounded-md bg-[color:var(--tone-unavailable-bg)] p-3 text-sm text-[color:var(--tone-unavailable-fg)]">{failure}</p>}
        </div>
      </section>

      {result && (
        <section className="mt-6" aria-labelledby="futures-result">
          <h2 id="futures-result" className="text-lg font-semibold">What each day would cost</h2>
          <p className="mt-1 text-sm text-muted">The 24 hours planned: {formatDateTime(result.horizon.start)} to {formatDateTime(new Date(Date.parse(result.horizon.start) + 24 * 3_600_000).toISOString())}. An outage that would start after that is cut at its end.</p>
          {result.spread && (
            <p role="status" className="mt-2 rounded-md bg-surface2 p-3 text-sm">
              Across the days without an outage the plan&apos;s bill runs from <span className="num font-semibold">{formatInr(result.spread.cheapest.netCostInr)}</span> ({result.spread.cheapest.label.toLowerCase()}) to{" "}
              <span className="num font-semibold">{formatInr(result.spread.dearest.netCostInr)}</span> ({result.spread.dearest.label.toLowerCase()}). {result.spread.note}
            </p>
          )}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">The next 24 hours planned on each day: cost, difference from the expected day, energy bought, autonomy, battery cycles and load switched off</caption>
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th scope="col" className="py-1 pr-4 font-medium">Day</th>
                  <th scope="col" className="py-1 pr-4 font-medium">Cost with the plan</th>
                  <th scope="col" className="py-1 pr-4 font-medium">From the expected day</th>
                  <th scope="col" className="py-1 pr-4 font-medium">Bought</th>
                  <th scope="col" className="py-1 pr-4 font-medium">Autonomy</th>
                  <th scope="col" className="py-1 pr-4 font-medium">Battery cycles</th>
                  {anyOutage && <th scope="col" className="py-1 font-medium">Switched off</th>}
                </tr>
              </thead>
              <tbody className="num">
                {result.futures.map((f) => {
                  const v = f.result.value;
                  const b = BASIS[f.basis];
                  return (
                    <tr key={f.key} className="border-t border-line align-top">
                      <th scope="row" className="py-2 pr-4 text-left font-normal">
                        <div className="font-semibold">{f.label}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <span className="badge" data-tone={b.tone}>{b.text}</span>
                          <StatusBadge status={f.result.provenance.status} />
                        </div>
                        {f.sameAsExpected && f.state === "RUN" && (
                          <p className="mt-1 max-w-md text-xs" style={{ color: "var(--tone-updated-fg)" }}>
                            The same as the expected day, to the last digit: the band has no width here (the forecast has seen no error to measure), so this day cannot come out differently.
                          </p>
                        )}
                        <details className="mt-1 text-xs text-muted">
                          <summary className="cursor-pointer select-none underline decoration-dotted underline-offset-2">what it is built from</summary>
                          <p className="mt-1 max-w-md">{f.built}</p>
                          <ProvenanceDetails p={f.result.provenance} />
                        </details>
                      </th>
                      {v ? (
                        <>
                          <td className="py-2 pr-4">
                            <div className="font-semibold">{formatInr(v.netCostInr)}</div>
                            <div aria-hidden className="mt-1 h-1.5 w-28 overflow-hidden rounded-full bg-surface2"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(2, (v.netCostInr / widest) * 100)}%` }} /></div>
                            <div className="text-xs text-muted">no control {formatInr(v.noControlCostInr)}</div>
                          </td>
                          <td className="py-2 pr-4">{v.vsExpectedInr === null ? <span className="text-muted" title="A day with an outage has a lower bill because load is switched off">—</span> : v.vsExpectedInr === 0 ? "—" : `${v.vsExpectedInr > 0 ? "+" : "−"}${formatInr(Math.abs(v.vsExpectedInr))}`}</td>
                          <td className="py-2 pr-4">{formatNumber(v.importKwh)} kWh</td>
                          <td className="py-2 pr-4">{v.autonomyPercent === null ? "—" : `${formatNumber(v.autonomyPercent)}%`}</td>
                          <td className="py-2 pr-4">{formatNumber(v.batteryCycles)}</td>
                          {anyOutage && (
                            <td className="py-2">
                              {v.shedKwh > 0 ? `${formatNumber(v.shedKwh)} kWh` : "—"}
                              {(v.unservedKwh > 0.005 || v.unservedNoControlKwh > 0.005) && (
                                <div className="text-xs" style={{ color: "var(--tone-unavailable-fg)" }}>
                                  critical load unserved: {formatNumber(v.unservedKwh)} kWh with the plan, {formatNumber(v.unservedNoControlKwh)} kWh with no control
                                </div>
                              )}
                            </td>
                          )}
                        </>
                      ) : (
                        <td className="py-2 text-sm text-muted" colSpan={anyOutage ? 6 : 5}>
                          <span className="badge mr-2" data-tone="unavailable">Cannot be run</span>
                          {f.reason}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <h3 className="mt-5 text-base font-semibold">What these rest on</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted">
            {result.assumptions.map((a) => <li key={a}>{a}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
