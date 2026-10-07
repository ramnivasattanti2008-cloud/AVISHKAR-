"use client";

import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatNumber } from "@/lib/format";
import type { Plan } from "@/lib/types";

const HOUR = 3_600_000;
const clock = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
const when = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const dayName = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric" });

/** A tick every three local hours: "06:00", and the day at each midnight, because a plan runs across one. */
export function hourAxis(from: number, to: number): { ticks: number[]; label: (t: number) => string } {
  const ticks: number[] = [];
  const d = new Date(from);
  d.setMinutes(0, 0, 0);
  d.setHours(Math.ceil(d.getHours() / 3) * 3);
  while (d.getTime() <= to) {
    ticks.push(d.getTime());
    d.setHours(d.getHours() + 3);
  }
  return { ticks, label: (t) => (new Date(t).getHours() === 0 ? dayName.format(t) : clock.format(t)) };
}

interface Row {
  t: number;
  [k: string]: number;
}

function Frame({ rows, label, height = "h-56", unit, children, domain }: { rows: Row[]; label: string; height?: string; unit: string; children: React.ReactNode; domain?: [number, number] }) {
  const { ticks, label: tick } = hourAxis(rows[0]!.t, rows[rows.length - 1]!.t + HOUR);
  return (
    <div className={`${height} w-full`} role="img" aria-label={`${label}, in ${unit}, hour by hour from ${when.format(rows[0]!.t)} to ${when.format(rows[rows.length - 1]!.t + HOUR)}`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
          <XAxis dataKey="t" type="number" scale="time" domain={[rows[0]!.t, rows[rows.length - 1]!.t + HOUR]} ticks={ticks} interval={0} tickFormatter={tick} stroke="var(--muted)" fontSize={11} />
          <YAxis stroke="var(--muted)" fontSize={11} width={44} domain={domain ?? [0, "auto"]} tickFormatter={(v: number) => formatNumber(v)} />
          {children}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

const SOLAR = "var(--tone-updated-fg)";
const BATTERY = "var(--tone-estimated-fg)";
const GRID = "var(--tone-forecast-fg)";

export const SERIES = [
  { key: "pvUsed", label: "Solar used now", color: SOLAR },
  { key: "fromBattery", label: "From the battery", color: BATTERY },
  { key: "fromGrid", label: "Bought from the grid", color: GRID },
] as const;

/** Where the power comes from each hour, stacked, with what the property itself uses as a line. Every flow is in the hover. */
export function SourcesChart({ plan }: { plan: Plan }) {
  const s = plan.schedule;
  const rows: Row[] = s.times.map((time, i) => {
    const appliances = Object.values(s.applianceKw).reduce((a, k) => a + (k[i] ?? 0), 0);
    return {
      t: Date.parse(time),
      pvUsed: s.pvUsedKw[i]!,
      fromBattery: s.batteryDischargeKw[i]!,
      fromGrid: s.gridImportKw[i]!,
      use: s.loadKw[i]! + appliances + s.evChargeKw[i]!,
      charging: s.batteryChargeKw[i]!,
      exporting: s.gridExportKw[i]!,
      curtailed: s.pvCurtailedKw[i]!,
    };
  });
  return (
    <Frame rows={rows} label="Where the power comes from" unit="kW">
      <Tooltip
        content={({ active, payload }) => {
          const r = payload?.[0]?.payload as Row | undefined;
          if (!active || !r) return null;
          return (
            <div className="card px-3 py-2 text-xs shadow-lg">
              <div className="font-semibold">{when.format(r.t)}</div>
              <div className="num mt-1">Your use: {formatNumber(r.use!, "kW")}</div>
              {SERIES.map((x) => (
                <div key={x.key} className="num" style={{ color: x.color }}>
                  {x.label}: {formatNumber(r[x.key]!, "kW")}
                </div>
              ))}
              {r.charging! > 0.005 && <div className="num text-muted">Charging the battery: {formatNumber(r.charging!, "kW")}</div>}
              {r.exporting! > 0.005 && <div className="num text-muted">Sold to the grid: {formatNumber(r.exporting!, "kW")}</div>}
              {r.curtailed! > 0.005 && <div className="num text-muted">Solar not used: {formatNumber(r.curtailed!, "kW")}</div>}
            </div>
          );
        }}
      />
      {SERIES.map((x) => (
        <Area key={x.key} type="stepAfter" dataKey={x.key} stackId="src" stroke={x.color} fill={x.color} fillOpacity={0.45} strokeWidth={1.5} isAnimationActive={false} />
      ))}
      <Line type="stepAfter" dataKey="use" stroke="var(--ink)" strokeWidth={2} dot={false} strokeDasharray="5 3" isAnimationActive={false} />
    </Frame>
  );
}

/** The battery's charge at the end of each hour, with its usable ceiling and the reserve it keeps back. */
export function BatteryChart({ plan }: { plan: Plan }) {
  const b = plan.inputs.battery;
  if (!b) return null;
  const rows: Row[] = plan.schedule.times.map((time, i) => ({ t: Date.parse(time) + HOUR, soc: plan.schedule.batterySocKwh[i]! }));
  const all: Row[] = [{ t: Date.parse(plan.schedule.times[0]!), soc: b.startSocKwh }, ...rows];
  return (
    <Frame rows={all} label="Battery charge" unit="kWh" height="h-44" domain={[0, b.capacityKwh]}>
      <Tooltip
        content={({ active, payload }) => {
          const r = payload?.[0]?.payload as Row | undefined;
          if (!active || !r) return null;
          return (
            <div className="card px-3 py-2 text-xs shadow-lg">
              <div className="font-semibold">{when.format(r.t)}</div>
              <div className="num">{formatNumber(r.soc!, "kWh")} stored</div>
            </div>
          );
        }}
      />
      {b.reserveKwh !== null && <ReferenceLine y={b.reserveKwh} stroke="var(--muted)" strokeDasharray="4 4" label={{ value: "reserve", fontSize: 10, fill: "var(--muted)", position: "insideTopRight" }} />}
      <Area type="monotone" dataKey="soc" stroke={BATTERY} fill={BATTERY} fillOpacity={0.35} strokeWidth={2} isAnimationActive={false} />
    </Frame>
  );
}

/** What a kWh costs to buy and earns when sold, hour by hour. */
export function PriceChart({ plan }: { plan: Plan }) {
  const s = plan.schedule;
  const rows: Row[] = s.times.map((time, i) => ({ t: Date.parse(time), buy: s.importPrice[i]!, sell: s.exportPrice[i]! }));
  return (
    <Frame rows={rows} label="Price per kWh" unit="rupees per kWh" height="h-36">
      <Tooltip
        content={({ active, payload }) => {
          const r = payload?.[0]?.payload as Row | undefined;
          if (!active || !r) return null;
          return (
            <div className="card px-3 py-2 text-xs shadow-lg">
              <div className="font-semibold">{when.format(r.t)}</div>
              <div className="num">Buy: ₹{formatNumber(r.buy!)} per kWh</div>
              <div className="num text-muted">Sell: ₹{formatNumber(r.sell!)} per kWh</div>
            </div>
          );
        }}
      />
      <Line type="stepAfter" dataKey="buy" stroke={GRID} strokeWidth={2} dot={false} isAnimationActive={false} />
      <Line type="stepAfter" dataKey="sell" stroke="var(--muted)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
    </Frame>
  );
}
