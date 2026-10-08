"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api, describeError } from "@/lib/api";
import { formatDateTime, formatInr, formatNumber, formatPercent } from "@/lib/format";
import type { Plan, PlanSummary } from "@/lib/types";
import { useAuth } from "../AuthProvider";
import { ProvenanceDetails, StatusBadge } from "../Provenance";
import { PropertyTabs } from "../property/PropertyTabs";
import { usePropertyData } from "../property/usePropertyData";
import { CloudFrontPanel } from "./CloudFrontPanel";
import { RecommendationCard } from "./RecommendationCard";
import { BatteryChart, PriceChart, SERIES, SourcesChart } from "./PlanCharts";

export const MODES = [
  { value: "BALANCED", label: "Balanced", about: "The lowest bill with a small preference for using your own solar rather than buying power." },
  { value: "SAVE_MONEY", label: "Save money", about: "The lowest possible bill, whatever else that means." },
  { value: "INDEPENDENCE", label: "Independence", about: "Buys as little from the grid as it can, even if the bill is a little higher." },
  { value: "RESILIENCE", label: "Resilience", about: "Keeps about three hours of your critical loads in the battery in case the grid goes down." },
  { value: "GREEN", label: "Green", about: "Prefers your own solar and avoids buying power. No grid carbon figures are loaded yet, so it cannot weigh carbon hour by hour." },
  { value: "REVENUE", label: "Revenue", about: "Leans toward earning from energy you export." },
] as const;

const time = new Intl.DateTimeFormat("en-IN", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const KIND: Record<string, string> = {
  charge_battery: "Charge the battery",
  discharge_battery: "Use the battery",
  export: "Sell to the grid",
  curtail: "Solar not used",
  ev_charge: "Charge the car",
  appliance: "Run an appliance",
  import_peak: "Buy at a high price",
  shed: "Switch off non-critical load",
};

interface Missing {
  what: "tariff" | "load";
  why: string;
}

const LINKS: Record<Missing["what"], { href: (id: string) => string; label: string }> = {
  tariff: { href: (id) => `/property/${id}/tariff`, label: "Choose a tariff" },
  load: { href: (id) => `/property/${id}/meter-data`, label: "Import meter data" },
};

function Figure({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`num ${strong ? "text-2xl" : "text-lg"} font-semibold`}>{value}</dd>
      {hint && <dd className="text-xs text-muted">{hint}</dd>}
    </div>
  );
}

/** Make a plan for the next day or two, and see exactly what it does, why, and what it assumed (spec sections 17 to 21, 64). */
export function PlanView({ id }: { id: string }) {
  const { user, loading: authLoading } = useAuth();
  const { property, loading, error, notFound } = usePropertyData(id);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [history, setHistory] = useState<PlanSummary[]>([]);
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ message: string; missing: Missing[]; problems: string[] } | null>(null);
  const [mode, setMode] = useState<string>("BALANCED");
  const [hours, setHours] = useState<24 | 48>(24);
  const [soc, setSoc] = useState("");
  const [showAll, setShowAll] = useState(false);
  const ready = Boolean(user && property);

  const refreshHistory = useCallback(() => api<{ plans: PlanSummary[] }>(`/api/properties/${id}/plans`).then((r) => setHistory(r.plans)).catch(() => setHistory([])), [id]);

  useEffect(() => {
    if (!ready) return;
    let live = true;
    api<Plan>(`/api/properties/${id}/plan`)
      .then((p) => live && setPlan(p))
      .catch((e) => {
        if (live && !(e instanceof ApiError && e.status === 404)) setFailure({ message: describeError(e), missing: [], problems: [] });
      })
      .finally(() => live && setBooting(false));
    void refreshHistory();
    return () => {
      live = false;
    };
  }, [id, ready, refreshHistory]);

  if (loading || authLoading) return <p role="status" className="p-6 text-sm text-muted">Loading…</p>;
  if (!user || notFound) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold">Property not found</h1>
        <p className="mt-3 text-muted">
          {user ? "This property does not exist or is not yours." : "Sign in to plan."}{" "}
          <Link className="font-semibold text-accent underline" href={user ? "/properties" : `/login?next=/property/${id}/plan`}>
            {user ? "Back to your properties" : "Sign in"}
          </Link>
        </p>
      </div>
    );
  }
  if (error || !property) return <p role="alert" className="p-6 text-sm text-[color:var(--tone-unavailable-fg)]">{error ?? "Could not load the property."}</p>;

  async function make() {
    setBusy(true);
    setFailure(null);
    const pct = soc.trim() === "" ? null : Number(soc);
    if (pct !== null && !(pct >= 0 && pct <= 100)) {
      setFailure({ message: "The battery charge must be between 0 and 100 percent, or left empty if you do not know it.", missing: [], problems: [] });
      setBusy(false);
      return;
    }
    try {
      const p = await api<Plan>(`/api/properties/${id}/plan`, { method: "POST", body: { mode, hours, startSocPercent: pct } });
      setPlan(p);
      setShowAll(false);
      void refreshHistory();
    } catch (e) {
      const d = e instanceof ApiError ? (e.details as { missing?: Missing[]; problems?: string[] } | undefined) : undefined;
      setFailure({ message: describeError(e), missing: d?.missing ?? [], problems: d?.problems ?? [] });
    } finally {
      setBusy(false);
    }
  }

  async function open(planId: string) {
    setFailure(null);
    try {
      setPlan(await api<Plan>(`/api/properties/${id}/plans/${planId}`));
      setShowAll(false);
    } catch (e) {
      setFailure({ message: describeError(e), missing: [], problems: [] });
    }
  }

  const r = plan?.result.value;
  const decisions = plan?.decisions ?? [];
  const shown = showAll ? decisions : decisions.slice(0, 10);
  const chosen = MODES.find((m) => m.value === mode);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <header>
        <h1 className="text-2xl font-bold">{property.name}</h1>
        <p className="text-sm text-muted">Plan for the next day or two</p>
      </header>
      <div className="mt-4">
        <PropertyTabs id={id} current="/plan" demo={property?.isDemo} />
      </div>

      <section className="card mt-4 p-4" aria-label="Make a plan">
        <form
          className="grid gap-3 sm:grid-cols-[1.4fr_1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void make();
          }}
        >
          <div>
            <label htmlFor="plan-mode" className="text-sm font-medium">What to favour</label>
            <select id="plan-mode" className="field mt-1" value={mode} onChange={(e) => setMode(e.target.value)} aria-describedby="plan-mode-about">
              {MODES.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="plan-hours" className="text-sm font-medium">How far ahead</label>
            <select id="plan-hours" className="field mt-1" value={hours} onChange={(e) => setHours(Number(e.target.value) as 24 | 48)}>
              <option value={24}>24 hours</option>
              <option value={48}>48 hours</option>
            </select>
          </div>
          <div>
            <label htmlFor="plan-soc" className="text-sm font-medium">Battery charge now, % (optional)</label>
            <input id="plan-soc" className="field mt-1" inputMode="decimal" placeholder="not known" value={soc} onChange={(e) => setSoc(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Planning…" : plan ? "Make a new plan" : "Make a plan"}</button>
        </form>
        <p id="plan-mode-about" className="mt-2 text-sm text-muted">{chosen?.about}</p>
      </section>

      <div aria-live="polite" className="mt-3">
        {failure && (
          <div role="alert" className="rounded-md bg-[color:var(--tone-unavailable-bg)] p-3 text-sm text-[color:var(--tone-unavailable-fg)]">
            <p>{failure.message}</p>
            {failure.missing.length > 0 && (
              <ul className="mt-2 list-disc pl-5">
                {failure.missing.map((m) => (
                  <li key={m.what}>
                    <Link className="font-semibold underline" href={LINKS[m.what].href(id)}>{LINKS[m.what].label}</Link>
                  </li>
                ))}
              </ul>
            )}
            {failure.problems.length > 0 && (
              <ul className="mt-2 list-disc pl-5">
                {failure.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {busy && <p role="status" className="text-sm text-muted">Planning against your tariff and the real forecasts…</p>}
      </div>

      {booting && !plan && !failure && <p role="status" className="mt-4 text-sm text-muted">Looking for your latest plan…</p>}
      {!booting && !plan && !failure && !busy && (
        <p className="mt-4 text-sm text-muted">
          No plan yet. A plan chooses when to charge and use the battery, when to buy and sell, and when to run flexible loads, from your tariff, your meter readings, the solar forecast and the equipment you entered. It needs a chosen tariff and meter data.
        </p>
      )}

      {plan && r && (
        <>
          <RecommendationCard plan={plan} />
          <section className="card mt-4 p-4" aria-label="Plan outcome">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">
                {MODES.find((m) => m.value === plan.mode)?.label} plan for the {plan.horizon.steps} hours from {formatDateTime(plan.horizon.start)}
              </h2>
              <StatusBadge status={plan.result.provenance.status} />
            </div>
            <p className="mt-1 text-sm text-muted">Made {formatDateTime(plan.createdAt)}. These are the outcomes the plan expects from forecasts: the real day will differ.</p>
            <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <Figure label="With this plan" value={formatInr(r.netCostInr)} hint="net of what you sell" />
              <Figure label="Same day, no control" value={formatInr(r.baselineNetCostInr)} hint="no battery control or shifting" />
              <Figure label="You save" value={formatInr(r.savingsInr)} strong hint={r.savingsInr < 0.005 ? "nothing to shift" : undefined} />
              <Figure label="Bought from the grid" value={`${formatNumber(r.importKwh)} kWh`} hint={r.exportKwh > 0.005 ? `sells ${formatNumber(r.exportKwh)} kWh` : undefined} />
              <Figure label="Solar put to use" value={r.selfConsumptionRatio === null ? "—" : formatPercent(r.selfConsumptionRatio)} hint={r.pvKwh > 0 ? `${formatNumber(r.pvUsedKwh)} of ${formatNumber(r.pvKwh)} kWh: used, stored or sold` : "no solar"} />
              <Figure label="Battery cycles" value={formatNumber(r.batteryCycles)} />
            </dl>
            {(r.unservedKwh > 0.005 || r.evShortfallKwh > 0.005) && (
              <p role="status" className="mt-3 rounded-md bg-[color:var(--tone-updated-bg)] p-3 text-sm text-[color:var(--tone-updated-fg)]">
                {r.unservedKwh > 0.005 && `${formatNumber(r.unservedKwh)} kWh of load cannot be supplied. `}
                {r.evShortfallKwh > 0.005 && `The car falls ${formatNumber(r.evShortfallKwh)} kWh short of its target by departure.`}
              </p>
            )}
            <div className="mt-2"><ProvenanceDetails p={plan.result.provenance} /></div>
          </section>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="card p-4" aria-label="Where the power comes from">
              <h2 className="text-base font-semibold">Where the power comes from</h2>
              <SourcesChart plan={plan} />
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Chart key">
                {SERIES.map((x) => (
                  <li key={x.key} className="flex items-center gap-1.5">
                    <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: x.color, opacity: 0.6 }} />
                    {x.label}
                  </li>
                ))}
                <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-0 w-4 border-t-2 border-dashed border-ink" />What you use</li>
              </ul>
              <p className="mt-1 text-xs text-muted">Where the stack is above the dashed line, the extra is charging the battery or being sold; the hover shows each flow.</p>
            </section>
            <div className="flex flex-col gap-4">
              {plan.inputs.battery && (
                <section className="card p-4" aria-label="Battery charge">
                  <h2 className="text-base font-semibold">Battery charge</h2>
                  <BatteryChart plan={plan} />
                  <p className="text-xs text-muted">
                    Starts at {formatNumber(plan.inputs.battery.startSocKwh)} kWh{plan.inputs.battery.startSocBasis === "ASSUMPTION" ? " (assumed: its charge is not known)" : ""} and ends no lower.
                  </p>
                </section>
              )}
              <section className="card p-4" aria-label="Price per kWh">
                <h2 className="text-base font-semibold">Price you pay and are paid</h2>
                <PriceChart plan={plan} />
                <p className="text-xs text-muted">Solid: buy. Dashed: sell. {plan.inputs.tariff.name}.</p>
              </section>
            </div>
          </div>

          <section className="card mt-4 p-4" aria-label="What the plan does">
            <h2 className="text-lg font-semibold">What the plan does, and why</h2>
            {plan.appliances.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-sm">
                {plan.appliances.map((a) => (
                  <li key={a.id}>
                    {a.startTime ? (
                      <>
                        <strong>{a.name}</strong>: run from {time.format(new Date(a.startTime))} for {a.runHours} h.
                      </>
                    ) : (
                      <>
                        <strong>{a.name}</strong>: not run in this plan.
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {decisions.length === 0 ? (
              <p className="mt-2 text-sm text-muted">Nothing to change: with this tariff and equipment the plan matches the day as it would run anyway.</p>
            ) : (
              <>
                <ol className="mt-2 divide-y divide-line text-sm">
                  {shown.map((d, i) => (
                    <li key={`${d.time}-${d.kind}-${i}`} className="grid gap-x-3 py-1.5 sm:grid-cols-[8.5rem_11rem_1fr]">
                      <span className="num text-muted">{time.format(new Date(d.time))}</span>
                      <span className="font-medium">{KIND[d.kind] ?? d.kind}<span className="num text-muted"> · {formatNumber(d.kwh)} kWh</span></span>
                      <span>{d.reason}</span>
                    </li>
                  ))}
                </ol>
                {decisions.length > 10 && (
                  <button type="button" className="btn mt-2" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? "Show fewer" : `Show all ${decisions.length}`}
                  </button>
                )}
              </>
            )}
          </section>

          <section className="card mt-4 p-4" aria-label="What the plan is based on">
            <h2 className="text-lg font-semibold">What it is based on</h2>
            <ul className="mt-2 list-disc pl-5 text-sm">
              <li>
                <strong>Tariff:</strong> {plan.inputs.tariff.name}
                {plan.inputs.tariff.exportRate !== null ? `, export credit ₹${formatNumber(plan.inputs.tariff.exportRate)} per kWh (${plan.inputs.tariff.exportBasis === "USER_ENTERED" ? "entered by you" : "an assumption"})` : ""}.
              </li>
              <li>
                <strong>Your use:</strong> {plan.inputs.load.note}
              </li>
              <li>
                <strong>Solar:</strong> {plan.inputs.solar.note}
              </li>
              {plan.inputs.battery && (
                <li>
                  <strong>Battery:</strong> {formatNumber(plan.inputs.battery.capacityKwh)} kWh ({formatNumber(plan.inputs.battery.usableKwh)} kWh usable), up to {formatNumber(plan.inputs.battery.maxChargeKw)} kW in and {formatNumber(plan.inputs.battery.maxDischargeKw)} kW out.
                </li>
              )}
            </ul>
            <details className="mt-3 text-sm" open>
              <summary className="cursor-pointer select-none font-medium">{plan.assumptions.length} assumptions the plan makes</summary>
              <ul className="mt-1 list-disc pl-5 text-muted">
                {plan.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </details>
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer select-none font-medium">How the mode weighs the choice, and how the plan was checked</summary>
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-muted">
                {Object.entries(plan.modeWeights).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt>{k}</dt>
                    <dd className="num text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-muted">
                Solved as a linear programme in {formatNumber(plan.solver.seconds)} s. The finished plan was then checked again from scratch: every hour’s energy balance holds (largest error {formatNumber(plan.validation.maxBalanceErrorKw)} kW).
              </p>
              {plan.notes.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-muted">
                  {plan.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </details>
          </section>
        </>
      )}

      <CloudFrontPanel id={id} />

      {history.length > 1 && (
        <section className="card mt-4 p-4" aria-label="Earlier plans">
          <h2 className="text-base font-semibold">Earlier plans</h2>
          <ul className="mt-2 divide-y divide-line text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span>
                  {formatDateTime(h.createdAt)} · {MODES.find((m) => m.value === h.mode)?.label} · {h.steps} h · saves <span className="num">{formatInr(h.savingsInr)}</span>
                </span>
                <button type="button" className="btn" onClick={() => void open(h.id)} aria-label={`Open the plan made ${formatDateTime(h.createdAt)}`} aria-current={plan?.id === h.id ? "true" : undefined}>
                  {plan?.id === h.id ? "Showing" : "Open"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
