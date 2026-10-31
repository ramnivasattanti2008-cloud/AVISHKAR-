import { formatInr, formatNumber } from "@/lib/format";
import type { Plan } from "@/lib/types";

/** A risk-aware plan: what each day it was made for would cost with its one battery schedule (spec sections 17 and 18). */
export function RiskPanel({ risk }: { risk: NonNullable<Plan["risk"]> }) {
  return (
    <section className="card mt-4 p-4" aria-label="Days this plan was made for">
      <h2 className="text-base font-semibold">Days this plan was made for</h2>
      <p className="mt-1 text-sm text-muted">{risk.statement}</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th scope="col" className="py-1 pr-3 font-medium">Day</th>
              <th scope="col" className="py-1 pr-3 font-medium">Weight</th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">Net cost</th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">Bought</th>
            </tr>
          </thead>
          <tbody>
            {risk.scenarios.map((s) => (
              <tr key={s.label} className="border-t border-line align-top">
                <th scope="row" className="py-1 pr-3 font-normal">
                  <span className="font-medium">{s.label}</span>
                  <span className="block text-xs text-muted">{s.built}</span>
                  {s.unservedKwh > 0.005 && <span className="block text-xs text-[color:var(--tone-updated-fg)]">{formatNumber(s.unservedKwh)} kWh could not be supplied</span>}
                </th>
                <td className="num py-1 pr-3">{formatNumber(s.weight)}</td>
                <td className="num py-1 pr-3 text-right">{formatInr(s.netCostInr)}</td>
                <td className="num py-1 pr-3 text-right">{formatNumber(s.importKwh)} kWh</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-xs text-muted">Weighted average</dt>
          <dd className="num font-semibold">{formatInr(risk.expectedNetCostInr)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Worst {Math.round((1 - risk.alpha) * 100)}% of weight</dt>
          <dd className="num font-semibold">{formatInr(risk.cvarNetCostInr)}</dd>
        </div>
      </dl>
    </section>
  );
}
