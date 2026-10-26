import { formatInr, formatNumber } from "@/lib/format";
import type { Plan } from "@/lib/types";
import { StatusBadge } from "../Provenance";

const MOVE = { charge: "charges", discharge: "uses it", idle: "leaves it" } as const;

/**
 * The plan's next move with its reasons (spec section 45): what to do, WHY, DATA USED, ASSUMPTIONS, EXPECTED BENEFIT and
 * CONFIDENCE. Confidence is a count of forecasts in which the planner gives the same advice, never a percentage made up.
 */
export function RecommendationCard({ plan }: { plan: Plan }) {
  const r = plan.recommendation;
  if (!r) return null;
  const c = r.confidence;
  return (
    <section className="card mt-4 p-4" aria-labelledby="recommendation">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="recommendation" className="text-lg font-semibold">What to do next</h2>
        <StatusBadge status={plan.result.provenance.status} />
      </div>
      <p className="mt-2 text-xl font-semibold">{r.headline}</p>

      <dl className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Why</dt>
          <dd>
            {r.why.length > 0 ? (
              <ul className="mt-1 list-disc pl-5 text-sm">
                {r.why.map((w) => <li key={w}>{w}</li>)}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-muted">There is no single price or flow behind this: it follows from the plan as a whole.</p>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Expected benefit</dt>
          <dd className="mt-1 text-sm">
            <span className="num text-lg font-semibold">{formatInr(r.expectedBenefit.savingsInr)}</span> saved over the {plan.horizon.steps} hours against no control.
            <span className="block text-xs text-muted">{r.expectedBenefit.basis}</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Data used</dt>
          <dd>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {r.dataUsed.map((d) => <li key={d}>{d}</li>)}
            </ul>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Confidence</dt>
          <dd className="mt-1 text-sm">
            <span className="badge" data-tone={!c.assessed ? "unavailable" : c.agreeing === c.total ? "live" : "updated"}>
              {c.assessed ? `${c.agreeing} of ${c.total} forecasts agree` : "not assessed"}
            </span>
            <p className="mt-1">{c.statement}</p>
          </dd>
        </div>
      </dl>

      {c.assessed && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-medium">The forecasts tried</summary>
          <div className="overflow-x-auto">
            <table className="mt-2 w-full text-sm">
              <caption className="sr-only">The battery in the next three hours under each forecast tried</caption>
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th scope="col" className="py-1 pr-3 font-medium">Forecast</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Battery, hour by hour</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Stored / released</th>
                  <th scope="col" className="py-1 font-medium">Same advice</th>
                </tr>
              </thead>
              <tbody>
                {c.scenarios.map((s) => (
                  <tr key={s.label} className="border-t border-line align-top">
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal">{s.label}</th>
                    <td className="pr-3">{s.moves.length ? s.moves.map((m) => MOVE[m]).join(", ") : "no plan"}</td>
                    <td className="num pr-3">{s.chargeKwh === null ? "—" : `${formatNumber(s.chargeKwh)} / ${formatNumber(s.dischargeKwh ?? 0)} kWh`}</td>
                    <td>{s.agrees === null ? "no plan" : s.agrees ? "yes" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <details className="mt-2 text-sm">
        <summary className="cursor-pointer font-medium">{r.assumptions.length} assumptions</summary>
        <ul className="mt-2 list-disc pl-5 text-muted">
          {r.assumptions.map((a) => <li key={a}>{a}</li>)}
        </ul>
      </details>
    </section>
  );
}
