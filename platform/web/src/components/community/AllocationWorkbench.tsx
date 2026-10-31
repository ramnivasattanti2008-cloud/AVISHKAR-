"use client";

/**
 * The allocation workbench: change any property's generation, demand, battery or limits and see who can meet whose
 * deficit, what the network loses carrying it, and which cap stopped it.
 *
 * Every figure on this page comes back from POST /api/community/allocate, which is the same engine the rest of the
 * platform uses. Nothing is computed in the browser and nothing is hardcoded: edit a field, press Recalculate, and the
 * numbers are whatever the engine makes of the new inputs. The three starting scenarios are starting points for editing,
 * not canned answers — each one is sent to the engine like any other.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, describeError } from "@/lib/api";
import { formatInr, formatNumber } from "@/lib/format";
import type { CommunityAllocation, CommunityMemberInput } from "@/lib/types";
import { StatusBadge } from "../Provenance";
import { Field, SelectField } from "../assets/fields";

type Member = CommunityMemberInput & { battery: NonNullable<CommunityMemberInput["battery"]> | null };

interface Limits {
  feederLimitKw: string;
  networkLossFraction: string;
  rule: string;
  batteryPolicy: string;
  stepHours: string;
}

interface Scenario {
  key: string;
  name: string;
  /** What this scenario is for, shown above the inputs. */
  blurb: string;
  members: Member[];
  limits: Limits;
}

const DEFAULT_LIMITS: Limits = { feederLimitKw: "1000", networkLossFraction: "0", rule: "PROPORTIONAL", batteryPolicy: "SHARE_FIRST", stepHours: "1" };

const building = (id: string, name: string, generationKw: number, demandKw: number, over: Partial<Member> = {}): Member => ({
  id,
  name,
  generationKw,
  demandKw,
  criticalKw: 0,
  battery: null,
  exportLimitKw: 100000,
  importLimitKw: 100000,
  lineLossFraction: 0,
  ...over,
});

/**
 * Three starting points. The first is the worked example this feature was specified against; the second takes the sun
 * away; the third leaves the sun alone and shrinks the shared feeder instead.
 */
const SCENARIOS: Scenario[] = [
  {
    key: "surplus",
    name: "1. Sunny midday: one roof covers the street",
    blurb:
      "Building A has more sun than it can use while B and C are short. Together the three generate exactly what they use, so if the modelled network lets the surplus move, the community buys nothing at all. Lossless, with no batteries, so the arithmetic is easy to check by hand.",
    members: [building("a", "Building A", 8, 3), building("b", "Building B", 2, 4), building("c", "Building C", 0, 3)],
    limits: { ...DEFAULT_LIMITS },
  },
  {
    key: "deficit",
    name: "2. Dull evening: the community is short",
    blurb:
      "The same three buildings with the sun almost gone and demand unchanged. There is no surplus to share, so the question becomes what the batteries can cover and how much has to be bought. A and B have storage; C has none.",
    members: [
      building("a", "Building A", 1, 3, { battery: { usableKwh: 10, socKwh: 8, reserveKwh: 2, maxChargeKw: 5, maxDischargeKw: 4, roundTripEfficiency: 0.9 } }),
      building("b", "Building B", 0.5, 4, { battery: { usableKwh: 5, socKwh: 1, reserveKwh: 1, maxChargeKw: 3, maxDischargeKw: 3, roundTripEfficiency: 0.9 } }),
      building("c", "Building C", 0, 3),
    ],
    limits: { ...DEFAULT_LIMITS },
  },
  {
    key: "constrained",
    name: "3. Sunny midday, but the feeder is small",
    blurb:
      "Scenario 1 again, except the shared feeder carries only 3 kW and the network loses 5% of what crosses it. The surplus exists and the demand exists, but the wires between them cannot carry it, so some of the deficit goes to the grid and some of the surplus is sold instead. This is the case a demonstration that ignores network limits never shows.",
    members: [
      building("a", "Building A", 8, 3, { lineLossFraction: 0.02, exportLimitKw: 5 }),
      building("b", "Building B", 2, 4, { lineLossFraction: 0.03 }),
      building("c", "Building C", 0, 3, { lineLossFraction: 0.04, criticalKw: 1.5 }),
    ],
    limits: { ...DEFAULT_LIMITS, feederLimitKw: "3", networkLossFraction: "0.05" },
  },
];

const RULE_WORDS: Record<string, string> = {
  PROPORTIONAL: "Proportional — in proportion to what each asked for",
  EQUAL_SHARE: "Equal share — the same to each until its need is met",
  CRITICAL_FIRST: "Critical first — demand marked critical before anything else",
  NEAREST_FIRST: "Nearest first — the smallest line loss first, so least is lost",
};
const POLICY_WORDS: Record<string, string> = {
  SHARE_FIRST: "Share first — a surplus goes to the neighbours before it charges my battery",
  BATTERY_FIRST: "Battery first — fill my own battery for backup, then share",
};
const BINDING_WORDS: Record<string, string> = {
  NONE: "—",
  EXPORT_LIMIT: "Its own export limit",
  IMPORT_LIMIT: "Its own import limit",
  FEEDER_LIMIT: "The shared feeder",
  NO_TAKER: "Nobody needed it",
  NO_SUPPLY: "Nobody had any to give",
  BATTERY_FULL: "Its battery was full",
  BATTERY_EMPTY: "Its battery was at its reserve floor",
};
const STATUS_WORDS: Record<string, string> = { SURPLUS: "Surplus", DEFICIT: "Short", BALANCED: "Balanced" };

const kw = (v: number) => `${formatNumber(v)} kW`;
const n2 = (v: number) => formatNumber(Math.round(v * 100) / 100);

function Figure({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`num text-lg font-semibold ${tone === "good" ? "text-[color:var(--tone-live-fg)]" : tone === "bad" ? "text-[color:var(--tone-unavailable-fg)]" : ""}`}>{value}</dd>
      {hint && <dd className="text-xs text-muted">{hint}</dd>}
    </div>
  );
}

/** A property's row of editable figures. */
function MemberEditor({ m, onChange, onRemove, canRemove }: { m: Member; onChange(next: Member): void; onRemove(): void; canRemove: boolean }) {
  const set = <K extends keyof Member>(key: K, v: Member[K]) => onChange({ ...m, [key]: v });
  const setBattery = (key: keyof NonNullable<Member["battery"]>, s: string) => {
    if (!m.battery) return;
    onChange({ ...m, battery: { ...m.battery, [key]: Number(s) } });
  };
  const toggleBattery = () =>
    onChange({ ...m, battery: m.battery ? null : { usableKwh: 10, socKwh: 5, reserveKwh: 1, maxChargeKw: 5, maxDischargeKw: 5, roundTripEfficiency: 0.9 } });

  return (
    <fieldset className="card p-3">
      <legend className="px-1 text-sm font-semibold">{m.name}</legend>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Name" required value={m.name} onChange={(v) => set("name", v)} />
        <Field label="Generating (kW)" required type="number" value={String(m.generationKw)} onChange={(v) => set("generationKw", Number(v))} hint="Solar right now" />
        <Field label="Using (kW)" required type="number" value={String(m.demandKw)} onChange={(v) => set("demandKw", Number(v))} />
        <Field label="Of which critical (kW)" type="number" value={String(m.criticalKw ?? 0)} onChange={(v) => set("criticalKw", Number(v))} hint="Used by the Critical first rule" />
        <Field label="Export limit (kW)" type="number" value={String(m.exportLimitKw ?? 0)} onChange={(v) => set("exportLimitKw", Number(v))} hint="Most it may push past its meter" />
        <Field label="Import limit (kW)" type="number" value={String(m.importLimitKw ?? 0)} onChange={(v) => set("importLimitKw", Number(v))} hint="Its sanctioned load" />
        <Field label="Line loss (0–0.5)" type="number" value={String(m.lineLossFraction ?? 0)} onChange={(v) => set("lineLossFraction", Number(v))} hint="Lost on its own leg" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-ghost text-xs" onClick={toggleBattery} aria-pressed={m.battery !== null}>
          {m.battery ? "Remove the battery" : "Give it a battery"}
        </button>
        {canRemove && (
          <button type="button" className="btn btn-ghost text-xs" onClick={onRemove}>
            Remove {m.name}
          </button>
        )}
      </div>
      {m.battery && (
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3 sm:grid-cols-3">
          <Field label="Usable (kWh)" required type="number" value={String(m.battery.usableKwh)} onChange={(v) => setBattery("usableKwh", v)} />
          <Field label="Stored now (kWh)" required type="number" value={String(m.battery.socKwh)} onChange={(v) => setBattery("socKwh", v)} />
          <Field label="Keep back (kWh)" type="number" value={String(m.battery.reserveKwh ?? 0)} onChange={(v) => setBattery("reserveKwh", v)} hint="Backup reserve" />
          <Field label="Max charge (kW)" required type="number" value={String(m.battery.maxChargeKw)} onChange={(v) => setBattery("maxChargeKw", v)} />
          <Field label="Max discharge (kW)" required type="number" value={String(m.battery.maxDischargeKw)} onChange={(v) => setBattery("maxDischargeKw", v)} />
          <Field label="Round trip (0–1)" type="number" value={String(m.battery.roundTripEfficiency ?? 0.9)} onChange={(v) => setBattery("roundTripEfficiency", v)} />
        </div>
      )}
    </fieldset>
  );
}

/** A bar showing where one property's energy came from and went, to scale against the biggest property on the page. */
function FlowBar({ parts, max }: { parts: { label: string; value: number; color: string }[]; max: number }) {
  const shown = parts.filter((p) => p.value > 0.0001);
  if (shown.length === 0 || max <= 0) return <span className="text-xs text-muted">nothing</span>;
  return (
    <span className="flex h-4 w-full items-stretch overflow-hidden rounded-sm" role="img" aria-label={shown.map((p) => `${p.label} ${n2(p.value)} kW`).join(", ")}>
      {shown.map((p) => (
        <span key={p.label} title={`${p.label}: ${n2(p.value)} kW`} style={{ width: `${(p.value / max) * 100}%`, background: p.color }} />
      ))}
    </span>
  );
}

export function AllocationWorkbench() {
  const [scenarioKey, setScenarioKey] = useState(SCENARIOS[0]!.key);
  const [members, setMembers] = useState<Member[]>(SCENARIOS[0]!.members);
  const [limits, setLimits] = useState<Limits>(SCENARIOS[0]!.limits);
  const [result, setResult] = useState<CommunityAllocation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** True once the inputs have been edited since the shown result was produced. */
  const [stale, setStale] = useState(false);
  const firstRun = useRef(true);

  const run = useCallback(
    async (ms: Member[], ls: Limits) => {
      setBusy(true);
      setError(null);
      try {
        const body = {
          members: ms.map((m) => ({ ...m, battery: m.battery })),
          limits: {
            feederLimitKw: Number(ls.feederLimitKw),
            networkLossFraction: Number(ls.networkLossFraction),
            rule: ls.rule,
            batteryPolicy: ls.batteryPolicy,
            stepHours: Number(ls.stepHours),
          },
        };
        const r = await api<CommunityAllocation>("/api/community/allocate", { method: "POST", body });
        setResult(r);
        setStale(false);
      } catch (e) {
        setError(describeError(e));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  // Work out the first scenario on arrival, so the page is never an empty form.
  useEffect(() => {
    if (!firstRun.current) return;
    firstRun.current = false;
    void run(SCENARIOS[0]!.members, SCENARIOS[0]!.limits);
  }, [run]);

  const pick = (key: string) => {
    const s = SCENARIOS.find((x) => x.key === key);
    if (!s) return;
    setScenarioKey(key);
    setMembers(s.members);
    setLimits(s.limits);
    void run(s.members, s.limits);
  };

  const editMember = (i: number, next: Member) => {
    setMembers((ms) => ms.map((m, j) => (j === i ? next : m)));
    setStale(true);
  };
  const editLimits = (patch: Partial<Limits>) => {
    setLimits((l) => ({ ...l, ...patch }));
    setStale(true);
  };
  const addMember = () => {
    setMembers((ms) => [...ms, building(`m${ms.length + 1}-${Date.now().toString(36)}`, `Building ${String.fromCharCode(65 + ms.length)}`, 0, 2)]);
    setStale(true);
  };

  const scenario = SCENARIOS.find((s) => s.key === scenarioKey);
  const v = result?.result.value ?? null;
  const totals = v?.totals ?? null;
  const maxFlow = v ? Math.max(1, ...v.members.map((m) => Math.max(m.generationKw + m.batteryDischargeKw + m.receivedKw + m.gridImportKw, m.demandKw + m.batteryChargeKw + m.sentKw + m.gridExportKw + m.curtailedKw))) : 1;

  return (
    <section aria-labelledby="workbench-heading" className="mt-8">
      <h2 id="workbench-heading" className="text-lg font-semibold">
        Allocation workbench
      </h2>
      <p className="mt-1 text-sm text-muted">
        Who could meet whose shortfall in a single interval, and what stops them. Change anything below and recalculate: every number comes back from the same engine the rest of AVISHKAR uses, and none of it is stored.
      </p>
      <div role="note" className="mt-2 rounded-md bg-[color:var(--tone-simulated-bg)] p-2 text-sm font-semibold text-[color:var(--tone-simulated-fg)]">
        COMMUNITY ALLOCATION SIMULATION — a calculation over figures you chose, not a measurement, and not a record of electricity that moved.
      </div>

      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Starting scenarios">
        {SCENARIOS.map((s) => (
          <button key={s.key} type="button" className={`btn text-xs ${s.key === scenarioKey ? "btn-primary" : "btn-ghost"}`} aria-pressed={s.key === scenarioKey} onClick={() => pick(s.key)}>
            {s.name}
          </button>
        ))}
      </div>
      {scenario && <p className="mt-2 text-sm text-muted">{scenario.blurb}</p>}

      <fieldset className="card mt-4 p-3">
        <legend className="px-1 text-sm font-semibold">The shared network</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Feeder limit (kW)" required type="number" value={limits.feederLimitKw} onChange={(v2) => editLimits({ feederLimitKw: v2 })} hint="Most the shared node may carry" />
          <Field label="Network loss (0–0.5)" type="number" value={limits.networkLossFraction} onChange={(v2) => editLimits({ networkLossFraction: v2 })} hint="Lost crossing the shared network" />
          <Field label="Interval (hours)" type="number" value={limits.stepHours} onChange={(v2) => editLimits({ stepHours: v2 })} hint="How long this situation lasts" />
          <SelectField label="When there is not enough to go round" value={limits.rule} onChange={(v2) => editLimits({ rule: v2 })} options={Object.entries(RULE_WORDS).map(([value, label]) => ({ value, label }))} className="sm:col-span-2" />
          <SelectField label="A surplus goes to" value={limits.batteryPolicy} onChange={(v2) => editLimits({ batteryPolicy: v2 })} options={Object.entries(POLICY_WORDS).map(([value, label]) => ({ value, label }))} className="sm:col-span-2" />
        </div>
      </fieldset>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {members.map((m, i) => (
          <MemberEditor
            key={m.id}
            m={m}
            canRemove={members.length > 1}
            onChange={(next) => editMember(i, next)}
            onRemove={() => {
              setMembers((ms) => ms.filter((_, j) => j !== i));
              setStale(true);
            }}
          />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary" onClick={() => void run(members, limits)} disabled={busy}>
          {busy ? "Working it out…" : "Recalculate"}
        </button>
        <button type="button" className="btn btn-ghost text-sm" onClick={addMember}>
          Add a building
        </button>
        {stale && !busy && <span className="text-xs text-[color:var(--tone-updated-fg)]">The figures below are for the inputs before your change. Recalculate to bring them up to date.</span>}
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-md bg-[color:var(--tone-unavailable-bg)] p-2 text-sm text-[color:var(--tone-unavailable-fg)]">
          {error}
        </p>
      )}

      {v && totals && (
        <div className={stale ? "mt-6 opacity-60" : "mt-6"}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">What happens</h3>
            <StatusBadge status={result!.result.provenance.status} />
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Figure label="Generated" value={kw(totals.generationKw)} hint={`used on site: ${kw(totals.selfUseKw)}`} />
            <Figure label="Used" value={kw(totals.demandKw)} />
            <Figure label="Shared between them" value={kw(totals.sharedDeliveredKw)} hint={totals.transferLossKw > 0 ? `${kw(totals.sharedSentKw)} sent, ${kw(totals.transferLossKw)} lost carrying it` : "nothing lost carrying it"} />
            <Figure
              label="Bought from the grid"
              value={kw(totals.gridImportKw)}
              tone={totals.gridImportKw === 0 ? "good" : undefined}
              hint={totals.gridImportKw === 0 ? "the community covered itself" : undefined}
            />
            <Figure label="Sold to the grid" value={kw(totals.gridExportKw)} />
            <Figure label="Thrown away" value={kw(totals.curtailedKw)} hint={totals.curtailedKw > 0 ? "an export limit would not let it out" : undefined} tone={totals.curtailedKw > 0 ? "bad" : undefined} />
            <Figure label="Batteries" value={`${kw(totals.batteryChargeKw)} in, ${kw(totals.batteryDischargeKw)} out`} />
            <Figure
              label="Demand left unserved"
              value={kw(totals.unservedKw)}
              tone={totals.unservedKw > 0 ? "bad" : undefined}
              hint={totals.unservedKw > 0 ? "no supply within the limits could reach it" : undefined}
            />
          </dl>

          {(totals.selfSufficiency !== null || totals.selfConsumption !== null) && (
            <p className="mt-3 text-sm text-muted">
              {totals.selfSufficiency !== null && <>The community met {formatNumber(totals.selfSufficiency * 100)}% of what it used without buying anything. </>}
              {totals.selfConsumption !== null && <>It used {formatNumber(totals.selfConsumption * 100)}% of what it generated, rather than selling or throwing it away.</>}
            </p>
          )}

          {v.feederBinding && (
            <p role="note" className="mt-3 rounded-md bg-[color:var(--tone-updated-bg)] p-2 text-sm text-[color:var(--tone-updated-fg)]">
              The shared feeder was the binding constraint: it carried its full {kw(v.limits.feederLimitKw)} while more was on offer. Surplus exists and demand exists, but the modelled wires between them cannot carry it.
            </p>
          )}

          <h4 className="mt-6 text-sm font-semibold">Each property</h4>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm">
              <caption className="sr-only">What each property generated, used, shared, bought and sold in this interval</caption>
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1 pr-3 font-medium">Property</th>
                  <th className="py-1 pr-3 font-medium">State</th>
                  <th className="py-1 pr-3 text-right font-medium">Generating</th>
                  <th className="py-1 pr-3 text-right font-medium">Using</th>
                  <th className="py-1 pr-3 text-right font-medium">Sent</th>
                  <th className="py-1 pr-3 text-right font-medium">Received</th>
                  <th className="py-1 pr-3 text-right font-medium">Battery</th>
                  <th className="py-1 pr-3 text-right font-medium">Bought</th>
                  <th className="py-1 pr-3 text-right font-medium">Sold</th>
                  <th className="py-1 pr-3 text-right font-medium">Unserved</th>
                  <th className="py-1 font-medium">Limited by</th>
                </tr>
              </thead>
              <tbody>
                {v.members.map((m) => (
                  <tr key={m.id} className="border-t border-line align-top">
                    <th scope="row" className="py-1 pr-3 text-left font-medium">
                      {m.name}
                    </th>
                    <td className="py-1 pr-3">{STATUS_WORDS[m.status] ?? m.status}</td>
                    <td className="num py-1 pr-3 text-right">{n2(m.generationKw)}</td>
                    <td className="num py-1 pr-3 text-right">{n2(m.demandKw)}</td>
                    <td className="num py-1 pr-3 text-right">{n2(m.sentKw)}</td>
                    <td className="num py-1 pr-3 text-right">{n2(m.receivedKw)}</td>
                    <td className="num py-1 pr-3 text-right">
                      {m.batterySocKwh === null ? "—" : `${m.batteryChargeKw > 0 ? `+${n2(m.batteryChargeKw)}` : m.batteryDischargeKw > 0 ? `−${n2(m.batteryDischargeKw)}` : "0"} → ${n2(m.batterySocKwh)} kWh`}
                    </td>
                    <td className="num py-1 pr-3 text-right">{n2(m.gridImportKw)}</td>
                    <td className="num py-1 pr-3 text-right">{n2(m.gridExportKw)}</td>
                    <td className={`num py-1 pr-3 text-right ${m.unservedKw > 0 ? "font-semibold text-[color:var(--tone-unavailable-fg)]" : ""}`}>{n2(m.unservedKw)}</td>
                    <td className="py-1 text-xs">{BINDING_WORDS[m.binding] ?? m.binding}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h4 className="mt-6 text-sm font-semibold">Where each property&rsquo;s energy came from and went</h4>
          <ul className="mt-2 space-y-3">
            {v.members.map((m) => (
              <li key={m.id}>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-medium">{m.name}</span>
                  <span className="text-muted">to scale across the community</span>
                </div>
                <div className="mt-1 grid gap-1">
                  <div className="flex items-center gap-2">
                    <span className="w-14 shrink-0 text-xs text-muted">In</span>
                    <FlowBar
                      max={maxFlow}
                      parts={[
                        { label: "Own solar", value: m.generationKw, color: "var(--tone-updated-fg)" },
                        { label: "Own battery", value: m.batteryDischargeKw, color: "var(--accent)" },
                        { label: "From the community", value: m.receivedKw, color: "var(--tone-live-fg)" },
                        { label: "Bought", value: m.gridImportKw, color: "var(--tone-unavailable-fg)" },
                      ]}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-14 shrink-0 text-xs text-muted">Out</span>
                    <FlowBar
                      max={maxFlow}
                      parts={[
                        { label: "Own use", value: m.demandKw - m.unservedKw, color: "var(--ink)" },
                        { label: "Into its battery", value: m.batteryChargeKw, color: "var(--accent)" },
                        { label: "To the community", value: m.sentKw, color: "var(--tone-live-fg)" },
                        { label: "Sold", value: m.gridExportKw, color: "var(--tone-estimated-fg)" },
                        { label: "Thrown away", value: m.curtailedKw, color: "var(--tone-unavailable-fg)" },
                      ]}
                    />
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted">{m.explanation}</p>
              </li>
            ))}
          </ul>

          {v.transfers.length > 0 && (
            <>
              <h4 className="mt-6 text-sm font-semibold">Who sent to whom</h4>
              <table className="mt-2 w-full text-sm">
                <caption className="sr-only">Energy sent between properties, with the loss on each pair</caption>
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-1 pr-3 font-medium">From</th>
                    <th className="py-1 pr-3 font-medium">To</th>
                    <th className="py-1 pr-3 text-right font-medium">Sent (kW)</th>
                    <th className="py-1 pr-3 text-right font-medium">Arrived (kW)</th>
                    <th className="py-1 text-right font-medium">Lost (kW)</th>
                  </tr>
                </thead>
                <tbody>
                  {v.transfers.map((t) => (
                    <tr key={`${t.fromId}-${t.toId}`} className="border-t border-line">
                      <th scope="row" className="py-1 pr-3 text-left font-medium">
                        {t.fromName}
                      </th>
                      <td className="py-1 pr-3">{t.toName}</td>
                      <td className="num py-1 pr-3 text-right">{n2(t.sentKw)}</td>
                      <td className="num py-1 pr-3 text-right">{n2(t.deliveredKw)}</td>
                      <td className="num py-1 text-right">{n2(t.lossKw)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-xs text-muted">
                The shared node pools everything, so nothing in the arithmetic says which kW of one property&rsquo;s surplus reached which neighbour. Each sender is divided over the receivers in the proportion they were served: an accounting convention, stated so you can see it.
              </p>
            </>
          )}

          {v.comparison && (
            <>
              <h4 className="mt-6 text-sm font-semibold">What it would cost</h4>
              <dl className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Figure label="Each on its own" value={formatInr(v.comparison.withoutSharingInr)} />
                <Figure label="With this allocation" value={formatInr(v.comparison.withSharingInr)} />
                <Figure label="Difference" value={formatInr(v.comparison.savingInr)} tone={v.comparison.savingInr > 0 ? "good" : v.comparison.savingInr < 0 ? "bad" : undefined} />
              </dl>
              <p className="mt-1 text-xs text-muted">{v.comparison.basis}</p>
            </>
          )}

          <h4 className="mt-6 text-sm font-semibold">Why it came out this way</h4>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted">
            {v.decisions.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ol>

          <p className={`mt-4 text-xs ${v.check.balanced ? "text-muted" : "font-semibold text-[color:var(--tone-unavailable-fg)]"}`}>
            {v.check.note} {v.check.balanced ? `Largest imbalance found: ${v.check.maxMemberErrorKw} kW.` : ""}
          </p>

          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted">
            {result!.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
