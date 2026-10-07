"use client";

import { useState } from "react";
import { api, describeError } from "@/lib/api";
import { formatInr } from "@/lib/format";
import { USAGE_PATTERNS, type UsagePattern, hourShareFor } from "@/lib/tariff";
import type { Bill, TariffPlan } from "@/lib/types";
import { Measure } from "../Provenance";

/**
 * A monthly bill estimate under one plan. Consumption is typed in by the person (AVISHKAR has no meter data for them yet),
 * so the result is labelled ESTIMATED and lists what it assumed and what it leaves out.
 */
export function BillEstimator({ plan }: { plan: TariffPlan }) {
  const [kwh, setKwh] = useState("");
  const [load, setLoad] = useState("");
  const [pattern, setPattern] = useState<UsagePattern>("even");
  const [state, setState] = useState<{ busy: boolean; error: string | null; bill: Bill | null; forPlan: string | null }>({ busy: false, error: null, bill: null, forPlan: null });

  const perKw = plan.fixedCharge?.basis === "PER_KW_MONTH";
  const timeOfDay = new Set(plan.hourlyRates).size > 1 && !plan.slabs;
  const monthly = Number(kwh);
  const valid = kwh.trim() !== "" && Number.isFinite(monthly) && monthly >= 0;
  // A result belongs to the plan it was computed for; switching plan hides it rather than showing a stale figure.
  const bill = state.forPlan === plan.id ? state.bill : null;

  async function estimate() {
    setState({ busy: true, error: null, bill: null, forPlan: plan.id });
    try {
      const body: { monthlyKwh: number; hourShare?: number[]; sanctionedLoadKw?: number } = { monthlyKwh: monthly };
      const shape = timeOfDay ? hourShareFor(pattern) : undefined;
      if (shape) body.hourShare = shape;
      if (perKw && Number(load) > 0) body.sanctionedLoadKw = Number(load);
      const result = await api<Bill>(`/api/tariffs/${plan.id}/bill`, { method: "POST", body });
      setState({ busy: false, error: null, bill: result, forPlan: plan.id });
    } catch (e) {
      setState({ busy: false, error: describeError(e), bill: null, forPlan: plan.id });
    }
  }

  return (
    <section className="card p-4" aria-label="Estimate a monthly bill">
      <h2 className="text-base font-semibold">Estimate a monthly bill</h2>
      <p className="mt-0.5 text-xs text-muted">Using {plan.name}. This is a calculation from the numbers you give, not a bill.</p>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) void estimate();
        }}
      >
        <label className="text-sm">
          <span className="text-muted">Energy used in a month (kWh)</span>
          <input className="field mt-1" inputMode="decimal" value={kwh} onChange={(e) => setKwh(e.target.value)} placeholder="from your bill" />
        </label>
        {perKw && (
          <label className="text-sm">
            <span className="text-muted">Sanctioned load (kW)</span>
            <input className="field mt-1" inputMode="decimal" value={load} onChange={(e) => setLoad(e.target.value)} placeholder="needed for the fixed charge" />
          </label>
        )}
        {timeOfDay && (
          <label className="text-sm sm:col-span-2">
            <span className="text-muted">When the energy is used (an assumption you choose)</span>
            <select className="field mt-1" value={pattern} onChange={(e) => setPattern(e.target.value as UsagePattern)}>
              {USAGE_PATTERNS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}: {p.note}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="sm:col-span-2">
          <button type="submit" className="btn btn-primary" disabled={!valid || state.busy}>
            {state.busy ? "Calculating…" : "Estimate"}
          </button>
        </div>
      </form>

      {state.error && state.forPlan === plan.id && (
        <p role="alert" className="mt-3 rounded-md bg-[color:var(--tone-unavailable-bg)] p-2 text-sm text-[color:var(--tone-unavailable-fg)]">
          {state.error}
        </p>
      )}

      {bill && (
        <div className="mt-4" aria-live="polite">
          <div className="divide-y divide-line">
            <Measure label="Estimated bill for the month" m={bill.total} digits={2} />
            <Measure label="Energy charge" m={bill.energyCharge} digits={2} />
            <Measure label="Fixed charge" m={bill.fixedCharge} digits={2} />
          </div>
          {bill.effectiveRateInrPerKwh !== null && <p className="mt-2 text-sm text-muted">That is {formatInr(bill.effectiveRateInrPerKwh)} for each kWh on average.</p>}
          <table className="mt-3 w-full text-sm">
            <caption className="sr-only">How the bill is made up</caption>
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1 font-medium">Line</th>
                <th className="py-1 text-right font-medium">kWh</th>
                <th className="py-1 text-right font-medium">Rate</th>
                <th className="py-1 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {bill.lines.map((l) => (
                <tr key={l.label} className="border-t border-line">
                  <td className="py-1">{l.label}</td>
                  <td className="num py-1 text-right">{l.kwh ?? ""}</td>
                  <td className="num py-1 text-right">{l.rate === null ? "" : formatInr(l.rate)}</td>
                  <td className="num py-1 text-right">{formatInr(l.amountInr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="mt-3 list-disc pl-5 text-sm text-muted">
            {bill.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
