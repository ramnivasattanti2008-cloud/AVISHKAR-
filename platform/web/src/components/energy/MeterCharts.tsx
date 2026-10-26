"use client";

import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatNumber } from "@/lib/format";
import type { EnergySummary } from "@/lib/types";

type Day = EnergySummary["dailyKwh"][number];

const shortDate = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${Number(d)}/${Number(m)}`;
};

/**
 * Energy read per local day. A day with too few readings is drawn faded and labelled partial: its total is what was read, not
 * what the property used, and it must never look like a quiet day.
 */
export function DailyChart({ days }: { days: Day[] }) {
  if (days.length === 0) return <p className="py-6 text-sm text-muted">No readings to chart.</p>;
  const partial = days.filter((d) => !d.complete).length;
  return (
    <figure>
      <div className="h-56 w-full" role="img" aria-label={`Energy read on each of ${days.length} days, from ${days[0]!.date} to ${days[days.length - 1]!.date}${partial ? `; ${partial} of them ${partial === 1 ? "is a partial day" : "are partial days"}` : ""}`}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <BarChart data={days} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDate} stroke="var(--muted)" fontSize={11} interval="preserveStartEnd" minTickGap={24} />
            <YAxis stroke="var(--muted)" fontSize={11} width={44} tickFormatter={(v: number) => formatNumber(v)} />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={({ active, payload }) => {
                const d = payload?.[0]?.payload as Day | undefined;
                if (!active || !d) return null;
                return (
                  <div className="card px-3 py-2 text-xs shadow-lg">
                    <div className="font-semibold">{d.date}</div>
                    <div className="num mt-0.5 text-sm">{formatNumber(d.kwh, "kWh")}</div>
                    <div className="text-muted">
                      {d.readings} of {d.expectedReadings} readings{d.complete ? "" : ": a partial day, not the day's consumption"}
                    </div>
                  </div>
                );
              }}
            />
            <Bar dataKey="kwh" isAnimationActive={false}>
              {days.map((d) => (
                <Cell key={d.date} fill="var(--accent)" fillOpacity={d.complete ? 0.85 : 0.3} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {partial > 0 && <figcaption className="mt-1 text-xs text-muted">Faded bars are partial days: only some readings exist, so the total is what was read, not what the property used.</figcaption>}
    </figure>
  );
}

const hh = (h: number) => String(h).padStart(2, "0");

/** Average power by hour of the day, all days together and weekdays against weekends where there are enough of each. */
export function PatternChart({ hourly, weekday, weekend }: { hourly: number[]; weekday: number[] | null; weekend: number[] | null }) {
  const data = hourly.map((all, h) => ({ hour: h, all, weekday: weekday?.[h], weekend: weekend?.[h] }));
  return (
    <div className="h-56 w-full" role="img" aria-label={`Average power by hour of the day, peaking at ${hh(hourly.indexOf(Math.max(...hourly)))}:00`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
          <XAxis dataKey="hour" tickFormatter={(h: number) => hh(h)} stroke="var(--muted)" fontSize={11} interval={3} />
          <YAxis stroke="var(--muted)" fontSize={11} width={44} tickFormatter={(v: number) => formatNumber(v)} unit="" />
          <Tooltip formatter={(v) => (typeof v === "number" ? `${formatNumber(v)} kW` : String(v))} labelFormatter={(h) => `${hh(Number(h))}:00 to ${hh((Number(h) + 1) % 24)}:00`} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="all" name="All days" stroke="var(--accent)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
          {weekday && <Line type="monotone" dataKey="weekday" name="Weekdays" stroke="var(--tone-forecast-fg)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />}
          {weekend && <Line type="monotone" dataKey="weekend" name="Weekends" stroke="var(--tone-estimated-fg)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
