"use client";

import { useEffect, useState } from "react";
import { formatNumber } from "@/lib/format";
import type { Plan } from "@/lib/types";

export function EnergyFlowDiagram({ plan }: { plan: Plan }) {
  const schedule = plan?.schedule;
  const times = schedule?.times ?? [];
  const numSteps = times.length || (schedule?.pvUsedKw ?? []).length || (schedule?.loadKw ?? []).length;
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing || numSteps === 0) return;
    const interval = setInterval(() => {
      setStep((prev) => (prev + 1) % numSteps);
    }, 1200);
    return () => clearInterval(interval);
  }, [playing, numSteps]);

  if (!schedule || numSteps === 0) return null;

  const currentStep = Math.min(step, numSteps - 1);
  const timeStr = times[currentStep] ?? plan.horizon?.start;
  const stepTime = timeStr ? new Date(timeStr) : new Date();
  const timeLabel = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(stepTime);

  const pvu = schedule.pvUsedKw?.[currentStep] ?? 0;
  const pvc = schedule.pvCurtailedKw?.[currentStep] ?? 0;
  const pvGen = pvu + pvc;
  const imp = schedule.gridImportKw?.[currentStep] ?? 0;
  const exp = schedule.gridExportKw?.[currentStep] ?? 0;
  const chg = schedule.batteryChargeKw?.[currentStep] ?? 0;
  const dis = schedule.batteryDischargeKw?.[currentStep] ?? 0;
  const soc = schedule.batterySocKwh?.[currentStep] ?? 0;
  const ev = schedule.evChargeKw?.[currentStep] ?? 0;
  const schedAny = schedule as Record<string, unknown>;
  const home = schedule.loadKw?.[currentStep] ?? (schedAny.servedLoadKw as number[] | undefined)?.[currentStep] ?? 0;
  const totalLoad = home + ev;

  // Power flows
  const solarToLoad = Math.min(pvu, totalLoad);
  const solarToBattery = Math.min(chg, Math.max(0, pvu - solarToLoad));
  const solarToGrid = exp;
  const batteryToLoad = dis;
  const gridToLoad = Math.max(0, totalLoad - solarToLoad - batteryToLoad);
  const gridToBattery = Math.max(0, chg - solarToBattery);

  const batteryCapacity = plan.inputs?.battery?.capacityKwh ?? (soc > 0 ? soc : 10);
  const socPct = batteryCapacity > 0 ? Math.min(100, Math.round((soc / batteryCapacity) * 100)) : 0;

  return (
    <section className="card mt-4 p-5" aria-label="Interactive Energy Flow Simulator">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Interactive Energy Flow Simulator</h2>
          <p className="text-xs text-muted">
            Live dispatch vector mapping generation, storage state, grid interchange, and domestic load for each planned IST hour.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setPlaying(!playing)}
            aria-label={playing ? "Pause simulation playback" : "Start simulation playback"}
          >
            {playing ? "⏸ Pause" : "▶ Animate Flow"}
          </button>
          <span className="badge badge-neutral font-mono text-xs font-semibold px-2.5 py-1">
            {timeLabel}
          </span>
        </div>
      </div>

      {/* Scrubbing slider */}
      <div className="mt-4 flex items-center gap-3">
        <label htmlFor="flow-time-scrubber" className="text-xs font-medium text-muted">
          Hour Step ({currentStep + 1}/{numSteps})
        </label>
        <input
          id="flow-time-scrubber"
          type="range"
          min="0"
          max={numSteps - 1}
          value={currentStep}
          onChange={(e) => {
            setPlaying(false);
            setStep(Number(e.target.value));
          }}
          className="h-2 w-full cursor-pointer accent-accent"
          aria-label="Timeline scrubber"
        />
      </div>

      {/* Modern High-Aesthetic Energy Dispatch Matrix */}
      <div className="relative mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Source: Solar Generation */}
        <div className="flex flex-col justify-between rounded-xl border border-line bg-surface/50 p-4 transition-all hover:border-accent/40">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <span className="text-amber-500">☀️</span> Solar Array
            </span>
            <span className="badge badge-neutral text-xs">
              {pvGen > 0.05 ? "ACTIVE GENERATING" : "IDLE"}
            </span>
          </div>
          <div className="my-3">
            <div className="num text-2xl font-bold tracking-tight text-amber-500">
              {formatNumber(pvGen)} <span className="text-sm font-normal text-muted">kW</span>
            </div>
            {pvc > 0.05 && (
              <p className="mt-1 text-xs text-rose-500">
                Curtailed: {formatNumber(pvc)} kW
              </p>
            )}
          </div>
          <div className="space-y-1 text-xs text-muted border-t border-line/50 pt-2">
            <div className="flex justify-between">
              <span>Direct to Home</span>
              <span className="num font-medium text-ink">{formatNumber(solarToLoad)} kW</span>
            </div>
            <div className="flex justify-between">
              <span>To Storage</span>
              <span className="num font-medium text-ink">{formatNumber(solarToBattery)} kW</span>
            </div>
            <div className="flex justify-between">
              <span>Exported to Grid</span>
              <span className="num font-medium text-ink">{formatNumber(solarToGrid)} kW</span>
            </div>
          </div>
        </div>

        {/* Core Storage: Battery Subsystem */}
        <div className="flex flex-col justify-between rounded-xl border border-line bg-surface/50 p-4 transition-all hover:border-accent/40">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <span className="text-emerald-500">🔋</span> Smart Storage
            </span>
            <span className="badge badge-neutral text-xs">
              {chg > 0.05 ? "CHARGING" : dis > 0.05 ? "DISCHARGING" : "STANDBY"}
            </span>
          </div>
          <div className="my-3">
            <div className="flex items-baseline justify-between">
              <div className="num text-2xl font-bold tracking-tight text-emerald-500">
                {socPct}% <span className="text-sm font-normal text-muted">SOC</span>
              </div>
              <div className="num text-xs text-muted">
                {formatNumber(soc)} / {formatNumber(batteryCapacity)} kWh
              </div>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-line/60">
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${socPct}%` }}
              />
            </div>
          </div>
          <div className="space-y-1 text-xs text-muted border-t border-line/50 pt-2">
            <div className="flex justify-between">
              <span>Charge Power</span>
              <span className="num font-medium text-ink">+{formatNumber(chg)} kW</span>
            </div>
            <div className="flex justify-between">
              <span>Discharge Power</span>
              <span className="num font-medium text-ink">-{formatNumber(dis)} kW</span>
            </div>
          </div>
        </div>

        {/* Grid Utility Interchange */}
        <div className="flex flex-col justify-between rounded-xl border border-line bg-surface/50 p-4 transition-all hover:border-accent/40">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <span className="text-blue-500">⚡</span> Utility Grid
            </span>
            <span className="badge badge-neutral text-xs">
              {imp > 0.05 ? "IMPORTING" : exp > 0.05 ? "FEED-IN EXPORT" : "ZERO DRAW"}
            </span>
          </div>
          <div className="my-3">
            <div className="num text-2xl font-bold tracking-tight text-blue-500">
              {imp > 0.05 ? `+${formatNumber(imp)}` : exp > 0.05 ? `-${formatNumber(exp)}` : "0.00"}{" "}
              <span className="text-sm font-normal text-muted">kW</span>
            </div>
            <p className="mt-1 text-xs text-muted">
              {imp > 0.05 ? "Supplying unserved demand" : exp > 0.05 ? "Selling surplus green solar" : "Autonomous microgrid island"}
            </p>
          </div>
          <div className="space-y-1 text-xs text-muted border-t border-line/50 pt-2">
            <div className="flex justify-between">
              <span>Import to Demand</span>
              <span className="num font-medium text-ink">{formatNumber(gridToLoad)} kW</span>
            </div>
            <div className="flex justify-between">
              <span>Import to Battery</span>
              <span className="num font-medium text-ink">{formatNumber(gridToBattery)} kW</span>
            </div>
          </div>
        </div>
      </div>

      {/* Demand Sinks: Household Loads & EV */}
      <div className="mt-4 rounded-xl border border-line bg-surface/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold">🏠 Domestic Demand Sinks</span>
          <span className="num text-sm font-bold text-ink">
            Total Demand: {formatNumber(totalLoad)} kW
          </span>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-line/60 bg-surface/60 p-3">
            <span className="text-xs text-muted">Base & Critical Appliances</span>
            <div className="num text-lg font-semibold">{formatNumber(home)} kW</div>
          </div>
          <div className="rounded-lg border border-line/60 bg-surface/60 p-3">
            <span className="text-xs text-muted">EV Smart Charger</span>
            <div className="num text-lg font-semibold">{formatNumber(ev)} kW</div>
          </div>
        </div>
      </div>
    </section>
  );
}
