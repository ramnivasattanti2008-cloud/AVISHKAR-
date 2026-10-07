"use client";

import { useState } from "react";
import { api, describeError } from "@/lib/api";
import type { Appliance, Battery, Ev, SolarSystem } from "@/lib/types";
import { Field, FormShell, STATUS_OPTIONS, SelectField, fromPct, num, str, toPct } from "./fields";

interface FormProps<T> {
  propertyId: string;
  initial?: T;
  onSaved(): void;
  onCancel(): void;
}

/** Create or change one asset. A blank optional field is left out on create and sent as null (cleared) on change. */
function useSave(propertyId: string, kind: string, initialId: string | undefined, onSaved: () => void) {
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  async function save(body: Record<string, unknown>) {
    setState({ busy: true, error: null });
    try {
      // Creating: leave blank optionals out. Changing: send them as null, which clears what was stored.
      const clean = initialId ? body : Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null && v !== undefined));
      await api(`/api/properties/${propertyId}/${kind}${initialId ? `/${initialId}` : ""}`, { method: initialId ? "PATCH" : "POST", body: clean });
      setState({ busy: false, error: null });
      onSaved();
    } catch (e) {
      setState({ busy: false, error: describeError(e) });
    }
  }
  return { ...state, save };
}

// ------------------------------------------------------------------ battery

export function BatteryForm({ propertyId, initial, onSaved, onCancel }: FormProps<Battery>) {
  const e = initial?.entered;
  const [name, setName] = useState(initial?.name ?? "");
  const [status, setStatus] = useState<Battery["status"]>(initial?.status ?? "EXISTING");
  const [cap, setCap] = useState(str(initial?.capacityKwh));
  const [chg, setChg] = useState(str(initial?.maxChargeKw));
  const [dis, setDis] = useState(str(initial?.maxDischargeKw));
  const [chEff, setChEff] = useState(toPct(e?.chargeEfficiency));
  const [diEff, setDiEff] = useState(toPct(e?.dischargeEfficiency));
  const [minSoc, setMinSoc] = useState(toPct(e?.minSoc));
  const [maxSoc, setMaxSoc] = useState(toPct(e?.maxSoc));
  const [reserve, setReserve] = useState(toPct(e?.reserveSoc));
  const [cycles, setCycles] = useState(str(e?.ratedCycles));
  const [wear, setWear] = useState(str(e?.wearInrPerKwh));
  const [soc, setSoc] = useState(toPct(e?.currentSoc));
  const { busy, error, save } = useSave(propertyId, "batteries", initial?.id, onSaved);
  return (
    <FormShell
      title={initial ? `Change ${initial.name}` : "Add a battery"}
      busy={busy}
      error={error}
      submitLabel={initial ? "Save changes" : "Add battery"}
      onCancel={onCancel}
      onSubmit={() =>
        save({
          name,
          status,
          capacityKwh: num(cap),
          maxChargeKw: num(chg),
          maxDischargeKw: num(dis),
          chargeEfficiency: fromPct(chEff),
          dischargeEfficiency: fromPct(diEff),
          minSoc: fromPct(minSoc),
          maxSoc: fromPct(maxSoc),
          reserveSoc: fromPct(reserve),
          ratedCycles: num(cycles),
          wearInrPerKwh: num(wear),
          currentSoc: fromPct(soc),
        })
      }
    >
      <Field label="Name" value={name} onChange={setName} required className="sm:col-span-2" placeholder="for example: Garage battery" />
      <SelectField label="Status" value={status} onChange={(v) => setStatus(v as typeof status)} options={STATUS_OPTIONS} className="sm:col-span-2" />
      <Field label="Capacity, kWh" value={cap} onChange={setCap} type="number" required hint="Nominal capacity from the label or datasheet." />
      <Field label="Maximum charge power, kW" value={chg} onChange={setChg} type="number" required />
      <Field label="Maximum discharge power, kW" value={dis} onChange={setDis} type="number" required />
      <details className="sm:col-span-2">
        <summary className="cursor-pointer text-sm text-muted underline decoration-dotted underline-offset-2">More details (anything you leave blank uses a labelled default)</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Charging efficiency, %" value={chEff} onChange={setChEff} type="number" hint="One way, between 50 and 100." />
          <Field label="Discharging efficiency, %" value={diEff} onChange={setDiEff} type="number" />
          <Field label="Never used below, % of capacity" value={minSoc} onChange={setMinSoc} type="number" />
          <Field label="Never charged above, % of capacity" value={maxSoc} onChange={setMaxSoc} type="number" />
          <Field label="Backup reserve, % of capacity" value={reserve} onChange={setReserve} type="number" hint="Blank: the planner works it out from your critical loads." />
          <Field label="Charge now, % of capacity" value={soc} onChange={setSoc} type="number" />
          <Field label="Rated cycle life" value={cycles} onChange={setCycles} type="number" hint="From the datasheet." />
          <Field label="Wear cost, ₹ per kWh cycled" value={wear} onChange={setWear} type="number" />
        </div>
      </details>
    </FormShell>
  );
}

// -------------------------------------------------------------------- solar

export function SolarForm({ propertyId, initial, onSaved, onCancel }: FormProps<SolarSystem>) {
  const [name, setName] = useState(initial?.name ?? "");
  const [status, setStatus] = useState<SolarSystem["status"]>(initial?.status ?? "EXISTING");
  const [kwp, setKwp] = useState(str(initial?.capacityKwp));
  const [tilt, setTilt] = useState(str(initial?.tiltDeg));
  const [az, setAz] = useState(str(initial?.azimuthDeg));
  const [inv, setInv] = useState(str(initial?.inverterKw));
  const [loss, setLoss] = useState(toPct(initial?.entered.lossFraction));
  const [on, setOn] = useState(str(initial?.installedOn));
  const { busy, error, save } = useSave(propertyId, "solar-systems", initial?.id, onSaved);
  return (
    <FormShell
      title={initial ? `Change ${initial.name}` : "Add a solar system"}
      busy={busy}
      error={error}
      submitLabel={initial ? "Save changes" : "Add solar system"}
      onCancel={onCancel}
      onSubmit={() => save({ name, status, capacityKwp: num(kwp), tiltDeg: num(tilt), azimuthDeg: num(az), inverterKw: num(inv), lossFraction: fromPct(loss), installedOn: on || null })}
    >
      <Field label="Name" value={name} onChange={setName} required className="sm:col-span-2" placeholder="for example: South roof" />
      <SelectField label="Status" value={status} onChange={(v) => setStatus(v as typeof status)} options={STATUS_OPTIONS} className="sm:col-span-2" />
      <Field label="Capacity, kWp" value={kwp} onChange={setKwp} type="number" required hint="DC capacity of the panels." />
      <Field label="Tilt, degrees from flat" value={tilt} onChange={setTilt} type="number" required hint="0 is flat, 90 is vertical." />
      <Field label="Direction, degrees from north" value={az} onChange={setAz} type="number" required hint="180 faces south, 90 east, 270 west." />
      <Field label="Inverter limit, kW" value={inv} onChange={setInv} type="number" />
      <Field label="System losses, %" value={loss} onChange={setLoss} type="number" hint="Wiring, mismatch, soiling. Blank uses the default." />
      <Field label="Installed on" value={on} onChange={setOn} type="date" />
    </FormShell>
  );
}

// ---------------------------------------------------------------------- EV

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function EvForm({ propertyId, initial, onSaved, onCancel }: FormProps<Ev>) {
  const [name, setName] = useState(initial?.name ?? "");
  const [bat, setBat] = useState(str(initial?.batteryKwh));
  const [chg, setChg] = useState(str(initial?.chargerKw));
  const [target, setTarget] = useState(toPct(initial?.targetSoc ?? 0.8));
  const [soc, setSoc] = useState(toPct(initial?.currentSoc));
  const [time, setTime] = useState(initial?.departureTime ?? "08:00");
  const [days, setDays] = useState<number[]>(initial?.departureDays ?? [0, 1, 2, 3, 4]);
  const [eff, setEff] = useState(toPct(initial?.entered.chargerEfficiency));
  const { busy, error, save } = useSave(propertyId, "evs", initial?.id, onSaved);
  const toggle = (d: number) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));
  return (
    <FormShell
      title={initial ? `Change ${initial.name}` : "Add an electric vehicle"}
      busy={busy}
      error={error}
      submitLabel={initial ? "Save changes" : "Add vehicle"}
      onCancel={onCancel}
      onSubmit={() => save({ name, batteryKwh: num(bat), chargerKw: num(chg), targetSoc: fromPct(target), currentSoc: fromPct(soc), departureTime: time, departureDays: days, chargerEfficiency: fromPct(eff) })}
    >
      <Field label="Name" value={name} onChange={setName} required className="sm:col-span-2" placeholder="for example: Family car" />
      <Field label="Battery size, kWh" value={bat} onChange={setBat} type="number" required />
      <Field label="Charger power, kW" value={chg} onChange={setChg} type="number" required hint="What your home charger delivers." />
      <Field label="Charge wanted by departure, %" value={target} onChange={setTarget} type="number" required />
      <Field label="Charge now, %" value={soc} onChange={setSoc} type="number" />
      <Field label="Leaves at" value={time} onChange={setTime} type="time" required />
      <Field label="Charger efficiency, %" value={eff} onChange={setEff} type="number" hint="Blank uses a labelled default." />
      <fieldset className="sm:col-span-2">
        <legend className="text-sm text-muted">Leaves on these days</legend>
        <div className="mt-1 flex flex-wrap gap-3 text-sm">
          {DAYS.map((d, i) => (
            <label key={d} className="flex items-center gap-1">
              <input type="checkbox" checked={days.includes(i)} onChange={() => toggle(i)} /> {d}
            </label>
          ))}
        </div>
      </fieldset>
    </FormShell>
  );
}

// ---------------------------------------------------------------- appliance

const KINDS = ["refrigerator", "freezer", "air conditioner", "fan", "lights", "washing machine", "dishwasher", "water heater (geyser)", "water pump", "television", "computer", "router", "medical equipment", "oven", "iron", "pool pump", "other"];

export const PRIORITIES = [
  { value: "CRITICAL" as const, label: "Critical: must keep running in an outage (fridge, medical, router)" },
  { value: "IMPORTANT" as const, label: "Important: keep running if there is power to spare" },
  { value: "FLEXIBLE" as const, label: "Flexible: can be moved in time (washing machine, geyser, EV)" },
  { value: "DISCRETIONARY" as const, label: "Discretionary: first to go (pool pump, spare AC)" },
];

export function ApplianceForm({ propertyId, initial, onSaved, onCancel }: FormProps<Appliance>) {
  const f = initial?.flexibility;
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState(initial?.kind ?? "");
  const [priority, setPriority] = useState<Appliance["priority"]>(initial?.priority ?? "IMPORTANT");
  const [watts, setWatts] = useState(str(initial?.ratedPowerW));
  const [qty, setQty] = useState(str(initial?.quantity ?? 1));
  const [runtime, setRuntime] = useState(str(initial?.runtimeMinPerDay));
  const [from, setFrom] = useState(str(f?.earliestStart));
  const [to, setTo] = useState(str(f?.latestFinish));
  const [dur, setDur] = useState(str(f?.durationMin));
  const [interruptible, setInterruptible] = useState(f?.interruptible ?? false);
  const [comfort, setComfort] = useState(str(initial?.comfortNote));
  const { busy, error, save } = useSave(propertyId, "appliances", initial?.id, onSaved);
  const flexible = priority === "FLEXIBLE";
  return (
    <FormShell
      title={initial ? `Change ${initial.name}` : "Add an appliance"}
      busy={busy}
      error={error}
      submitLabel={initial ? "Save changes" : "Add appliance"}
      onCancel={onCancel}
      onSubmit={() =>
        save({
          name,
          kind,
          priority,
          ratedPowerW: num(watts),
          quantity: num(qty),
          runtimeMinPerDay: num(runtime),
          earliestStart: flexible ? from || null : null,
          latestFinish: flexible ? to || null : null,
          durationMin: flexible ? num(dur) : null,
          interruptible,
          comfortNote: comfort.trim() || null,
        })
      }
    >
      <Field label="Name" value={name} onChange={setName} required placeholder="for example: Kitchen fridge" />
      <div>
        <Field label="What it is" value={kind} onChange={setKind} required list="appliance-kinds" placeholder="start typing" />
        <datalist id="appliance-kinds">
          {KINDS.map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
      </div>
      <SelectField label="How important is it?" value={priority} onChange={(v) => setPriority(v as typeof priority)} options={PRIORITIES} className="sm:col-span-2" />
      <Field label="Rated power, W" value={watts} onChange={setWatts} type="number" required hint="From the label. A rating is a ceiling, not what it draws all the time." />
      <Field label="How many" value={qty} onChange={setQty} type="number" required />
      <Field label="Runs about this many minutes a day" value={runtime} onChange={setRuntime} type="number" />
      {flexible && (
        <fieldset className="grid gap-3 rounded-md border border-line p-3 sm:col-span-2 sm:grid-cols-3">
          <legend className="px-1 text-sm text-muted">When it may run</legend>
          <Field label="Earliest start" value={from} onChange={setFrom} type="time" required />
          <Field label="Must finish by" value={to} onChange={setTo} type="time" required hint="A window may run past midnight (22:00 to 06:00)." />
          <Field label="Runs for, minutes" value={dur} onChange={setDur} type="number" required />
          <label className="flex items-center gap-2 text-sm sm:col-span-3">
            <input type="checkbox" checked={interruptible} onChange={(e) => setInterruptible(e.target.checked)} /> It can be paused and resumed
          </label>
          <Field label="Anything it must not do" value={comfort} onChange={setComfort} className="sm:col-span-3" placeholder="for example: not between 22:00 and 06:00 (noise)" />
        </fieldset>
      )}
    </FormShell>
  );
}
