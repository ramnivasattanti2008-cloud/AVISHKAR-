"use client";

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatInr, formatNumber } from "@/lib/format";
import type { Scenario } from "@/lib/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** What each month's electricity costs today and with the change: two bars per month. */
export function MonthlyCostChart({ s }: { s: Scenario }) {
  const rows = s.base.months.map((m, i) => ({ name: MONTHS[m.month - 1]!, today: m.netCostInr, changed: s.scenario.months[i]!.netCostInr }));
  const label = `Monthly electricity cost in rupees, today against the changed setup: ${rows.map((r) => `${r.name} ${Math.round(r.today)} against ${Math.round(r.changed)}`).join(", ")}`;
  return (
    <div className="h-56 w-full" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="name" stroke="var(--muted)" fontSize={11} />
          <YAxis stroke="var(--muted)" fontSize={11} width={52} tickFormatter={(v: number) => formatNumber(v)} />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={({ active, payload, label: l }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as (typeof rows)[number];
              return (
                <div className="card px-3 py-2 text-xs shadow-lg">
                  <div className="font-semibold">{l}</div>
                  <div className="num">Today: {formatInr(p.today)}</div>
                  <div className="num">Changed: {formatInr(p.changed)}</div>
                  <div className="num text-muted">Saves {formatInr(p.today - p.changed)}</div>
                </div>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="today" name="Today" fill="var(--muted)" fillOpacity={0.55} isAnimationActive={false} />
          <Bar dataKey="changed" name="With the change" fill="var(--accent)" isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Cumulative saving less the investment, year by year: it crosses zero at the payback. */
export function CashflowChart({ cashflows, investmentInr }: { cashflows: { year: number; cumulativeInr: number; discountedCumulativeInr: number }[]; investmentInr: number }) {
  const rows = [{ year: 0, cumulative: -investmentInr, discounted: -investmentInr }, ...cashflows.map((c) => ({ year: c.year, cumulative: c.cumulativeInr, discounted: c.discountedCumulativeInr }))];
  const last = rows[rows.length - 1]!;
  return (
    <div className="h-56 w-full" role="img" aria-label={`Cumulative position over ${cashflows.length} years: it starts at minus ${Math.round(investmentInr)} rupees and ends at ${Math.round(last.cumulative)} rupees, or ${Math.round(last.discounted)} rupees in today's money`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
          <XAxis dataKey="year" stroke="var(--muted)" fontSize={11} type="number" domain={[0, "dataMax"]} tickFormatter={(v: number) => `${v} y`} />
          <YAxis stroke="var(--muted)" fontSize={11} width={60} tickFormatter={(v: number) => formatNumber(v)} />
          <ReferenceLine y={0} stroke="var(--ink)" strokeDasharray="4 3" />
          <Tooltip
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as (typeof rows)[number] | undefined;
              if (!active || !p) return null;
              return (
                <div className="card px-3 py-2 text-xs shadow-lg">
                  <div className="font-semibold">Year {p.year}</div>
                  <div className="num">Net position: {formatInr(p.cumulative)}</div>
                  <div className="num text-muted">In today&apos;s money: {formatInr(p.discounted)}</div>
                </div>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="cumulative" name="Net position" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="discounted" name="In today's money" stroke="var(--muted)" strokeWidth={1.5} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
