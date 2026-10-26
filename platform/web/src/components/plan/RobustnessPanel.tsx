"use client";

import { formatInr, formatNumber } from "@/lib/format";
import type { PlanRobustness } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { ProvenanceDetails, StatusBadge } from "../Provenance";

/**
 * How the plan that was chosen holds up if the day turns out differently (spec sections 17 and 18). The plan keeps its own moves
 * and is replayed against the ends of the forecasts' own bands, so this answers "what happens to the plan I am following", which
 * the Futures tab does not: that one re-plans each day knowing what it will be.
 */
export function RobustnessPanel({ id }: { id: string }) {
  const { data, loading, error } = useApi<PlanRobustness>(`/api/properties/${id}/robustness`);

  if (loading) return <p role="status" className="mt-4 text-sm text-muted">Putting the plan under a worse day…</p>;
  if (error) return <p role="alert" className="mt-4 text-sm text-[color:var(--tone-unavailable-fg)]">{error}</p>;
  if (!data) return null;

  const v = data.result.value;
  const dearer = (n: number) => (Math.abs(n) < 0.005 ? "the same" : `${n > 0 ? "+" : "−"}${formatInr(Math.abs(n))}`);

  return (
    <section className="card mt-4 p-4" aria-labelledby="robustness">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="robustness" className="text-lg font-semibold">If the day turns out differently</h2>
        <StatusBadge status={data.result.provenance.status} />
      </div>
      <p className="mt-1 text-sm text-muted">
        The same plan, with its own battery moves and appliance starts kept, on a day that is not the one it was made for. The days
        come from the ends of your forecasts&apos; own bands, not from guesses, and none of them carries a probability.
      </p>

      {!v ? (
        <p className="mt-2 text-sm text-muted">{data.result.provenance.notes.at(-1)}</p>
      ) : (
        <>
          <p role="status" className="mt-3 rounded-md bg-surface2 p-3 text-sm">{v.statement}</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">What the plan costs on the day it was made for and on each of the other days</caption>
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th scope="col" className="py-1 pr-4 font-medium">The day</th>
                  <th scope="col" className="py-1 pr-4 font-medium">What the plan then costs</th>
                  <th scope="col" className="py-1 pr-4 font-medium">Against the day it was made for</th>
                  <th scope="col" className="py-1 font-medium">Bought</th>
                </tr>
              </thead>
              <tbody className="num">
                <tr className="border-t border-line">
                  <th scope="row" className="py-1.5 pr-4 text-left font-semibold">The day it was made for</th>
                  <td className="pr-4 font-semibold">{formatInr(v.expected.netCostInr)}</td>
                  <td className="pr-4 text-muted">—</td>
                  <td>{formatNumber(v.expected.importKwh)} kWh</td>
                </tr>
                {data.scenarios.map((s) => (
                  <tr key={s.key} className="border-t border-line align-top">
                    <th scope="row" className="py-1.5 pr-4 text-left font-normal">
                      <div>{s.label}</div>
                      <details className="mt-0.5 text-xs text-muted">
                        <summary className="cursor-pointer select-none underline decoration-dotted underline-offset-2">what this day is</summary>
                        <p className="mt-1 max-w-md">{s.built}</p>
                      </details>
                    </th>
                    {s.result ? (
                      <>
                        <td className="py-1.5 pr-4">{formatInr(s.result.netCostInr)}</td>
                        <td className="py-1.5 pr-4">{dearer(s.result.vsExpectedInr)}</td>
                        <td className="py-1.5">{formatNumber(s.result.importKwh)} kWh</td>
                      </>
                    ) : (
                      <td className="py-1.5 text-sm text-muted" colSpan={3}>
                        <span className="badge mr-2" data-tone="unavailable">Cannot be tried</span>
                        {s.reason}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-muted">{v.whyNothingFails}</p>
          <div className="mt-1"><ProvenanceDetails p={data.result.provenance} /></div>
        </>
      )}
    </section>
  );
}
