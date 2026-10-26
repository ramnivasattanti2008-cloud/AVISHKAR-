"use client";

import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { STATUS, formatNumber } from "@/lib/format";
import type { DataStatus } from "@/lib/types";
import { dayAxis } from "./HourlyChart";

export interface BandPoint {
  time: string;
  p50: number;
  /** Absent when no band is claimed: the chart then draws the central line alone. */
  p10: number | null;
  p90: number | null;
  /** A reference curve, such as what a cloudless sky would give. */
  reference?: number | null;
  /** Anything else worth a line in the hover. */
  extra?: string | null;
}

const when = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * A central estimate with the 10th to 90th percentile range drawn as a shaded band, and optionally a dashed reference curve.
 * The band exists only for points that carry one; the chart never invents a range.
 */
export function BandChart({
  points,
  unit,
  status,
  source,
  referenceLabel,
  label,
}: {
  points: BandPoint[];
  unit: string;
  status: DataStatus;
  source: string;
  referenceLabel?: string;
  label: string;
}) {
  if (points.length === 0) return <p className="py-6 text-sm text-muted">No data to chart.</p>;
  const data = points.map((p) => ({
    t: new Date(p.time).getTime(),
    p50: p.p50,
    lo: p.p10,
    band: p.p10 !== null && p.p90 !== null ? Math.max(0, p.p90 - p.p10) : null,
    hi: p.p90,
    ref: p.reference ?? null,
    extra: p.extra ?? null,
  }));
  const { ticks, labels } = dayAxis(data[0]!.t, data[data.length - 1]!.t);
  const tone = STATUS[status].tone;
  const hasBand = data.some((d) => d.band !== null);
  const hasRef = data.some((d) => d.ref !== null);
  const peak = data.reduce((a, d) => (d.p50 > a.p50 ? d : a), data[0]!);
  return (
    <div
      className="h-60 w-full"
      role="img"
      aria-label={`${label}: ${points.length} hourly values in ${unit}, from ${when.format(data[0]!.t)} to ${when.format(data[data.length - 1]!.t)}. The highest central estimate is ${formatNumber(peak.p50, unit)} at ${when.format(peak.t)}.${hasBand ? " The shaded band is the 10th to 90th percentile range." : ""}`}
    >
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
          <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time" ticks={ticks} interval={0} tickFormatter={(t: number) => labels.get(t) ?? ""} stroke="var(--muted)" fontSize={11} />
          <YAxis stroke="var(--muted)" fontSize={11} width={44} tickFormatter={(v: number) => formatNumber(v)} />
          <Tooltip
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!active || !p) return null;
              return (
                <div className="card px-3 py-2 text-xs shadow-lg">
                  <div className="font-semibold">{when.format(p.t)}</div>
                  <div className="num mt-0.5 text-sm">{formatNumber(p.p50, unit)}</div>
                  {p.lo !== null && p.hi !== null && (
                    <div className="num text-muted">
                      10–90%: {formatNumber(p.lo)} to {formatNumber(p.hi, unit)}
                    </div>
                  )}
                  {p.ref !== null && referenceLabel && (
                    <div className="num text-muted">
                      {referenceLabel}: {formatNumber(p.ref, unit)}
                    </div>
                  )}
                  {p.extra && <div className="text-muted">{p.extra}</div>}
                  <div className="mt-0.5">{STATUS[status].label}</div>
                  <div className="text-muted">{source}</div>
                </div>
              );
            }}
          />
          {hasBand && <Area type="monotone" dataKey="lo" stackId="band" stroke="none" fill="none" isAnimationActive={false} legendType="none" />}
          {hasBand && <Area type="monotone" dataKey="band" stackId="band" stroke="none" fill={`var(--tone-${tone}-bg)`} fillOpacity={1} isAnimationActive={false} legendType="none" />}
          {hasRef && <Line type="monotone" dataKey="ref" stroke="var(--muted)" strokeDasharray="4 4" strokeWidth={1.5} dot={false} isAnimationActive={false} />}
          <Line type="monotone" dataKey="p50" stroke={`var(--tone-${tone}-fg)`} strokeWidth={2} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
