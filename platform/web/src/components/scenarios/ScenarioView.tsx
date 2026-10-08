"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api, describeError } from "@/lib/api";
import { formatDateTime, formatInr, formatNumber, formatPercent } from "@/lib/format";
import type { Opportunities, Opportunity, Scenario, ScenarioRequest, ScenarioSummary, TariffList } from "@/lib/types";
import { useAuth } from "../AuthProvider";
import { Field, SelectField, num } from "../assets/fields";
import { ProvenanceDetails, StatusBadge } from "../Provenance";
import { PropertyTabs } from "../property/PropertyTabs";
import { usePropertyData } from "../property/usePropertyData";
import { CashflowChart, MonthlyCostChart } from "./ScenarioCharts";

interface Missing {
  what: string;
  why: string;
}

const LINKS: Record<string, { href: (id: string) => string; label: string }> = {
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

const inr = (v: number): string => formatInr(Math.round(v)); // a yearly estimate is not good to the paisa

const years = (v: number | null): string => (v === null ? "never within the life given" : v === 0 ? "at once" : `${formatNumber(v)} years`);

/** Add solar, add a battery or change tariff, and see a year of difference with the money worked out (spec sections 32, 33, 62). */
export function ScenarioView({ id }: { id: string }) {
  const { user, loading: authLoading } = useAuth();
  const { property, loading, error, notFound } = usePropertyData(id);
  const ready = Boolean(user && property);
  const [solar, setSolar] = useState("");
  const [tilt, setTilt] = useState("");
  const [azimuth, setAzimuth] = useState("");
  const [battery, setBattery] = useState("");
  const [batteryKw, setBatteryKw] = useState("");
  const [tariff, setTariff] = useState("");
  const [solarCost, setSolarCost] = useState("");
  const [batteryCost, setBatteryCost] = useState("");
  const [otherCost, setOtherCost] = useState("");
  const [yearsLife, setYearsLife] = useState("");
  const [discount, setDiscount] = useState("");
  const [escalation, setEscalation] = useState("");
  const [degradation, setDegradation] = useState("");
  const [carbon, setCarbon] = useState("");
  const [tariffs, setTariffs] = useState<{ id: string; name: string }[]>([]);
  const [result, setResult] = useState<Scenario | null>(null);
  const [history, setHistory] = useState<ScenarioSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ message: string; missing: Missing[] } | null>(null);
  const [opps, setOpps] = useState<Opportunities | null>(null);
  const [oppBusy, setOppBusy] = useState(false);
  const [oppError, setOppError] = useState<string | null>(null);

  const refresh = useCallback(() => api<{ scenarios: ScenarioSummary[] }>(`/api/properties/${id}/scenarios`).then((r) => setHistory(r.scenarios)).catch(() => setHistory([])), [id]);

  useEffect(() => {
    if (!ready) return;
    let live = true;
    api<TariffList>("/api/tariffs")
      .then((r) => live && setTariffs(r.tariffs.filter((t) => t.id !== property?.tariffPlanId).map((t) => ({ id: t.id, name: `${t.name}${t.state ? ` (${t.state})` : ""}` }))))
      .catch(() => live && setTariffs([]));
    void refresh();
    return () => {
      live = false;
    };
  }, [ready, property?.tariffPlanId, refresh]);

  if (loading || authLoading) return <p role="status" className="p-6 text-sm text-muted">Loading…</p>;
  if (!user || notFound) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold">Property not found</h1>
        <p className="mt-3 text-muted">
          {user ? "This property does not exist or is not yours." : "Sign in to try what-ifs."}{" "}
          <Link className="font-semibold text-accent underline" href={user ? "/properties" : `/login?next=/property/${id}/what-if`}>
            {user ? "Back to your properties" : "Sign in"}
          </Link>
        </p>
      </div>
    );
  }
  if (error || !property) return <p role="alert" className="p-6 text-sm text-[color:var(--tone-unavailable-fg)]">{error ?? "Could not load the property."}</p>;

  function build(): { body: ScenarioRequest } | { problem: string } {
    const fields: [string, string][] = [["solar capacity", solar], ["tilt", tilt], ["direction", azimuth], ["battery capacity", battery], ["battery power", batteryKw], ["solar price", solarCost], ["battery price", batteryCost], ["other cost", otherCost], ["years", yearsLife], ["discount rate", discount], ["tariff rise", escalation], ["ageing", degradation], ["emission factor", carbon]];
    for (const [name, v] of fields) if (v.trim() !== "" && !Number.isFinite(num(v))) return { problem: `The ${name} must be a number.` };
    if (solar.trim() === "" && battery.trim() === "" && tariff === "") return { problem: "Change something: add solar, add a battery, or choose another tariff." };
    const body: ScenarioRequest = {};
    if (solar.trim() !== "") body.addSolarKwp = num(solar) as number;
    if (tilt.trim() !== "") body.solarTiltDeg = num(tilt) as number;
    if (azimuth.trim() !== "") body.solarAzimuthDeg = num(azimuth) as number;
    if (battery.trim() !== "") body.addBatteryKwh = num(battery) as number;
    if (batteryKw.trim() !== "") body.batteryPowerKw = num(batteryKw) as number;
    if (tariff !== "") body.tariffPlanId = tariff;
    const costs: NonNullable<ScenarioRequest["costs"]> = {};
    if (solarCost.trim() !== "") costs.solarInrPerKwp = num(solarCost) as number;
    if (batteryCost.trim() !== "") costs.batteryInrPerKwh = num(batteryCost) as number;
    if (otherCost.trim() !== "") costs.otherInr = num(otherCost) as number;
    if (Object.keys(costs).length > 0) body.costs = costs;
    const econ: NonNullable<ScenarioRequest["economics"]> = {};
    if (yearsLife.trim() !== "") econ.years = num(yearsLife) as number;
    if (discount.trim() !== "") econ.discountRatePercent = num(discount) as number;
    if (escalation.trim() !== "") econ.tariffEscalationPercent = num(escalation) as number;
    if (degradation.trim() !== "") econ.degradationPercent = num(degradation) as number;
    if (Object.keys(econ).length > 0) body.economics = econ;
    if (carbon.trim() !== "") body.gridCarbonKgPerKwh = num(carbon) as number;
    return { body };
  }

  async function estimate() {
    setFailure(null);
    const b = build();
    if ("problem" in b) {
      setFailure({ message: b.problem, missing: [] });
      return;
    }
    setBusy(true);
    try {
      setResult(await api<Scenario>(`/api/properties/${id}/scenarios`, { method: "POST", body: b.body }));
      void refresh();
    } catch (e) {
      const d = e instanceof ApiError ? (e.details as { missing?: Missing[] } | undefined) : undefined;
      setFailure({ message: describeError(e), missing: d?.missing ?? [] });
    } finally {
      setBusy(false);
    }
  }

  async function findOpportunities() {
    setOppBusy(true);
    setOppError(null);
    try {
      setOpps(await api<Opportunities>(`/api/properties/${id}/opportunities`, { method: "POST" }));
    } catch (e) {
      setOppError(describeError(e));
    } finally {
      setOppBusy(false);
    }
  }

  /** Put an opportunity's change into the form, so its money can be worked out with the owner's own prices. */
  function tryIt(o: Opportunity) {
    setSolar(o.scenario?.addSolarKwp === undefined ? "" : String(o.scenario.addSolarKwp));
    setBattery(o.scenario?.addBatteryKwh === undefined ? "" : String(o.scenario.addBatteryKwh));
    setTariff(o.scenario?.tariffPlanId ?? "");
    document.getElementById("whatif-form")?.scrollIntoView?.({ behavior: "smooth", block: "start" }); // absent in some test environments
  }

  async function open(sid: string) {
    setFailure(null);
    try {
      setResult(await api<Scenario>(`/api/properties/${id}/scenarios/${sid}`));
    } catch (e) {
      setFailure({ message: describeError(e), missing: [] });
    }
  }

  async function remove(sid: string) {
    try {
      await api(`/api/properties/${id}/scenarios/${sid}`, { method: "DELETE" });
      if (result?.id === sid) setResult(null);
      void refresh();
    } catch (e) {
      setFailure({ message: describeError(e), missing: [] });
    }
  }

  const c = result?.comparison.value ?? null;
  const e = result?.economics.value ?? null;
  const es = result?.economicsIfSubsidised?.value ?? null;
  const inv = result?.investment.value ?? null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <header>
        <h1 className="text-2xl font-bold">{property.name}</h1>
        <p className="text-sm text-muted">What if: a year of difference</p>
      </header>
      <div className="mt-4">
        <PropertyTabs id={id} current="/what-if" demo={property?.isDemo} />
      </div>

      <section className="card mt-4 p-4" aria-label="What could be worth doing">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">What could be worth doing?</h2>
          <button type="button" className="btn" disabled={oppBusy} onClick={() => void findOpportunities()}>{oppBusy ? "Looking…" : opps ? "Look again" : "Find opportunities"}</button>
        </div>
        <p className="mt-1 text-sm text-muted">Tries a few example changes on your typical year and looks at what your records lack. It takes several seconds. AVISHKAR has no price list, so for each it shows the most it could cost and still repay itself: compare that with a quote.</p>
        {oppError && <p role="alert" className="mt-2 text-sm text-[color:var(--tone-unavailable-fg)]">{oppError}</p>}
        {opps && (
          <>
            <ul className="mt-3 grid gap-3 md:grid-cols-2" aria-label="Opportunities">
              {opps.items.map((o) => (
                <li key={o.id} className="rounded-md border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">{o.title}</h3>
                    <StatusBadge status={o.provenance.status} />
                  </div>
                  {o.annualSavingsInr !== null && <p className="num mt-1 text-lg font-semibold">about {inr(o.annualSavingsInr)} a year</p>}
                  <p className="mt-1 text-sm text-muted">{o.detail}</p>
                  {o.breakEven && (
                    <p className="mt-1 text-sm">
                      Worth it if a quote is below <strong className="num">{inr(o.breakEven.perUnitInr)} per {o.breakEven.unit}</strong> (<span className="num">{inr(o.breakEven.totalInr)}</span> in all).
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {o.scenario && <button type="button" className="btn" onClick={() => tryIt(o)} aria-label={`Try this in the form: ${o.title}`}>Try it with my prices</button>}
                    {o.kind === "PROVIDE_DATA" && o.href && <Link className="btn" href={`/property/${id}${o.href}`}>Go there</Link>}
                  </div>
                </li>
              ))}
            </ul>
            {opps.items.length === 0 && <p className="mt-3 text-sm text-muted">Nothing worth listing was found.</p>}
            {opps.checked.length > 0 && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer select-none font-medium">Also tried, and not worth listing ({opps.checked.length})</summary>
                <ul className="mt-1 list-disc pl-5 text-muted">
                  {opps.checked.map((c) => (
                    <li key={c.title}>{c.title}: {c.annualSavingsInr >= 0 ? `saves only ${inr(c.annualSavingsInr)} a year` : `costs ${inr(-c.annualSavingsInr)} a year more`}</li>
                  ))}
                </ul>
              </details>
            )}
            <ul className="mt-2 list-disc pl-5 text-xs text-muted">
              {opps.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <form
        id="whatif-form"
        className="card mt-4 p-4"
        aria-label="Describe the change"
        onSubmit={(ev) => {
          ev.preventDefault();
          void estimate();
        }}
      >
        <p className="text-sm text-muted">
          Change one thing or several and AVISHKAR compares a typical year of your electricity with and without it, planned hour by hour for the lowest bill. This is an estimate for a typical year, not a forecast, and it needs your tariff and meter readings.
        </p>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          <fieldset className="grid gap-2">
            <legend className="text-sm font-semibold">Add solar</legend>
            <Field label="Capacity to add, kWp" type="number" value={solar} onChange={setSolar} placeholder="for example 3" />
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-semibold">Add a battery</legend>
            <Field label="Capacity to add, kWh" type="number" value={battery} onChange={setBattery} placeholder="for example 5" />
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-semibold">Or compare a tariff</legend>
            <SelectField label="Tariff" value={tariff} onChange={setTariff} options={[{ value: "", label: "Keep my current tariff" }, ...tariffs.map((t) => ({ value: t.id, label: t.name }))]} hint="Compare only plans you could really switch to: other states and utilities have their own." />
          </fieldset>
        </div>

        <fieldset className="mt-4 grid gap-3 sm:grid-cols-3">
          <legend className="text-sm font-semibold">What you were quoted</legend>
          <Field label="Solar, ₹ per kWp" type="number" value={solarCost} onChange={setSolarCost} hint="Without it there is no payback: AVISHKAR has no price list." />
          <Field label="Battery, ₹ per kWh" type="number" value={batteryCost} onChange={setBatteryCost} />
          <Field label="Anything else, ₹" type="number" value={otherCost} onChange={setOtherCost} hint="Wiring, mounting, a new inverter." />
        </fieldset>

        <details className="mt-3 text-sm">
          <summary className="cursor-pointer select-none font-medium">More options and the assumptions behind the money</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <Field label="Panel tilt, degrees" type="number" value={tilt} onChange={setTilt} hint="Default: your latitude." />
            <Field label="Panel direction, degrees from north" type="number" value={azimuth} onChange={setAzimuth} hint="Default: 180, south." />
            <Field label="Battery power, kW" type="number" value={batteryKw} onChange={setBatteryKw} hint="Default: half its capacity per hour." />
            <Field label="Years the saving lasts" type="number" value={yearsLife} onChange={setYearsLife} hint="Default: 20." />
            <Field label="What money is worth to you, % a year" type="number" value={discount} onChange={setDiscount} hint="Default: 8." />
            <Field label="Tariff rise, % a year" type="number" value={escalation} onChange={setEscalation} hint="Default: 0, no rise assumed." />
            <Field label="Ageing, % lost a year" type="number" value={degradation} onChange={setDegradation} hint="Default: 0.5." />
            <Field label="Grid emission factor, kg CO₂ per kWh" type="number" value={carbon} onChange={setCarbon} hint="None is built in: take it from your utility or a published table." />
          </div>
        </details>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Estimating…" : "Estimate a year"}</button>
          {busy && <span role="status" className="text-sm text-muted">Planning 24 typical days for each setup…</span>}
        </div>
      </form>

      <div aria-live="polite" className="mt-3">
        {failure && (
          <div role="alert" className="rounded-md bg-[color:var(--tone-unavailable-bg)] p-3 text-sm text-[color:var(--tone-unavailable-fg)]">
            <p>{failure.message}</p>
            {failure.missing.length > 0 && (
              <ul className="mt-2 list-disc pl-5">
                {failure.missing.map((m) =>
                  LINKS[m.what] ? (
                    <li key={m.what}>
                      <Link className="font-semibold underline" href={LINKS[m.what]!.href(id)}>{LINKS[m.what]!.label}</Link>
                    </li>
                  ) : null,
                )}
              </ul>
            )}
          </div>
        )}
      </div>

      {result && c && (
        <>
          <section className="card mt-4 p-4" aria-label="Estimated difference over a year">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">{result.name}</h2>
              <StatusBadge status={result.comparison.provenance.status} />
            </div>
            <p className="mt-1 text-base" data-testid="headline">
              {c.annualSavingsInr >= 0 ? (
                <>This would save about <strong className="num">{inr(c.annualSavingsInr)}</strong> a year{c.savingsPercent !== null ? ` (${formatNumber(c.savingsPercent)}% of the planned bill)` : ""}.</>
              ) : (
                <>This would cost about <strong className="num">{inr(-c.annualSavingsInr)}</strong> more a year.</>
              )}
            </p>
            <p className="mt-1 text-sm text-muted">An estimate for a typical year from your own readings and the monthly solar climatology; the real year will differ.</p>
            <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <Figure label="Today, planned" value={inr(result.base.netCostInr)} hint="a year, today's setup" />
              <Figure label="With the change" value={inr(result.scenario.netCostInr)} />
              <Figure label="Self-sufficiency" value={result.scenario.selfSufficiencyRatio === null ? "—" : formatPercent(result.scenario.selfSufficiencyRatio)} hint={result.base.selfSufficiencyRatio === null ? undefined : `was ${formatPercent(result.base.selfSufficiencyRatio)}`} />
              <Figure label="Bought from the grid" value={`${formatNumber(result.scenario.importKwh)} kWh`} hint={`${c.importKwhChange > 0 ? "+" : ""}${formatNumber(c.importKwhChange)} kWh`} />
              <Figure label="Solar made" value={`${formatNumber(result.scenario.pvKwh)} kWh`} hint={result.base.pvKwh > 0 ? `was ${formatNumber(result.base.pvKwh)} kWh` : undefined} />
              <Figure label="Battery cycles" value={formatNumber(result.scenario.batteryCycles)} />
            </dl>
            <h3 className="mt-4 text-sm font-semibold">Each month</h3>
            <MonthlyCostChart s={result} />
            <div className="mt-2"><ProvenanceDetails p={result.comparison.provenance} /></div>
          </section>

          <section className="card mt-4 p-4" aria-label="The money">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">The money</h2>
              <StatusBadge status={result.economics.provenance.status} />
            </div>
            {inv === null ? (
              <p role="status" className="mt-2 rounded-md bg-[color:var(--tone-unavailable-bg)] p-3 text-sm text-[color:var(--tone-unavailable-fg)]">{result.investment.provenance.notes[0]}</p>
            ) : (
              <>
                <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                  <Figure label="You would pay" value={inr(inv.totalInr)} hint={inv.totalInr === 0 ? "nothing: only the tariff changes" : "your quote, not netted against any subsidy"} />
                  {e && <Figure label="Pays for itself in" value={years(e.paybackYears)} hint={e.discountedPaybackYears === null ? undefined : `${years(e.discountedPaybackYears)} in today's money`} />}
                  {e && <Figure label={`Worth over ${result.economicsAssumptions.years} years`} value={inr(e.npvInr)} hint="in today's money, after the cost" />}
                  {e && <Figure label="Rate of return" value={e.irrPercent === null ? "—" : `${formatNumber(e.irrPercent)}% a year`} />}
                  {e && <Figure label="Total gain" value={inr(e.netGainInr)} hint="savings less the cost, not discounted" />}
                </dl>
                {e && inv.totalInr > 0 && <CashflowChart cashflows={e.cashflows} investmentInr={inv.totalInr} />}
              </>
            )}
            {result.subsidy.value !== null && (
              <p className="mt-3 text-sm">
                <strong>If you qualify</strong> for the published scheme it could pay about <span className="num">{inr(result.subsidy.value)}</span> on the added solar. {es ? <>Then it would pay for itself in <span className="num">{years(es.paybackYears)}</span>.</> : null}{" "}
                <span className="text-muted">This is the scheme&apos;s published schedule applied to the size; it is not a confirmed entitlement.</span>
              </p>
            )}
            {result.subsidy.value === null && result.subsidy.provenance.notes[0] && result.request.addSolarKwp !== undefined && <p className="mt-3 text-sm text-muted">{result.subsidy.provenance.notes[0]}</p>}
            <p className="mt-3 text-sm" data-testid="carbon">
              <strong>Carbon:</strong>{" "}
              {result.carbon.value ? `${formatNumber(result.carbon.value.avoidedKgPerYear)} kg of CO₂ a year ${result.carbon.value.avoidedKgPerYear >= 0 ? "avoided" : "more"}, at the emission factor you gave.` : <span className="text-muted">{result.carbon.provenance.notes[0]}</span>}
            </p>
          </section>

          <section className="card mt-4 p-4" aria-label="What the estimate assumes">
            <h2 className="text-lg font-semibold">What it assumes</h2>
            <ul className="mt-2 list-disc pl-5 text-sm text-muted">
              {result.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </section>
        </>
      )}

      {history.length > 0 && (
        <section className="card mt-4 p-4" aria-label="Earlier scenarios">
          <h2 className="text-base font-semibold">Earlier scenarios</h2>
          <ul className="mt-2 divide-y divide-line text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span>
                  {h.name} · {formatDateTime(h.createdAt)} · <span className="num">{h.annualSavingsInr >= 0 ? "saves" : "costs"} {inr(Math.abs(h.annualSavingsInr))} a year</span>
                </span>
                <span className="flex gap-2">
                  <button type="button" className="btn" onClick={() => void open(h.id)} aria-label={`Open ${h.name}`}>{result?.id === h.id ? "Showing" : "Open"}</button>
                  <button type="button" className="btn" onClick={() => void remove(h.id)} aria-label={`Delete ${h.name}`}>Delete</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
