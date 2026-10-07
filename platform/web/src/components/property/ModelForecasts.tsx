"use client";

import Link from "next/link";
import { useState } from "react";
import { compass, formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import type { ForecastAccuracy, LoadForecast, SolarForecast, SolarPerformance } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { ProvenanceDetails, StatusBadge } from "../Provenance";
import { BandChart } from "./BandChart";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num text-lg font-semibold">{value}</dd>
      {hint && <dd className="text-xs text-muted">{hint}</dd>}
    </div>
  );
}

function Reason({ title, reason, action }: { title: string; reason: string; action?: React.ReactNode }) {
  return (
    <div role="status" className="mt-3 rounded-md bg-[color:var(--tone-unavailable-bg)] p-3 text-sm text-[color:var(--tone-unavailable-fg)]">
      <p className="font-semibold">{title}</p>
      <p className="mt-1">{reason}</p>
      {action && <p className="mt-2">{action}</p>}
    </div>
  );
}

function Notes({ notes, assumptions }: { notes: string[]; assumptions: string[] }) {
  if (notes.length === 0 && assumptions.length === 0) return null;
  return (
    <details className="mt-3 text-sm text-muted">
      <summary className="cursor-pointer select-none underline decoration-dotted underline-offset-2">How this was made, and what it assumes</summary>
      {notes.length > 0 && (
        <ul className="mt-1 list-disc pl-5">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {assumptions.length > 0 && (
        <ul className="mt-1 list-disc pl-5">
          {assumptions.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </details>
  );
}

// ------------------------------------------------------------------------------------------------ solar

/** The skill table: the model next to the naive baselines it has to beat, scored on the last weeks. */
function SolarSkill({ perf }: { perf: SolarPerformance }) {
  const r = perf.result.value;
  if (!r) return <Reason title="How well has it done lately?" reason={perf.result.provenance.notes[0] ?? "No scoring is available."} />;
  const rows: { name: string; m: NonNullable<typeof r.persistenceBaseline> | null }[] = [
    { name: "This forecast", m: r.forecast },
    { name: "Yesterday’s output (naive)", m: r.persistenceBaseline },
    { name: "A cloudless sky (naive)", m: r.clearSky },
  ];
  const better = r.skillVsPersistence;
  return (
    <section className="mt-4" aria-label="How well the solar forecast has done lately">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">How well has it done lately?</h3>
        <StatusBadge status={perf.result.provenance.status} />
      </div>
      <p className="mt-1 text-sm text-muted">
        The last {r.window.hours} hours ({Math.round(r.window.hours / 24)} days) of day-ahead forecasts, scored against what the weather model says actually happened.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[28rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1 pr-3 font-medium">Method</th>
              <th className="py-1 pr-3 text-right font-medium">Mean error (kW)</th>
              <th className="py-1 pr-3 text-right font-medium">RMSE (kW)</th>
              <th className="py-1 pr-3 text-right font-medium">Share of energy missed</th>
              <th className="py-1 text-right font-medium">Bias (kW)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ name, m }) => (
              <tr key={name} className="border-t border-line">
                <th scope="row" className="py-1 pr-3 text-left font-medium">{name}</th>
                {m ? (
                  <>
                    <td className="num py-1 pr-3 text-right">{formatNumber(m.maeKw)}</td>
                    <td className="num py-1 pr-3 text-right">{formatNumber(m.rmseKw)}</td>
                    <td className="num py-1 pr-3 text-right">{m.wapePct === null ? "—" : `${formatNumber(m.wapePct)}%`}</td>
                    <td className="num py-1 text-right">{formatNumber(m.biasKw)}</td>
                  </>
                ) : (
                  <td colSpan={4} className="py-1 text-muted">not available</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {better !== null && (
        <p className="mt-2 text-sm">
          {better > 0
            ? `It missed ${formatPercent(better)} less than simply repeating yesterday’s output.`
            : `It did not beat simply repeating yesterday’s output (${formatPercent(Math.abs(better))} worse), so treat it with care.`}
        </p>
      )}
      <p className="mt-1 text-xs text-muted">{perf.basis}</p>
    </section>
  );
}

export function SolarForecastPanel({ id }: { id: string }) {
  const f = useApi<SolarForecast>(`/api/properties/${id}/solar-forecast?days=3`);
  const hasSystem = (f.data?.systems.length ?? 0) > 0 && f.data?.hours.value != null;
  const perf = useApi<SolarPerformance>(hasSystem ? `/api/properties/${id}/solar-forecast/performance` : null);
  const d = f.data;
  return (
    <section className="card p-4" aria-label="Solar output forecast">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Your solar output</h2>
        {d && <StatusBadge status={d.hours.provenance.status} />}
      </div>
      {f.loading && <p role="status" className="mt-3 text-sm text-muted">Running the solar model on the real weather forecast…</p>}
      {f.error && <p role="alert" className="mt-3 rounded-md bg-[color:var(--tone-unavailable-bg)] p-3 text-sm text-[color:var(--tone-unavailable-fg)]">{f.error}</p>}
      {d && !d.hours.value && (
        <Reason
          title="No solar forecast"
          reason={d.hours.provenance.notes[0] ?? "A forecast could not be made."}
          action={d.systems.length === 0 ? <Link className="font-semibold underline" href={`/property/${id}/assets`}>Add a solar system</Link> : undefined}
        />
      )}
      {d?.hours.value && d.energy.value && (
        <>
          <p className="mt-2 text-sm text-muted">
            {d.systems.map((s) => `${s.name}: ${formatNumber(s.capacityKwp)} kWp, tilted ${formatNumber(s.tiltDeg)}°, facing ${compass(s.azimuthDeg)}, system losses ${formatPercent(s.lossFraction)}${s.lossBasis === "ASSUMPTION" ? " (assumed)" : ""}`).join("; ")}.
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat
              label="Expected energy over the period"
              value={`${formatNumber(d.energy.value.kwhP50)} kWh`}
              hint={d.energy.value.kwhP10 !== null && d.energy.value.kwhP90 !== null ? `likely ${formatNumber(d.energy.value.kwhP10)} to ${formatNumber(d.energy.value.kwhP90)} kWh` : "no range claimed"}
            />
            <Stat label="Yield per kWp" value={`${formatNumber(d.energy.value.yieldKwhPerKwpP50)} kWh`} />
            <Stat label="Cloudless sky would give" value={`${formatNumber(d.energy.value.kwhClearSky)} kWh`} />
            <Stat
              label="Range check"
              value={d.band.calibration ? (d.band.calibration.holdoutCoverage != null ? `${formatPercent(d.band.calibration.holdoutCoverage)} held` : "not checked") : "—"}
              hint={
                d.band.calibration
                  ? d.band.calibration.holdoutCoverage != null
                    ? `target ${formatPercent(d.band.calibration.targetCoverage)}, on ${d.band.calibration.holdoutHours} hours it had not seen`
                    : "too few hours were held back to test it"
                  : undefined
              }
            />
          </dl>
          {!d.band.available && d.band.reason && <p className="mt-3 rounded-md bg-[color:var(--tone-updated-bg)] p-3 text-sm text-[color:var(--tone-updated-fg)]">No uncertainty range is shown: {d.band.reason}</p>}
          <BandChart
            label="Solar output forecast"
            unit="kW"
            status={d.hours.provenance.status}
            source={d.hours.provenance.source}
            referenceLabel="Cloudless sky"
            points={d.hours.value.map((h) => ({ time: h.time, p50: h.p50Kw, p10: h.p10Kw, p90: h.p90Kw, reference: h.clearSkyKw }))}
          />
          <p className="text-xs text-muted">Each hour is labelled by when it ends. The shaded band is the 10th to 90th percentile, learned from how wrong this weather forecast was here in the last weeks. The dashed line is a cloudless sky.</p>
          {perf.loading && <p role="status" className="mt-3 text-sm text-muted">Scoring the model on the last weeks…</p>}
          {perf.error && <p role="alert" className="mt-3 text-sm text-[color:var(--tone-unavailable-fg)]">{perf.error}</p>}
          {perf.data && <SolarSkill perf={perf.data} />}
          <Notes notes={d.notes} assumptions={d.assumptions} />
          <div className="mt-2"><ProvenanceDetails p={d.hours.provenance} /></div>
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------------------------------------------- load

const METHOD_LABELS: Record<string, string> = {
  last_week: "Same hour last week",
  same_hour_of_week: "Average of this hour of the week",
  same_hour_recent: "Average of this hour, recent days",
  gbm_quantile: "Learned model",
};

const HORIZONS = [
  { hours: 24, label: "Next 24 hours" },
  { hours: 48, label: "Next 48 hours" },
  { hours: 168, label: "Next 7 days" },
] as const;

export function LoadForecastPanel({ id }: { id: string }) {
  const [hours, setHours] = useState<number>(24);
  const f = useApi<LoadForecast>(`/api/properties/${id}/load-forecast?hours=${hours}`);
  const d = f.data;
  const best = d?.model?.methods.find((m) => m.method === d.model?.selectedMethod);
  return (
    <section className="card p-4" aria-label="Electricity use forecast">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Your electricity use</h2>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="load-horizon">Forecast length</label>
          <select id="load-horizon" className="field !w-auto py-1 text-sm" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {HORIZONS.map((h) => (
              <option key={h.hours} value={h.hours}>{h.label}</option>
            ))}
          </select>
          {d && <StatusBadge status={d.hours.provenance.status} />}
        </div>
      </div>
      {f.loading && <p role="status" className="mt-3 text-sm text-muted">Comparing forecasting methods on your meter readings…</p>}
      {f.error && <p role="alert" className="mt-3 rounded-md bg-[color:var(--tone-unavailable-bg)] p-3 text-sm text-[color:var(--tone-unavailable-fg)]">{f.error}</p>}
      {d && !d.hours.value && (
        <Reason title="No electricity use forecast" reason={d.hours.provenance.notes[0] ?? "A forecast could not be made."} action={<Link className="font-semibold underline" href={`/property/${id}/meter-data`}>Go to Meter data</Link>} />
      )}
      {d?.hours.value && d.energy.value && d.model && (
        <>
          {d.hours.provenance.status === "ESTIMATED" && (
            <p role="status" className="mt-3 rounded-md bg-[color:var(--tone-estimated-bg)] p-3 text-sm text-[color:var(--tone-estimated-fg)]">
              {d.hours.provenance.notes.find((n) => n.startsWith("Estimated")) ?? "This is an estimate of the hours after your data ends, not a forecast of the coming days."}
            </p>
          )}
          <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Expected energy over the period" value={`${formatNumber(d.energy.value.kwhP50)} kWh`} />
            <Stat label="Method chosen" value={d.model.selectedMethod ? (METHOD_LABELS[d.model.selectedMethod] ?? d.model.selectedMethod) : "—"} hint={best ? `mean error ${formatNumber(best.maeKw)} kW on ${d.model.holdoutDays} days it had not seen` : undefined} />
            <Stat label="Range check" value={best?.coverage80 != null ? `${formatPercent(best.coverage80)} held` : "—"} hint="target 80%" />
            <Stat label="Peak hour starts above" value={d.peakThresholdKw !== null ? `${formatNumber(d.peakThresholdKw)} kW` : "—"} hint="your own top 5% of hours" />
          </dl>
          <BandChart
            label="Electricity use forecast"
            unit="kW"
            status={d.hours.provenance.status}
            source={d.hours.provenance.source}
            points={d.hours.value.map((h) => ({ time: h.time, p50: h.p50Kw, p10: h.p10Kw, p90: h.p90Kw, extra: `Chance of a peak hour: ${formatPercent(h.peakProbability)}` }))}
          />
          <p className="text-xs text-muted">Each hour is labelled by when it starts. The shaded band is the 10th to 90th percentile, checked on days the method had not seen.</p>

          <section className="mt-4" aria-label="Forecasting methods compared">
            <h3 className="text-sm font-semibold">Methods compared on the last {d.model.holdoutDays} days of your data</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[30rem] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-1 pr-3 font-medium">Method</th>
                    <th className="py-1 pr-3 text-right font-medium">Mean error (kW)</th>
                    <th className="py-1 pr-3 text-right font-medium">Share of energy missed</th>
                    <th className="py-1 pr-3 text-right font-medium">Bias (kW)</th>
                    <th className="py-1 text-right font-medium">Range held</th>
                  </tr>
                </thead>
                <tbody>
                  {d.model.methods.map((m) => (
                    <tr key={m.method} className="border-t border-line">
                      <th scope="row" className="py-1 pr-3 text-left font-medium">
                        {m.description}
                        {m.method === d.model?.selectedMethod && <span className="ml-2 text-xs font-semibold text-accent">chosen</span>}
                      </th>
                      <td className="num py-1 pr-3 text-right">{formatNumber(m.maeKw)}</td>
                      <td className="num py-1 pr-3 text-right">{m.wapePct === null ? "—" : `${formatNumber(m.wapePct)}%`}</td>
                      <td className="num py-1 pr-3 text-right">{formatNumber(m.biasKw)}</td>
                      <td className="num py-1 text-right">{m.coverage80 === null ? "—" : formatPercent(m.coverage80)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          {d.history && (
            <p className="mt-3 text-xs text-muted">
              Built from {formatNumber(d.model.historyDays)} days of {d.history.intervalMinutes}-minute readings ({formatPercent(d.model.gapsShare)} of hours had no reading and were left empty).
            </p>
          )}
          <Notes notes={d.notes} assumptions={d.assumptions} />
          <div className="mt-2"><ProvenanceDetails p={d.hours.provenance} /></div>
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ accuracy over time

const RUN_STATUS = { SCORED: "Scored", WAITING: "Waiting for readings", NOT_SCORABLE: "Could not be scored" } as const;

/** Every stored load forecast against the readings that followed it: the loop that shows whether the model is learning anything useful. */
export function AccuracyPanel({ id }: { id: string }) {
  const f = useApi<ForecastAccuracy>(`/api/properties/${id}/forecast-accuracy`);
  const d = f.data;
  const s = d?.load.summary;
  const waiting = d?.load.runs.filter((r) => r.status === "WAITING").length ?? 0;
  return (
    <section className="card mt-4 p-4" aria-label="Forecast accuracy over time">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">How have the forecasts done against what happened?</h2>
        {s && <StatusBadge status={s.provenance.status} />}
      </div>
      <p className="mt-1 text-sm text-muted">
        Each electricity-use forecast made from current readings is kept. When newer readings cover its hours, it is scored against them, next to simply repeating the same hour a week earlier.
      </p>
      {f.loading && <p role="status" className="mt-3 text-sm text-muted">Loading…</p>}
      {f.error && <p role="alert" className="mt-3 text-sm text-[color:var(--tone-unavailable-fg)]">{f.error}</p>}
      {d && s && !s.value && <Reason title="Nothing scored yet" reason={s.provenance.notes[0] ?? "No forecast has been scored."} />}
      {d && s?.value && (
        <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Forecasts scored" value={String(s.value.scored)} hint={waiting > 0 ? `${waiting} waiting for readings` : undefined} />
          <Stat label="Typical error" value={`${formatNumber(s.value.meanMaeKw)} kW`} hint="mean over scored forecasts" />
          <Stat label="Bias" value={`${s.value.meanBiasKw > 0 ? "+" : ""}${formatNumber(s.value.meanBiasKw)} kW`} hint={Math.abs(s.value.meanBiasKw) < 0.005 ? "none" : s.value.meanBiasKw > 0 ? "forecasts ran high" : "forecasts ran low"} />
          <Stat
            label="Against last week"
            value={s.value.meanSkillVsLastWeek === null ? "—" : s.value.meanSkillVsLastWeek >= 0 ? `${formatPercent(s.value.meanSkillVsLastWeek)} better` : `${formatPercent(-s.value.meanSkillVsLastWeek)} worse`}
            hint={`band held ${formatPercent(s.value.meanCoverage80)} of hours`}
          />
        </dl>
      )}
      {d && d.load.runs.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <caption className="sr-only">Stored forecasts and how each was scored</caption>
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1 pr-3 font-medium">Made</th>
                <th className="py-1 pr-3 font-medium">Status</th>
                <th className="py-1 pr-3 text-right font-medium">Hours scored</th>
                <th className="py-1 pr-3 text-right font-medium">Mean error (kW)</th>
                <th className="py-1 pr-3 text-right font-medium">Bias (kW)</th>
                <th className="py-1 text-right font-medium">Band held</th>
              </tr>
            </thead>
            <tbody>
              {d.load.runs.slice(0, 10).map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <th scope="row" className="py-1 pr-3 text-left font-medium">{formatDateTime(r.issuedAt)}</th>
                  <td className="py-1 pr-3" title={r.reason ?? undefined}>{RUN_STATUS[r.status]}</td>
                  <td className="num py-1 pr-3 text-right">{r.scores ? `${r.scores.hours} of ${r.hours}` : "—"}</td>
                  <td className="num py-1 pr-3 text-right">{r.scores ? formatNumber(r.scores.maeKw) : "—"}</td>
                  <td className="num py-1 pr-3 text-right">{r.scores ? formatNumber(r.scores.biasKw) : "—"}</td>
                  <td className="num py-1 text-right">{r.scores ? formatPercent(r.scores.coverage80) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {d && <p className="mt-3 text-xs text-muted">{d.solar.reason}</p>}
    </section>
  );
}
