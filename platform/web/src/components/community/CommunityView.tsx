"use client";

import Link from "next/link";
import { useState } from "react";
import { CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, Area } from "recharts";
import { ApiError, api, describeError } from "@/lib/api";
import { formatInr, formatNumber, formatPercent } from "@/lib/format";
import type { Community, Property, VppSimulation } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { useAuth } from "../AuthProvider";
import { Field, SelectField, num } from "../assets/fields";
import { StatusBadge } from "../Provenance";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const hour = (h: number) => `${String(h).padStart(2, "0")}:00`;
const inr = (v: number) => formatInr(Math.round(v));
const STATUS_WORDS: Record<string, string> = { SURPLUS: "Solar surplus", DEFICIT: "Buys from the grid", BALANCED: "Balanced", NO_DATA: "No readings" };

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num text-lg font-semibold">{value}</dd>
      {hint && <dd className="text-xs text-muted">{hint}</dd>}
    </div>
  );
}

function HourChart({ rows, lines, label, unit }: { rows: Record<string, number>[]; lines: { key: string; name: string; color: string; dashed?: boolean; area?: boolean }[]; label: string; unit: string }) {
  return (
    <div className="h-60 w-full" role="img" aria-label={`${label}, in ${unit}, for each hour of a typical day: ${lines.map((l) => l.name).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
          <XAxis dataKey="hour" stroke="var(--muted)" fontSize={11} interval={2} tickFormatter={(h: number) => hour(h)} />
          <YAxis stroke="var(--muted)" fontSize={11} width={52} tickFormatter={(v: number) => formatNumber(v)} />
          <Tooltip
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as Record<string, number> | undefined;
              if (!active || !p) return null;
              return (
                <div className="card px-3 py-2 text-xs shadow-lg">
                  <div className="font-semibold">{hour(p.hour!)}</div>
                  {lines.map((l) => (
                    <div key={l.key} className="num" style={{ color: l.color }}>
                      {l.name}: {formatNumber(p[l.key]!, unit)}
                    </div>
                  ))}
                  <div className="text-muted">SIMULATED</div>
                </div>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {lines.map((l) =>
            l.area ? (
              <Area key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color} fill={l.color} fillOpacity={0.25} isAnimationActive={false} />
            ) : (
              <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color} strokeWidth={2} strokeDasharray={l.dashed ? "5 3" : undefined} dot={false} isAnimationActive={false} />
            ),
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function CommunitySection({ c }: { c: Community }) {
  const t = c.totals.value;
  const rows = c.hourly.hours.map((h, i) => ({ hour: h, load: c.hourly.loadKw[i]!, solar: c.hourly.solarKw[i]!, shareable: c.hourly.shareableKw[i]! }));
  return (
    <>
      <div role="note" className="mt-2 rounded-md bg-[color:var(--tone-simulated-bg)] p-2 text-sm font-semibold text-[color:var(--tone-simulated-fg)]">{c.label}</div>
      {c.members.length === 0 && <p className="mt-3 text-sm text-muted">You have no saved properties yet. <Link className="font-semibold text-accent underline" href="/map">Add one on the map</Link>.</p>}
      {c.members.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">Your properties on a typical day</caption>
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1 pr-3 font-medium">Property</th>
                <th className="py-1 pr-3 font-medium">Today, typically</th>
                <th className="py-1 pr-3 text-right font-medium">Uses (kWh)</th>
                <th className="py-1 pr-3 text-right font-medium">Solar (kWh)</th>
                <th className="py-1 pr-3 text-right font-medium">Surplus (kWh)</th>
                <th className="py-1 pr-3 text-right font-medium">Deficit (kWh)</th>
                <th className="py-1 pr-3 text-right font-medium">Storage (kWh)</th>
                <th className="py-1 text-right font-medium">Shiftable (kW)</th>
              </tr>
            </thead>
            <tbody>
              {c.members.map((m) => (
                <tr key={m.propertyId} className="border-t border-line">
                  <th scope="row" className="py-1 pr-3 text-left font-medium"><Link className="underline" href={`/property/${m.propertyId}`}>{m.name}</Link></th>
                  <td className="py-1 pr-3" title={m.reason ?? undefined}>{STATUS_WORDS[m.status]}</td>
                  <td className="num py-1 pr-3 text-right">{m.loadKwhPerDay === null ? "—" : formatNumber(m.loadKwhPerDay)}</td>
                  <td className="num py-1 pr-3 text-right">{m.status === "NO_DATA" ? "—" : formatNumber(m.solarKwhPerDay)}</td>
                  <td className="num py-1 pr-3 text-right">{m.surplusKwhPerDay === null ? "—" : formatNumber(m.surplusKwhPerDay)}</td>
                  <td className="num py-1 pr-3 text-right">{m.deficitKwhPerDay === null ? "—" : formatNumber(m.deficitKwhPerDay)}</td>
                  <td className="num py-1 pr-3 text-right">{formatNumber(m.batteryUsableKwh)}</td>
                  <td className="num py-1 text-right">{formatNumber(m.shiftableKw)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {c.members.filter((m) => m.reason).map((m) => (
            <p key={m.propertyId} className="mt-1 text-xs text-muted">{m.name}: {m.reason}</p>
          ))}
        </div>
      )}
      {t ? (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Figure label="Together they use" value={`${formatNumber(t.loadKwhPerDay)} kWh`} hint={`${t.properties} properties, a typical ${c.dayType} in ${MONTHS[c.month - 1]}`} />
            <Figure label="Their solar makes" value={`${formatNumber(t.solarKwhPerDay)} kWh`} />
            <Figure label="One's surplus could meet another's deficit" value={`${formatNumber(t.shareableKwhPerDay)} kWh`} hint="in the same hour; a simulation, not a trade" />
            <Figure label="Storage and shiftable load" value={`${formatNumber(t.storageUsableKwh)} kWh, ${formatNumber(t.shiftableKw)} kW`} hint={t.vehicleChargerKw > 0 ? `${formatNumber(t.vehicleChargerKw)} kW of vehicle charging` : undefined} />
          </dl>
          <HourChart
            rows={rows}
            label="Your properties together"
            unit="kW"
            lines={[
              { key: "load", name: "Use", color: "var(--ink)", dashed: true },
              { key: "solar", name: "Solar", color: "var(--tone-updated-fg)", area: true },
              { key: "shareable", name: "Could be shared", color: "var(--accent)" },
            ]}
          />
        </>
      ) : (
        <p className="mt-3 text-sm text-muted">No property has readings yet, so there is nothing to add up. Import meter readings on a property’s Meter data tab.</p>
      )}
      <ul className="mt-3 list-disc pl-5 text-xs text-muted">
        {c.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </>
  );
}

function Vpp({ properties }: { properties: Property[] }) {
  const [archetype, setArchetype] = useState(properties[0]?.id ?? "");
  const [homes, setHomes] = useState("100");
  const [pvShare, setPvShare] = useState("");
  const [pvKwp, setPvKwp] = useState("");
  const [battShare, setBattShare] = useState("");
  const [battKwh, setBattKwh] = useState("");
  const [evShare, setEvShare] = useState("");
  const [flexShare, setFlexShare] = useState("");
  const [loadCv, setLoadCv] = useState("");
  const [seed, setSeed] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VppSimulation | null>(null);
  const [failure, setFailure] = useState<{ message: string; missing: string[] } | null>(null);

  async function run() {
    setFailure(null);
    const entries: [string, string, string][] = [["pvSharePercent", pvShare, "share with solar"], ["pvKwpMean", pvKwp, "solar size"], ["batterySharePercent", battShare, "share with a battery"], ["batteryKwhMean", battKwh, "battery size"], ["evSharePercent", evShare, "share with a vehicle"], ["flexibleSharePercent", flexShare, "shiftable share"], ["loadCv", loadCv, "load spread"], ["seed", seed, "seed"]];
    const body: Record<string, unknown> = { archetypePropertyId: archetype, homes: Number(homes) };
    for (const [k, v, name] of entries) {
      if (v.trim() === "") continue;
      if (!Number.isFinite(num(v))) {
        setFailure({ message: `The ${name} must be a number.`, missing: [] });
        return;
      }
      body[k] = num(v);
    }
    setBusy(true);
    try {
      setResult(await api<VppSimulation>("/api/vpp/simulate", { method: "POST", body }));
    } catch (e) {
      const d = e instanceof ApiError ? (e.details as { missing?: { what: string }[] } | undefined) : undefined;
      setFailure({ message: describeError(e), missing: d?.missing?.map((m) => m.what) ?? [] });
    } finally {
      setBusy(false);
    }
  }

  const v = result?.result.value ?? null;
  const rows = result ? result.hourly.hours.map((h, i) => ({ hour: h, load: result.hourly.loadKw[i]!, solar: result.hourly.solarKw[i]!, before: result.hourly.importBeforeKw[i]!, after: result.hourly.importAfterKw[i]! })) : [];
  return (
    <>
      <div role="note" className="mt-2 rounded-md bg-[color:var(--tone-simulated-bg)] p-2 text-sm font-semibold text-[color:var(--tone-simulated-fg)]">VIRTUAL POWER PLANT SIMULATION: every home is synthetic</div>
      <p className="mt-2 text-sm text-muted">
        Draws 10 to 10,000 homes from the shares and sizes below (the defaults are assumptions, not data), each a variation of one of your properties’ own daily pattern, and dispatches the fleet as one battery, one shiftable load and one vehicle charger to see what coordination does to the evening peak and the bill. It is a simulation: nothing is coordinated for real.
      </p>
      {properties.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Save a property with a tariff and meter readings first: it provides the pattern.</p>
      ) : (
        <form
          className="mt-3"
          aria-label="Simulate a virtual power plant"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label="Pattern: a variation of this property" value={archetype} onChange={setArchetype} options={properties.map((p) => ({ value: p.id, label: p.name }))} />
            <SelectField label="Homes" value={homes} onChange={setHomes} options={[10, 100, 1000, 10000].map((n) => ({ value: String(n), label: n.toLocaleString("en-IN") }))} />
          </div>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer select-none font-medium">The assumptions behind the homes</summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <Field label="Homes with solar, %" type="number" value={pvShare} onChange={setPvShare} hint="Default 30." />
              <Field label="Mean solar size, kWp" type="number" value={pvKwp} onChange={setPvKwp} hint="Default 3." />
              <Field label="Of those, with a battery, %" type="number" value={battShare} onChange={setBattShare} hint="Default 10." />
              <Field label="Mean battery, kWh" type="number" value={battKwh} onChange={setBattKwh} hint="Default 5." />
              <Field label="Homes with a vehicle, %" type="number" value={evShare} onChange={setEvShare} hint="Default 5." />
              <Field label="Load that can move, %" type="number" value={flexShare} onChange={setFlexShare} hint="Default 15." />
              <Field label="How much homes differ in use" type="number" value={loadCv} onChange={setLoadCv} hint="Default 0.35." />
              <Field label="Seed" type="number" value={seed} onChange={setSeed} hint="The same seed describes the same homes. Default 1." />
            </div>
          </details>
          <button type="submit" className="btn btn-primary mt-3" disabled={busy || !archetype}>{busy ? "Simulating…" : "Simulate"}</button>
        </form>
      )}
      <div aria-live="polite">
        {failure && (
          <div role="alert" className="mt-3 rounded-md bg-[color:var(--tone-unavailable-bg)] p-3 text-sm text-[color:var(--tone-unavailable-fg)]">
            <p>{failure.message}</p>
            {failure.missing.length > 0 && archetype && <p className="mt-1">Fix it on <Link className="font-semibold underline" href={`/property/${archetype}${failure.missing.includes("tariff") ? "/tariff" : "/meter-data"}`}>that property</Link>.</p>}
          </div>
        )}
      </div>
      {result && v && (
        <section className="mt-4" aria-label="Simulation result">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold">{result.fleet.homes.toLocaleString("en-IN")} homes, a typical {result.dayType} in {MONTHS[result.month - 1]}</h3>
            <StatusBadge status={result.result.provenance.status} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {result.fleet.withSolar.toLocaleString("en-IN")} with solar ({formatNumber(result.fleet.solarKwp)} kWp in all), {result.fleet.withBattery.toLocaleString("en-IN")} with a battery ({formatNumber(result.fleet.batteryKwh)} kWh), {result.fleet.withVehicle.toLocaleString("en-IN")} with a vehicle. Pattern: {result.archetype.name}, tariff {result.archetype.tariff}.
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <Figure label="Evening peak from the grid" value={`${formatNumber(v.peakImportAfterKw)} kW`} hint={`was ${formatNumber(v.peakImportBeforeKw)} kW at ${hour(v.peakImportBeforeHour)}`} />
            <Figure label="Peak cut by" value={v.peakReductionPercent === null ? "—" : `${formatNumber(v.peakReductionPercent)}%`} />
            <Figure label="Bill for the day" value={inr(v.costAfterInr)} hint={`was ${inr(v.costBeforeInr)}; saves ${inr(v.savingsInr)}`} />
            <Figure label="Solar used locally" value={v.solarUsedLocallyAfter === null ? "—" : formatPercent(v.solarUsedLocallyAfter)} hint={v.solarUsedLocallyBefore === null ? undefined : `was ${formatPercent(v.solarUsedLocallyBefore)}`} />
            <Figure label="Self-sufficiency" value={v.selfSufficiencyAfter === null ? "—" : formatPercent(v.selfSufficiencyAfter)} hint={v.selfSufficiencyBefore === null ? undefined : `was ${formatPercent(v.selfSufficiencyBefore)}`} />
            <Figure label="Solar made" value={`${formatNumber(v.solarKwhPerDay)} kWh`} />
            <Figure label="Homes use" value={`${formatNumber(v.loadKwhPerDay)} kWh`} />
            <Figure label="Battery cycles" value={formatNumber(v.batteryCycles)} />
          </dl>
          <HourChart
            rows={rows}
            label="Power drawn from the grid, with and without coordination"
            unit="kW"
            lines={[
              { key: "before", name: "From the grid, uncoordinated", color: "var(--muted)", dashed: true },
              { key: "after", name: "From the grid, coordinated", color: "var(--accent)" },
              { key: "solar", name: "Solar", color: "var(--tone-updated-fg)", area: true },
            ]}
          />
          <details className="mt-3 text-sm" open>
            <summary className="cursor-pointer select-none font-medium">{result.assumptions.length} assumptions</summary>
            <ul className="mt-1 list-disc pl-5 text-muted">
              {result.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </details>
        </section>
      )}
    </>
  );
}

/** Your properties together, and a simulated fleet of homes (spec sections 47 to 49, 96). Both are simulations and say so. */
export function CommunityView() {
  const { user, loading } = useAuth();
  const community = useApi<Community>(user ? "/api/community" : null);
  const props = useApi<{ properties: Property[] }>(user ? "/api/properties" : null);

  if (loading) return <p role="status" className="p-6 text-sm text-muted">Loading…</p>;
  if (!user) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold">Community</h1>
        <p className="mt-3 text-muted">
          <Link className="font-semibold text-accent underline" href="/login?next=/community">Sign in</Link> to see your properties together and to simulate a virtual power plant.
        </p>
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <h1 className="text-2xl font-bold">Community</h1>
      <p className="text-sm text-muted">Simulations only. AVISHKAR does not move electricity between properties and says nothing about whether that is allowed where they are.</p>

      <section className="card mt-4 p-4" aria-label="Your properties together">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Your properties together</h2>
          {community.data && <StatusBadge status={community.data.totals.provenance.status} />}
        </div>
        {community.loading && <p role="status" className="mt-2 text-sm text-muted">Adding up your properties…</p>}
        {community.error && <p role="alert" className="mt-2 text-sm text-[color:var(--tone-unavailable-fg)]">{community.error}</p>}
        {community.data && <CommunitySection c={community.data} />}
      </section>

      <section className="card mt-4 p-4" aria-label="Virtual power plant">
        <h2 className="text-lg font-semibold">Simulate a virtual power plant</h2>
        {props.loading && <p role="status" className="mt-2 text-sm text-muted">Loading your properties…</p>}
        {props.data && <Vpp properties={props.data.properties} />}
      </section>
    </div>
  );
}
