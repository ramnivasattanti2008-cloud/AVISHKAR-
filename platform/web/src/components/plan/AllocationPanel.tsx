"use client";

import { formatInr, formatNumber } from "@/lib/format";
import type { EnergyAllocation } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { ProvenanceDetails, StatusBadge } from "../Provenance";

/** A row of a flow table: a kWh figure with what it was worth, where that can be said. */
function Flow({ label, kwh, hint }: { label: string; kwh: number; hint?: string }) {
  return (
    <tr className="border-t border-line">
      <th scope="row" className="py-1.5 pr-4 text-left font-normal">{label}</th>
      <td className="num pr-4">{formatNumber(kwh)} kWh</td>
      <td className="text-xs text-muted">{hint ?? ""}</td>
    </tr>
  );
}

/**
 * Where every kWh of the latest plan came from and went to (spec section 19). The split follows an order the API states and this
 * panel repeats, because the optimiser does not record which kWh went where: it is an accounting convention, not a measurement.
 */
export function AllocationPanel({ id }: { id: string }) {
  const { data, loading, error } = useApi<EnergyAllocation>(`/api/properties/${id}/allocation`);

  if (loading) return <p role="status" className="mt-4 text-sm text-muted">Following the energy of the plan…</p>;
  if (error) return <p role="alert" className="mt-4 text-sm text-[color:var(--tone-unavailable-fg)]">{error}</p>;
  if (!data) return null;

  const t = data.totals.value;
  return (
    <section className="card mt-4 p-4" aria-labelledby="allocation">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="allocation" className="text-lg font-semibold">Where every kWh went</h2>
        <StatusBadge status={data.totals.provenance.status} />
      </div>

      {!t ? (
        <p className="mt-2 text-sm text-muted">{data.totals.provenance.notes.at(-1)}</p>
      ) : (
        <>
          <div className="mt-3 grid gap-5 lg:grid-cols-2">
            <div>
              <h3 className="text-base font-semibold">The sun</h3>
              <table className="mt-1 w-full text-sm">
                <caption className="sr-only">Where the solar energy of the plan went</caption>
                <tbody>
                  <Flow label="Used as it was made" kwh={t.solar.toDemandKwh} />
                  <Flow label="Stored in the battery" kwh={t.solar.toBatteryKwh} />
                  <Flow label="Sold to the grid" kwh={t.solar.soldKwh} hint={t.money.soldInr > 0 ? `earned ${formatInr(t.money.soldInr)} in all` : undefined} />
                  <Flow label="Thrown away" kwh={t.solar.thrownAwayKwh} hint={t.solar.thrownAwayKwh > 0.005 ? "could be neither used, stored nor sold" : undefined} />
                  <tr className="border-t-2 border-line font-semibold">
                    <th scope="row" className="py-1.5 pr-4 text-left">Made in all</th>
                    <td className="num pr-4">{formatNumber(t.solar.madeKwh)} kWh</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>

            <div>
              <h3 className="text-base font-semibold">What you used</h3>
              <table className="mt-1 w-full text-sm">
                <caption className="sr-only">What met the demand of the plan</caption>
                <tbody>
                  <Flow label="Straight from the sun" kwh={t.demand.fromSolarKwh} />
                  <Flow
                    label="From the battery"
                    kwh={t.demand.fromBatteryKwh}
                    hint={t.money.batteryDisplacedInr > 0 ? `worth ${formatInr(t.money.batteryDisplacedInr)} at the hours it was used` : undefined}
                  />
                  <Flow label="Bought from the grid" kwh={t.demand.fromGridKwh} hint={`cost ${formatInr(t.money.boughtForDemandInr)}`} />
                  <tr className="border-t-2 border-line font-semibold">
                    <th scope="row" className="py-1.5 pr-4 text-left">Served in all</th>
                    <td className="num pr-4">{formatNumber(t.demand.servedKwh)} kWh</td>
                    <td className="text-xs font-normal text-muted">{t.demand.servedKwh < t.demand.kwh - 0.005 ? `of ${formatNumber(t.demand.kwh)} kWh wanted` : ""}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {t.battery && (
            <div className="mt-5">
              <h3 className="text-base font-semibold">The battery</h3>
              <dl className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted">Took in</dt>
                  <dd className="num text-lg font-semibold">{formatNumber(t.battery.inKwh)} kWh</dd>
                  <dd className="text-xs text-muted">{formatNumber(t.grid.forBatteryKwh)} kWh of it bought, {formatInr(t.money.boughtForBatteryInr)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Gave back</dt>
                  <dd className="num text-lg font-semibold">{formatNumber(t.battery.outKwh)} kWh</dd>
                  <dd className="text-xs text-muted">{formatNumber(t.battery.outFromSolarKwh)} kWh of it stored sun</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Lost to charging</dt>
                  <dd className="num text-lg font-semibold">{formatNumber(t.battery.lostKwh)} kWh</dd>
                  <dd className="text-xs text-muted">in and out again is never free</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Left in it</dt>
                  <dd className="num text-lg font-semibold">{formatNumber(t.battery.levelChangeKwh)} kWh</dd>
                  <dd className="text-xs text-muted">more than it began with</dd>
                </div>
              </dl>
              {t.money.storedSolarDisplacedInr > 0 && (
                <p className="mt-2 text-sm">
                  The sun you stored and used later saved buying <span className="num font-semibold">{formatInr(t.money.storedSolarDisplacedInr)}</span> of grid energy at the prices of the hours it was
                  used. That is not the plan&apos;s saving, which is measured against the same day with no control.
                </p>
              )}
            </div>
          )}

          <details className="mt-4 text-sm text-muted">
            <summary className="cursor-pointer select-none underline decoration-dotted underline-offset-2">how this is worked out</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5" aria-label="The order the energy is attributed in">
              {data.rule.map((r) => <li key={r}>{r}</li>)}
            </ol>
            <p className="mt-2">{data.check.note}</p>
            <p className="mt-1">
              {data.check.balanced
                ? "Checked: every kWh of every hour is in exactly one place."
                : `The books do not close: one hour is out by ${formatNumber(data.check.maxHourErrorKwh)} kWh.`}
            </p>
            <div className="mt-1"><ProvenanceDetails p={data.totals.provenance} /></div>
          </details>
        </>
      )}
    </section>
  );
}
