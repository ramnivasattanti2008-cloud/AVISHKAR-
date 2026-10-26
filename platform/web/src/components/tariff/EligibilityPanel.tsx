"use client";

import { useId, useState } from "react";
import { api, describeError } from "@/lib/api";
import { formatDateTime, formatInr } from "@/lib/format";
import { STATES } from "@/lib/states";
import type { Eligibility, ProgramResult } from "@/lib/types";
import { Measure } from "../Provenance";

type Consumer = Eligibility["consumerType"];

const CONSUMERS: { id: Consumer; label: string }[] = [
  { id: "RESIDENTIAL", label: "A household (residential)" },
  { id: "GROUP_HOUSING_OR_RWA", label: "A housing society or resident welfare association" },
  { id: "COMMERCIAL", label: "A shop, office or clinic (commercial)" },
  { id: "INDUSTRIAL", label: "Industrial" },
  { id: "AGRICULTURAL", label: "Agricultural" },
  { id: "OTHER", label: "Other" },
];

const OUTCOME_TEXT: Record<ProgramResult["outcome"], string> = {
  RULE_APPLIES: "A published rule was applied to the size you gave.",
  NOT_COVERED: "The rule on file is for other consumers, so nothing is calculated.",
  NO_SOURCED_RULE: "No sourced rule is loaded, so AVISHKAR states nothing.",
  RULE_ON_FILE_NOT_EVALUATED: "A rule is on file, but it cannot be turned into a number from what it states.",
};

/**
 * Subsidy and net-metering rules applied to a system size (spec sections 23 and 24). It shows the rule, its source and when it
 * was last checked, and it never says that anyone is eligible: that is for the distribution company and the national portal.
 */
export function EligibilityPanel({ suggestedKwp }: { suggestedKwp?: number | null }) {
  const hintId = useId();
  const [consumer, setConsumer] = useState<Consumer>("RESIDENTIAL");
  const [kwp, setKwp] = useState(suggestedKwp ? String(Math.round(suggestedKwp * 10) / 10) : "");
  const [state, setState] = useState("");
  const [run, setRun] = useState<{ busy: boolean; error: string | null; result: Eligibility | null }>({ busy: false, error: null, result: null });

  const size = Number(kwp);
  const valid = kwp.trim() !== "" && Number.isFinite(size) && size > 0;

  async function check() {
    setRun({ busy: true, error: null, result: null });
    try {
      const body: { consumerType: Consumer; systemKwp: number; state?: string } = { consumerType: consumer, systemKwp: size };
      if (state) body.state = state;
      setRun({ busy: false, error: null, result: await api<Eligibility>("/api/eligibility", { method: "POST", body }) });
    } catch (e) {
      setRun({ busy: false, error: describeError(e), result: null });
    }
  }

  return (
    <section className="card p-4" aria-label="Subsidy and net-metering rules">
      <h2 className="text-base font-semibold">Subsidy and net metering</h2>
      <p className="mt-0.5 text-xs text-muted">Applies the published rules on file to a system size. It does not confirm that you qualify.</p>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) void check();
        }}
      >
        <label className="text-sm sm:col-span-2">
          <span className="text-muted">Who the system is for</span>
          <select className="field mt-1" value={consumer} onChange={(e) => setConsumer(e.target.value as Consumer)}>
            {CONSUMERS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <div className="text-sm">
          <label htmlFor={`${hintId}-kwp`} className="text-muted">
            System size (kWp)
          </label>
          <input
            id={`${hintId}-kwp`}
            className="field mt-1"
            inputMode="decimal"
            value={kwp}
            onChange={(e) => setKwp(e.target.value)}
            placeholder={suggestedKwp ? undefined : "for example 3"}
            aria-describedby={suggestedKwp ? hintId : undefined}
          />
          {suggestedKwp ? (
            <p id={hintId} className="mt-0.5 text-xs text-muted">
              Filled in from the roof-area estimate of this property; change it to the size you are quoted.
            </p>
          ) : null}
        </div>
        <label className="text-sm">
          <span className="text-muted">State (optional)</span>
          <select className="field mt-1" value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">Not specified</option>
            {STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <div className="sm:col-span-2">
          <button type="submit" className="btn btn-primary" disabled={!valid || run.busy}>
            {run.busy ? "Checking…" : "Apply the rules"}
          </button>
        </div>
      </form>

      {run.error && (
        <p role="alert" className="mt-3 rounded-md bg-[color:var(--tone-unavailable-bg)] p-2 text-sm text-[color:var(--tone-unavailable-fg)]">
          {run.error}
        </p>
      )}

      {run.result && (
        <div className="mt-4 flex flex-col gap-4" aria-live="polite">
          {[...run.result.programs, run.result.netMetering].map((p) => (
            <Program key={p.program} p={p} />
          ))}
          <p className="rounded-md bg-[color:var(--tone-updated-bg)] p-2 text-sm text-[color:var(--tone-updated-fg)]">{run.result.notice}</p>
        </div>
      )}
    </section>
  );
}

function Program({ p }: { p: ProgramResult }) {
  return (
    <div className="border-t border-line pt-3">
      <h3 className="text-sm font-semibold">{p.name}</h3>
      <p className="mt-0.5 text-xs text-muted">{OUTCOME_TEXT[p.outcome]}</p>
      <Measure label={p.program === "NET_METERING" ? "Net-metering answer" : "Subsidy (not a confirmed entitlement)"} m={p.subsidy} digits={0} />
      {p.breakdown.length > 0 && (
        <table className="mt-1 w-full text-sm">
          <caption className="sr-only">How the subsidy is added up</caption>
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1 font-medium">Capacity band</th>
              <th className="py-1 text-right font-medium">kW</th>
              <th className="py-1 text-right font-medium">Per kW</th>
              <th className="py-1 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {p.breakdown.map((s) => (
              <tr key={s.fromKw} className="border-t border-line">
                <td className="py-1">
                  {s.fromKw} to {s.toKw} kW
                </td>
                <td className="num py-1 text-right">{s.kw}</td>
                <td className="num py-1 text-right">{formatInr(s.inrPerKw)}</td>
                <td className="num py-1 text-right">{formatInr(s.amountInr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {p.caveats.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-sm text-muted">
          {p.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
      {p.rules.map((r) => (
        <details key={r.ruleKey + r.region} className="mt-2 text-sm">
          <summary className="cursor-pointer select-none text-muted underline decoration-dotted underline-offset-2">The rule, as its source states it</summary>
          {r.statedAs && <p className="mt-1">{r.statedAs}</p>}
          <p className="mt-1 text-muted">
            {r.source}
            {r.verifiedAt ? ` Last checked at the source on ${formatDateTime(r.verifiedAt).split(",")[0]}.` : " No one has recorded when this was last checked."}
          </p>
          {r.sourceUrl && (
            <p className="mt-1">
              <a className="text-accent underline" href={r.sourceUrl} target="_blank" rel="noreferrer">
                {r.sourceUrl}
              </a>
            </p>
          )}
        </details>
      ))}
    </div>
  );
}
