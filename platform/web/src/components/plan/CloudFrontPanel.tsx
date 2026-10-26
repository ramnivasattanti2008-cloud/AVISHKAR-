"use client";

import { useState } from "react";
import { Area, Line, ReferenceArea, Tooltip } from "recharts";
import { ApiError, api, describeError } from "@/lib/api";
import { formatDateTime, formatInr, formatNumber } from "@/lib/format";
import type { CloudFront } from "@/lib/types";
import { ProvenanceDetails, StatusBadge } from "../Provenance";
import { BATTERY, Frame, GRID, type Row, SOLAR, when } from "./PlanCharts";

const HOUR = 3_600_000;
const DEMAND: Record<string, string> = { HIGH: "HIGH", NORMAL: "NORMAL", LOW: "LOW" };

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num text-lg font-semibold">{value}</dd>
      {hint && <dd className="text-xs text-muted">{hint}</dd>}
    </div>
  );
}

function FrontChart({ s }: { s: CloudFront }) {
  const h = s.hourly;
  const rows: Row[] = h.times.map((time, i) => ({
    t: Date.parse(time),
    clear: h.solarKw[i]!,
    front: h.solarWithFrontKw[i]!,
    charging: h.batteryChargeKw[i]!,
    chargingUnaware: h.batteryChargeUnawareKw[i]!,
    import: h.gridImportKw[i]!,
    importUnaware: h.gridImportUnawareKw[i]!,
  }));
  const from = Date.parse(s.result.value?.frontArrivesAt ?? "");
  const to = Date.parse(s.result.value?.frontEndsAt ?? "");
  return (
    <Frame rows={rows} label="Solar with and without the front, and what is bought and stored" unit="kW">
      <Tooltip
        content={({ active, payload }) => {
          const r = payload?.[0]?.payload as Row | undefined;
          if (!active || !r) return null;
          return (
            <div className="card px-3 py-2 text-xs shadow-lg">
              <div className="font-semibold">{when.format(r.t)}</div>
              <div className="num mt-1" style={{ color: SOLAR }}>Solar on the forecast sky: {formatNumber(r.clear!, "kW")}</div>
              <div className="num" style={{ color: SOLAR }}>Solar with the front: {formatNumber(r.front!, "kW")}</div>
              <div className="num" style={{ color: GRID }}>Bought, knowing: {formatNumber(r.import!, "kW")}</div>
              <div className="num text-muted">Bought, not knowing: {formatNumber(r.importUnaware!, "kW")}</div>
              <div className="num" style={{ color: BATTERY }}>Charging, knowing: {formatNumber(r.charging!, "kW")}</div>
              <div className="num text-muted">Charging, not knowing: {formatNumber(r.chargingUnaware!, "kW")}</div>
            </div>
          );
        }}
      />
      {Number.isFinite(from) && Number.isFinite(to) && <ReferenceArea x1={from} x2={Math.min(to, rows[rows.length - 1]!.t + HOUR)} fill="var(--muted)" fillOpacity={0.12} label={{ value: "front", fontSize: 10, fill: "var(--muted)", position: "insideTop" }} />}
      <Area type="stepAfter" dataKey="clear" stroke={SOLAR} fill="none" strokeWidth={1.5} strokeDasharray="5 3" isAnimationActive={false} />
      <Area type="stepAfter" dataKey="front" stroke={SOLAR} fill={SOLAR} fillOpacity={0.4} strokeWidth={2} isAnimationActive={false} />
      <Line type="stepAfter" dataKey="import" stroke={GRID} strokeWidth={2} dot={false} isAnimationActive={false} />
      <Line type="stepAfter" dataKey="charging" stroke={BATTERY} strokeWidth={2} dot={false} isAnimationActive={false} />
    </Frame>
  );
}

/**
 * The cloud-front scenario (spec section 75): the day planned on the forecast sky and on a sky with a front crossing it, so the
 * advice and the with / without figures are the planner's. The front is one the person sets: nothing here observes a cloud.
 */
export function CloudFrontPanel({ id }: { id: string }) {
  const [arrival, setArrival] = useState("38");
  const [reduction, setReduction] = useState("22");
  const [duration, setDuration] = useState("3");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CloudFront | null>(null);

  async function run() {
    setError(null);
    const a = Number(arrival);
    const r = Number(reduction);
    const d = Number(duration);
    if (!(a >= 1 && a <= 720)) return setError("The front must arrive between 1 and 720 minutes from now.");
    if (!(r >= 1 && r <= 95)) return setError("The front must take between 1 and 95 percent of the sun.");
    if (!(d >= 0.5 && d <= 12)) return setError("The front must take between half an hour and 12 hours to pass.");
    setBusy(true);
    try {
      setResult(await api<CloudFront>(`/api/properties/${id}/cloud-front`, { method: "POST", body: { arrivalMinutes: a, reductionPercent: r, durationHours: d } }));
    } catch (e) {
      const missing = e instanceof ApiError ? (e.details as { missing?: { why: string }[] } | undefined)?.missing : undefined;
      setError(missing?.length ? `${describeError(e)} ${missing.map((m) => m.why).join(" ")}` : describeError(e));
    } finally {
      setBusy(false);
    }
  }

  const v = result?.result.value;
  return (
    <section className="card mt-6 p-4" aria-labelledby="cloud-front">
      <h2 id="cloud-front" className="text-lg font-semibold">If a cloud front arrives</h2>
      <p className="mt-1 text-sm text-muted">
        Plans the next 24 hours twice, on the forecast sky and on a sky with a front crossing it, and shows what the plan does differently and what it saves. The front is a
        scenario you set: AVISHKAR has no cloud nowcast, so it cannot see one coming. The numbers in the boxes are an example, not a prediction.
      </p>
      <form
        aria-label="A cloud front"
        className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <div>
          <label htmlFor="cf-arrival" className="text-sm font-medium">Arrives in, minutes</label>
          <input id="cf-arrival" className="field mt-1" inputMode="decimal" value={arrival} onChange={(e) => setArrival(e.target.value)} />
        </div>
        <div>
          <label htmlFor="cf-reduction" className="text-sm font-medium">Takes this much sun, %</label>
          <input id="cf-reduction" className="field mt-1" inputMode="decimal" value={reduction} onChange={(e) => setReduction(e.target.value)} />
        </div>
        <div>
          <label htmlFor="cf-duration" className="text-sm font-medium">Takes this long to pass, hours</label>
          <input id="cf-duration" className="field mt-1" inputMode="decimal" value={duration} onChange={(e) => setDuration(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Planning twice…" : "Run the scenario"}</button>
      </form>
      <div aria-live="polite" className="mt-3">
        {busy && <p role="status" className="text-sm text-muted">Planning the day on both skies…</p>}
        {error && <p role="alert" className="rounded-md bg-[color:var(--tone-unavailable-bg)] p-3 text-sm text-[color:var(--tone-unavailable-fg)]">{error}</p>}
      </div>

      {result && v && (
        <div className="mt-3" aria-label="Cloud front result" role="region">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">{result.label}</p>
            <StatusBadge status={result.result.provenance.status} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Figure label="Solar output now" value={v.solarNowKw === null ? "—" : `${formatNumber(v.solarNowKw)} kW`} hint={v.solarNowKw === null ? "the forecast does not cover this hour" : "the forecast for this hour"} />
            <Figure label="Front arrives" value={`in ${formatNumber(result.request.arrivalMinutes)} min`} hint={`${formatDateTime(v.frontArrivesAt)}, passes by ${formatDateTime(v.frontEndsAt)}`} />
            <Figure label="Solar reduction" value={`${formatNumber(v.reductionPercent)}%`} hint={`takes ${formatNumber(v.solarLostKwh)} kWh${v.solarLostPercentOfDay === null ? "" : `, ${formatNumber(v.solarLostPercentOfDay)}% of the day's sun`}`} />
            <Figure label="Battery now" value={v.batteryNowPercent === null ? "no battery" : `${formatNumber(v.batteryNowPercent)}%`} hint={v.batteryNowBasis === "ASSUMPTION" ? "assumed: enter the real charge to change it" : v.batteryNowBasis === null ? undefined : "as you entered"} />
            <Figure label="Evening demand" value={v.eveningDemand ? DEMAND[v.eveningDemand.level]! : "—"} hint={v.eveningDemand ? `${formatNumber(v.eveningDemand.eveningMeanKw)} kW against a day's mean of ${formatNumber(v.eveningDemand.meanKw)} kW` : "no evening in the plan"} />
          </dl>

          <p role="status" className="mt-4 rounded-md p-3 text-base font-semibold" style={{ color: "var(--tone-live-fg)", background: "var(--tone-live-bg)" }}>
            {v.advice.text}
          </p>

          <h3 className="mt-5 text-base font-semibold">With and without AVISHKAR, over the next 24 hours</h3>
          <div className="overflow-x-auto">
            <table className="mt-2 w-full text-sm">
              <caption className="sr-only">Grid energy and cost without and with AVISHKAR on the sky with the front</caption>
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th scope="col" className="py-1 pr-4 font-medium"> </th>
                  <th scope="col" className="py-1 pr-4 font-medium">Bought from the grid</th>
                  <th scope="col" className="py-1 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody className="num">
                <tr className="border-t border-line">
                  <th scope="row" className="py-1.5 pr-4 text-left font-normal">Without AVISHKAR</th>
                  <td className="pr-4">{formatNumber(v.without.importKwh)} kWh</td>
                  <td>{formatInr(v.without.netCostInr)}</td>
                </tr>
                <tr className="border-t border-line">
                  <th scope="row" className="py-1.5 pr-4 text-left font-normal">With AVISHKAR</th>
                  <td className="pr-4">{formatNumber(v.with.importKwh)} kWh</td>
                  <td>{formatInr(v.with.netCostInr)}</td>
                </tr>
                <tr className="border-t border-line font-semibold">
                  <th scope="row" className="py-1.5 pr-4 text-left">Difference</th>
                  <td className="pr-4">{v.difference.importKwh < 0 ? `${formatNumber(-v.difference.importKwh)} kWh more` : `${formatNumber(v.difference.importKwh)} kWh less`}</td>
                  <td>{formatInr(v.difference.savingsInr)} saved</td>
                </tr>
              </tbody>
            </table>
          </div>
          {v.difference.importKwh < 0 && (
            <p className="mt-1 text-xs text-muted">The plan buys more from the grid because it buys cheap energy to store for the dear evening, so the bill falls while the energy bought rises.</p>
          )}
          <p className="mt-2 text-sm">
            On the forecast sky, with no front, the same day would cost <span className="num font-semibold">{formatInr(v.onForecastSky.withNetCostInr)}</span> with the plan and{" "}
            <span className="num font-semibold">{formatInr(v.onForecastSky.withoutNetCostInr)}</span> with no control. The front adds{" "}
            <span className="num font-semibold">{formatInr(v.frontCost.withAvishkarInr)}</span> to the plan&apos;s bill and{" "}
            <span className="num font-semibold">{formatInr(v.frontCost.withoutAvishkarInr)}</span> to the no-control bill.
          </p>
          {v.frontCost.withAvishkarInr > v.frontCost.withoutAvishkarInr + 0.005 && (
            <p className="mt-1 text-xs text-muted">The plan can lose more to a front than no control does because it had made more of the sun to begin with: the first two figures show the plan is still the cheaper day.</p>
          )}

          <div className="mt-4">
            <FrontChart s={result} />
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Chart key">
              <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-0 w-4 border-t-2 border-dashed" style={{ borderColor: SOLAR }} />Solar on the forecast sky</li>
              <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SOLAR, opacity: 0.6 }} />Solar with the front</li>
              <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-0 w-4 border-t-2" style={{ borderColor: GRID }} />Bought from the grid</li>
              <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-0 w-4 border-t-2" style={{ borderColor: BATTERY }} />Charging the battery</li>
            </ul>
          </div>

          <div className="mt-2"><ProvenanceDetails p={result.result.provenance} /></div>
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer font-medium">{result.assumptions.length} assumptions</summary>
            <ul className="mt-2 list-disc pl-5 text-muted">
              {result.assumptions.map((a) => <li key={a}>{a}</li>)}
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}
