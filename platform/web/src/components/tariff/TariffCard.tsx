import type { ReactNode } from "react";
import { formatInr } from "@/lib/format";
import { EXPORT_BASIS_LABELS, METERING_LABELS, describePlan, rateSummary } from "@/lib/tariff";
import type { TariffPlan } from "@/lib/types";
import { ProvenanceDetails, StatusBadge } from "../Provenance";
import { RateBars } from "./RateBars";

/** A tariff plan as the platform holds it: its rates, what it assumes, where it comes from and whether it may be out of date. */
export function TariffCard({ plan, actions, compact = false }: { plan: TariffPlan; actions?: ReactNode; compact?: boolean }) {
  const r = rateSummary(plan);
  const v = plan.validity;
  const warn = v.status !== "WITHIN";
  return (
    <article className="card p-4" aria-label={plan.name}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">{plan.name}</h3>
          <p className="text-sm text-muted">{describePlan(plan)}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge" data-tone={plan.origin === "USER" ? "estimated" : "reference"} title={plan.origin === "USER" ? "You entered this tariff; only you can see it." : "From a regulator order recorded with its source."}>
            {plan.origin === "USER" ? "YOURS" : "CATALOGUE"}
          </span>
          <StatusBadge status={plan.provenance.status} />
        </div>
      </header>

      <p
        role={warn ? "alert" : undefined}
        className={`mt-3 rounded-md p-2 text-sm ${warn ? "bg-[color:var(--tone-updated-bg)] text-[color:var(--tone-updated-fg)]" : "text-muted"}`}
        data-validity={v.status}
      >
        {v.message}
      </p>

      {!compact && (
        <div className="mt-3">
          <RateBars rates={plan.hourlyRates} />
        </div>
      )}

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Energy rate</dt>
        <dd className="num">{r.min === r.max ? `${formatInr(r.min)} per kWh` : `${formatInr(r.min)} to ${formatInr(r.max)} per kWh${plan.slabs ? ", by monthly usage" : r.timeOfDay ? ", by time of day" : ""}`}</dd>
        {plan.slabs && (
          <>
            <dt className="text-muted">Slabs</dt>
            <dd className="num">
              {plan.slabs.map((s, i) => (
                <span key={i} className="block">
                  {s.upToKwhPerMonth === null ? `Above ${plan.slabs![i - 1]?.upToKwhPerMonth ?? 0} kWh` : `Up to ${s.upToKwhPerMonth} kWh`}: {formatInr(s.rate)}
                </span>
              ))}
            </dd>
          </>
        )}
        <dt className="text-muted">Fixed charge</dt>
        <dd>{plan.fixedCharge ? `${formatInr(plan.fixedCharge.amountInr)} ${plan.fixedCharge.basis === "PER_KW_MONTH" ? "per kW per month" : "per connection per month"}` : "None recorded"}</dd>
        <dt className="text-muted">Export credit</dt>
        <dd>{plan.export.rate === null ? "None recorded" : `${formatInr(plan.export.rate)} per kWh, ${EXPORT_BASIS_LABELS[plan.export.basis]}`}</dd>
        <dt className="text-muted">Metering</dt>
        <dd>{METERING_LABELS[plan.export.meteringMode]}</dd>
      </dl>

      {plan.notes.length > 0 && (
        <ul className="mt-3 list-disc pl-5 text-sm text-muted">
          {plan.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer select-none text-muted underline decoration-dotted underline-offset-2">Where these numbers come from</summary>
        <p className="mt-1">{plan.source}</p>
        {plan.sourceUrl && (
          <p className="mt-1">
            <a className="text-accent underline" href={plan.sourceUrl} target="_blank" rel="noreferrer">
              {plan.sourceUrl}
            </a>
          </p>
        )}
        <div className="mt-2">
          <ProvenanceDetails p={plan.provenance} />
        </div>
      </details>

      {actions && <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">{actions}</div>}
    </article>
  );
}
