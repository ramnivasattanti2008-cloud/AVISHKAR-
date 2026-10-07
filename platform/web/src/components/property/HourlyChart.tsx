"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { STATUS, formatNumber } from "@/lib/format";
import type { DataStatus } from "@/lib/types";

export interface ChartPoint {
  time: string;
  value: number;
}

const day = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const dayParts = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric" });

function shortDay(t: number): string {
  const parts = dayParts.formatToParts(t);
  return `${parts.find((p) => p.type === "weekday")?.value ?? ""} ${parts.find((p) => p.type === "day")?.value ?? ""}`.trim();
}

/**
 * One label per local day, centred under the data that day has, and an unlabelled tick at each local midnight. Times of day
 * are never printed on the axis (they would repeat every day); the hover shows the exact time.
 */
export function dayAxis(from: number, to: number): { ticks: number[]; labels: Map<number, string> } {
  const ticks: number[] = [];
  const labels = new Map<number, string>();
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  while (d.getTime() <= to) {
    const start = d.getTime();
    d.setDate(d.getDate() + 1);
    const a = Math.max(start, from);
    const b = Math.min(d.getTime(), to);
    if (start >= from) ticks.push(start);
    const mid = Math.round((a + b) / 2);
    if (b - a >= 6 * 3_600_000) {
      ticks.push(mid);
      labels.set(mid, shortDay(mid));
    }
  }
  return { ticks, labels };
}

/**
 * A time series whose hover shows the timestamp, the value, the status and the source (spec section 88). Every chart is
 * given a real dataset; the component refuses to draw an empty one rather than drawing a placeholder.
 */
export function HourlyChart({ points, unit, status, source }: { points: ChartPoint[]; unit: string; status: DataStatus; source: string }) {
  if (points.length === 0) return <p className="py-6 text-sm text-muted">No data to chart.</p>;
  const data = points.map((p) => ({ t: new Date(p.time).getTime(), value: p.value }));
  const { ticks, labels } = dayAxis(data[0]!.t, data[data.length - 1]!.t);
  return (
    <div className="h-52 w-full" role="img" aria-label={`Chart of ${points.length} hourly values in ${unit}, from ${day.format(data[0]!.t)} to ${day.format(data[data.length - 1]!.t)}`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
          <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time" ticks={ticks} interval={0} tickFormatter={(t: number) => labels.get(t) ?? ""} stroke="var(--muted)" fontSize={11} />
          <YAxis stroke="var(--muted)" fontSize={11} width={44} tickFormatter={(v: number) => formatNumber(v)} />
          <Tooltip
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as { t: number; value: number } | undefined;
              if (!active || !p) return null;
              return (
                <div className="card px-3 py-2 text-xs shadow-lg">
                  <div className="font-semibold">{day.format(p.t)}</div>
                  <div className="num mt-0.5 text-sm">{formatNumber(p.value, unit)}</div>
                  <div className="mt-0.5">{STATUS[status].label}</div>
                  <div className="text-muted">{source}</div>
                </div>
              );
            }}
          />
          <Area type="monotone" dataKey="value" stroke={`var(--tone-${STATUS[status].tone}-fg)`} fill={`var(--tone-${STATUS[status].tone}-bg)`} strokeWidth={2} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
