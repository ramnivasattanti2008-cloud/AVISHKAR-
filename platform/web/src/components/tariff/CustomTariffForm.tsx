"use client";

import { useState } from "react";
import { api, describeError } from "@/lib/api";
import { STATES } from "@/lib/states";
import { CONSUMER_LABELS } from "@/lib/tariff";
import type { TariffPlan } from "@/lib/types";

type Kind = "blocks" | "slabs";
interface BlockRow {
  start: string;
  end: string;
  rate: string;
}
interface SlabRow {
  upTo: string;
  rate: string;
}

const num = (s: string) => (s.trim() === "" ? Number.NaN : Number(s));

/**
 * For a tariff that is not in the catalogue, or to correct one against a bill (spec section 22: manual input is the fallback
 * whenever tariff data is unavailable). The server checks the blocks cover the whole day and says exactly what is wrong.
 */
export function CustomTariffForm({ onCreated }: { onCreated: (plan: TariffPlan) => void }) {
  const [name, setName] = useState("");
  const [consumerType, setConsumerType] = useState<TariffPlan["consumerType"]>("RESIDENTIAL");
  const [state, setState] = useState("");
  const [discom, setDiscom] = useState("");
  const [kind, setKind] = useState<Kind>("blocks");
  const [blocks, setBlocks] = useState<BlockRow[]>([{ start: "0", end: "24", rate: "" }]);
  const [slabs, setSlabs] = useState<SlabRow[]>([{ upTo: "", rate: "" }]);
  const [fixed, setFixed] = useState("");
  const [fixedBasis, setFixedBasis] = useState<"PER_CONNECTION_MONTH" | "PER_KW_MONTH">("PER_CONNECTION_MONTH");
  const [exportRate, setExportRate] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { name, consumerType };
      if (state) body.state = state;
      if (discom.trim()) body.discom = discom.trim();
      if (kind === "blocks") body.touBlocks = blocks.map((b) => ({ startHour: num(b.start), endHour: num(b.end), rate: num(b.rate) }));
      else body.slabs = slabs.map((s, i) => ({ upToKwhPerMonth: i === slabs.length - 1 ? null : num(s.upTo), rate: num(s.rate) }));
      if (fixed.trim()) body.fixedCharge = { amountInr: num(fixed), basis: fixedBasis };
      if (exportRate.trim()) body.exportRate = num(exportRate);
      if (source.trim()) body.source = source.trim();
      const plan = await api<TariffPlan>("/api/tariffs", { method: "POST", body });
      onCreated(plan);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  const patchBlock = (i: number, p: Partial<BlockRow>) => setBlocks((cur) => cur.map((b, j) => (j === i ? { ...b, ...p } : b)));
  const patchSlab = (i: number, p: Partial<SlabRow>) => setSlabs((cur) => cur.map((s, j) => (j === i ? { ...s, ...p } : s)));

  return (
    <section className="card p-4" aria-label="Enter your own tariff">
      <h2 className="text-base font-semibold">Enter your own tariff</h2>
      <p className="mt-0.5 text-xs text-muted">Use the rates on your latest bill when your plan is not in the catalogue, or is out of date. Only you can see it.</p>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="text-sm sm:col-span-2">
          <span className="text-muted">Name</span>
          <input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder="for example: My home, BESCOM bill of March" />
        </label>
        <label className="text-sm">
          <span className="text-muted">Consumer type</span>
          <select className="field mt-1" value={consumerType} onChange={(e) => setConsumerType(e.target.value as TariffPlan["consumerType"])}>
            {Object.entries(CONSUMER_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
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
        <label className="text-sm sm:col-span-2">
          <span className="text-muted">Distribution company (optional)</span>
          <input className="field mt-1" value={discom} onChange={(e) => setDiscom(e.target.value)} maxLength={120} placeholder="for example: BESCOM" />
        </label>

        <fieldset className="sm:col-span-2">
          <legend className="text-sm text-muted">How the energy rate works</legend>
          <div className="mt-1 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="kind" checked={kind === "blocks"} onChange={() => setKind("blocks")} /> One rate, or rates by time of day
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="kind" checked={kind === "slabs"} onChange={() => setKind("slabs")} /> Slabs by monthly usage
            </label>
          </div>
        </fieldset>

        {kind === "blocks" ? (
          <div className="sm:col-span-2">
            <p className="text-xs text-muted">Hours are local time on a 24-hour clock; the blocks together must cover 0 to 24. A flat tariff is one block from 0 to 24. A block may run past midnight (22 to 6).</p>
            {blocks.map((b, i) => (
              <div key={i} className="mt-2 grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
                <label className="text-sm">
                  <span className="text-muted">From hour</span>
                  <input className="field mt-1" inputMode="decimal" value={b.start} onChange={(e) => patchBlock(i, { start: e.target.value })} required />
                </label>
                <label className="text-sm">
                  <span className="text-muted">To hour</span>
                  <input className="field mt-1" inputMode="decimal" value={b.end} onChange={(e) => patchBlock(i, { end: e.target.value })} required />
                </label>
                <label className="text-sm">
                  <span className="text-muted">₹ per kWh</span>
                  <input className="field mt-1" inputMode="decimal" value={b.rate} onChange={(e) => patchBlock(i, { rate: e.target.value })} required />
                </label>
                <button type="button" className="btn" onClick={() => setBlocks((cur) => cur.filter((_, j) => j !== i))} disabled={blocks.length === 1} aria-label={`Remove block ${i + 1}`}>
                  Remove
                </button>
              </div>
            ))}
            <button type="button" className="btn mt-2" onClick={() => setBlocks((cur) => [...cur, { start: "", end: "", rate: "" }])}>
              Add a time block
            </button>
          </div>
        ) : (
          <div className="sm:col-span-2">
            <p className="text-xs text-muted">Each slab prices only the units inside it. Leave the limit of the last slab empty: it covers everything above the previous slab.</p>
            {slabs.map((s, i) => {
              const last = i === slabs.length - 1;
              return (
                <div key={i} className="mt-2 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                  <label className="text-sm">
                    <span className="text-muted">{last ? "Above the previous slab" : "Up to (kWh a month)"}</span>
                    <input className="field mt-1" inputMode="decimal" value={last ? "" : s.upTo} disabled={last} onChange={(e) => patchSlab(i, { upTo: e.target.value })} required={!last} placeholder={last ? "no limit" : ""} />
                  </label>
                  <label className="text-sm">
                    <span className="text-muted">₹ per kWh</span>
                    <input className="field mt-1" inputMode="decimal" value={s.rate} onChange={(e) => patchSlab(i, { rate: e.target.value })} required />
                  </label>
                  <button type="button" className="btn" onClick={() => setSlabs((cur) => cur.filter((_, j) => j !== i))} disabled={slabs.length === 1} aria-label={`Remove slab ${i + 1}`}>
                    Remove
                  </button>
                </div>
              );
            })}
            <button type="button" className="btn mt-2" onClick={() => setSlabs((cur) => [...cur.slice(0, -1), { upTo: "", rate: cur[cur.length - 1]!.rate }, { upTo: "", rate: "" }])}>
              Add a slab
            </button>
          </div>
        )}

        <label className="text-sm">
          <span className="text-muted">Fixed charge, ₹ (optional)</span>
          <input className="field mt-1" inputMode="decimal" value={fixed} onChange={(e) => setFixed(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="text-muted">Fixed charge is</span>
          <select className="field mt-1" value={fixedBasis} onChange={(e) => setFixedBasis(e.target.value as typeof fixedBasis)}>
            <option value="PER_CONNECTION_MONTH">per connection, per month</option>
            <option value="PER_KW_MONTH">per kW of sanctioned load, per month</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="text-muted">Credit for exported energy, ₹ per kWh (optional)</span>
          <input className="field mt-1" inputMode="decimal" value={exportRate} onChange={(e) => setExportRate(e.target.value)} placeholder="from your net-metering agreement" />
        </label>
        <label className="text-sm">
          <span className="text-muted">Where these numbers come from (optional)</span>
          <input className="field mt-1" value={source} onChange={(e) => setSource(e.target.value)} maxLength={300} placeholder="for example: my bill of March 2026" />
        </label>

        {error && (
          <p role="alert" className="rounded-md bg-[color:var(--tone-unavailable-bg)] p-2 text-sm text-[color:var(--tone-unavailable-fg)] sm:col-span-2">
            {error}
          </p>
        )}
        <div className="sm:col-span-2">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save this tariff"}
          </button>
        </div>
      </form>
    </section>
  );
}
