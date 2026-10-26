import type { ReactNode } from "react";
import { formatNumber } from "@/lib/format";
import type { Appliance, Battery, Ev, SolarSystem } from "@/lib/types";

type Param = Battery["effective"]["chargeEfficiency"];

const BASIS: Record<Param["basis"], { label: string; tone: string; title: string }> = {
  USER_ENTERED: { label: "ENTERED", tone: "reference", title: "A value you entered." },
  ASSUMPTION: { label: "DEFAULT", tone: "updated", title: "You did not enter this, so a labelled default is used. Enter your own for a better plan." },
  PLANNER: { label: "PLANNER", tone: "forecast", title: "Left for the planner to work out." },
};

/** A number a plan will use, and whether it is the owner's or a default we assumed. */
function ParamRow({ label, p, fmt }: { label: string; p: Param; fmt: (v: number) => string }) {
  const b = BASIS[p.basis];
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="flex flex-wrap items-center gap-2">
        <span className="num">{p.value === null ? "worked out by the planner" : fmt(p.value)}</span>
        <span className="badge" data-tone={b.tone} title={`${b.title} ${p.note}`}>
          {b.label}
        </span>
      </dd>
    </>
  );
}

function Card({ title, subtitle, badges, children, actions }: { title: string; subtitle?: string; badges?: ReactNode; children: ReactNode; actions: ReactNode }) {
  return (
    <article className="card p-4" aria-label={title}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">{badges}</div>
      </header>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">{children}</dl>
      <div className="mt-3 flex gap-2 border-t border-line pt-3">{actions}</div>
    </article>
  );
}

const planned = (s: "EXISTING" | "PLANNED") => (s === "PLANNED" ? <span className="badge" data-tone="demo" title="Used in what-if runs only, never in today's plan.">PLANNED</span> : null);
const pct = (f: number) => `${formatNumber(f * 100)}%`;

export function BatteryCard({ b, actions }: { b: Battery; actions: ReactNode }) {
  const e = b.effective;
  return (
    <Card title={b.name} subtitle={`${formatNumber(b.capacityKwh)} kWh, ${formatNumber(b.usableKwh)} kWh usable`} badges={planned(b.status)} actions={actions}>
      <dt className="text-muted">Power</dt>
      <dd className="num">
        {formatNumber(b.maxChargeKw)} kW in, {formatNumber(b.maxDischargeKw)} kW out
      </dd>
      <ParamRow label="Charging efficiency" p={e.chargeEfficiency} fmt={pct} />
      <ParamRow label="Discharging efficiency" p={e.dischargeEfficiency} fmt={pct} />
      <ParamRow label="Never used below" p={e.minSoc} fmt={pct} />
      <ParamRow label="Never charged above" p={e.maxSoc} fmt={pct} />
      <ParamRow label="Backup reserve" p={e.reserveSoc} fmt={pct} />
      <ParamRow label="Wear cost" p={e.wearInrPerKwh} fmt={(v) => `₹${formatNumber(v)} per kWh`} />
      {b.entered.currentSoc !== null && (
        <>
          <dt className="text-muted">Charge now</dt>
          <dd className="num">{pct(b.entered.currentSoc)}</dd>
        </>
      )}
    </Card>
  );
}

export function SolarCard({ s, actions }: { s: SolarSystem; actions: ReactNode }) {
  return (
    <Card title={s.name} subtitle={`${formatNumber(s.capacityKwp)} kWp`} badges={planned(s.status)} actions={actions}>
      <dt className="text-muted">Orientation</dt>
      <dd className="num">
        tilt {formatNumber(s.tiltDeg)}°, facing {formatNumber(s.azimuthDeg)}° from north
      </dd>
      {s.inverterKw !== null && (
        <>
          <dt className="text-muted">Inverter</dt>
          <dd className="num">{formatNumber(s.inverterKw)} kW</dd>
        </>
      )}
      <ParamRow label="System losses" p={s.effective.lossFraction} fmt={pct} />
      {s.installedOn && (
        <>
          <dt className="text-muted">Installed</dt>
          <dd>{s.installedOn}</dd>
        </>
      )}
    </Card>
  );
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function EvCard({ e, actions }: { e: Ev; actions: ReactNode }) {
  return (
    <Card title={e.name} subtitle={`${formatNumber(e.batteryKwh)} kWh battery, ${formatNumber(e.chargerKw)} kW charger`} actions={actions}>
      <dt className="text-muted">Wants</dt>
      <dd className="num">
        {pct(e.targetSoc)} by {e.departureTime} on {e.departureDays.map((d) => DAY_NAMES[d]).join(", ")}
      </dd>
      <ParamRow label="Charger efficiency" p={e.effective.chargerEfficiency} fmt={pct} />
      {e.currentSoc !== null && (
        <>
          <dt className="text-muted">Charge now</dt>
          <dd className="num">{pct(e.currentSoc)}</dd>
        </>
      )}
    </Card>
  );
}

const PRIORITY_TONE: Record<Appliance["priority"], string> = { CRITICAL: "unavailable", IMPORTANT: "updated", FLEXIBLE: "forecast", DISCRETIONARY: "reference" };

export function ApplianceCard({ a, actions }: { a: Appliance; actions: ReactNode }) {
  const f = a.flexibility;
  return (
    <Card
      title={a.quantity > 1 ? `${a.name} (×${a.quantity})` : a.name}
      subtitle={a.kind}
      badges={
        <span className="badge" data-tone={PRIORITY_TONE[a.priority]}>
          {a.priority}
        </span>
      }
      actions={actions}
    >
      <dt className="text-muted">Rated power</dt>
      <dd className="num">
        {formatNumber(a.ratedPowerW)} W{a.quantity > 1 ? `, ${formatNumber(a.totalRatedKw)} kW in total` : ""} <span className="text-xs text-muted">(a rating, not what it draws)</span>
      </dd>
      {a.runtimeMinPerDay !== null && (
        <>
          <dt className="text-muted">Runs</dt>
          <dd className="num">about {formatNumber(a.runtimeMinPerDay)} min a day</dd>
        </>
      )}
      {f.earliestStart && f.latestFinish && (
        <>
          <dt className="text-muted">May run</dt>
          <dd className="num">
            {f.earliestStart} to {f.latestFinish} for {f.durationMin} min{f.interruptible ? ", can be paused" : ""}
          </dd>
        </>
      )}
      {a.comfortNote && (
        <>
          <dt className="text-muted">Note</dt>
          <dd>{a.comfortNote}</dd>
        </>
      )}
    </Card>
  );
}
