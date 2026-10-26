"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatInr } from "@/lib/format";
import { useAuth } from "../AuthProvider";
import { PropertyTabs } from "./PropertyTabs";
import { usePropertyData } from "./usePropertyData";

// Sourced benchmark metrics for Indian Rooftop Solar & Storage (MNRE PM Surya Ghar & CEA benchmarks)
const SOLAR_COST_PER_KWP = 52000; // INR / kWp
const BATTERY_COST_PER_KWH = 26000; // INR / kWh (LFP chemistry)
const INVERTER_BOS_PER_KW = 8000; // Balance of system & net-metering infra
const ANNUAL_SOLAR_INSOLATION_HOURS = 1520; // kWh/kWp/year average Indian yield
const DISCOUNT_RATE = 0.08; // 8% nominal hurdle discount rate

/** Central Government Subsidy under PM Surya Ghar: Muft Bijli Yojana */
export function calculatePmSuryaGharSubsidy(solarKwp: number, isResidential: boolean): number {
  if (!isResidential || solarKwp <= 0) return 0;
  if (solarKwp <= 1) return 30000 * solarKwp;
  if (solarKwp <= 2) return 30000 + (solarKwp - 1) * 30000;
  if (solarKwp <= 3) return 60000 + (solarKwp - 2) * 18000;
  return 78000; // capped at 3 kWp for individual residential rooftop
}

export function InstallationPlanner({ id }: { id: string }) {
  const { user, loading: authLoading } = useAuth();
  const { property, twin, loading, error, notFound } = usePropertyData(id);

  // Proposed sizing state
  const defaultSolar = twin?.solar?.usableRoofAreaM2?.value ? Math.min(10, Math.max(1, Math.round((twin.solar.usableRoofAreaM2.value / 10) * 10) / 10)) : 3;
  const [solarKwp, setSolarKwp] = useState<number>(defaultSolar);
  const [batteryKwh, setBatteryKwh] = useState<number>(5);
  const [gridTariffInr, setGridTariffInr] = useState<number>(8.5); // Average peak tier INR/kWh
  const [dailyConsumptionKwh, setDailyConsumptionKwh] = useState<number>(14);

  // Financial and technical projections
  const projection = useMemo(() => {
    const isResidential = true;
    const grossSolarCapEx = solarKwp * SOLAR_COST_PER_KWP;
    const grossBatteryCapEx = batteryKwh * BATTERY_COST_PER_KWH;
    const balanceCost = (solarKwp + batteryKwh * 0.5) * INVERTER_BOS_PER_KW;
    const grossCapEx = grossSolarCapEx + grossBatteryCapEx + balanceCost;

    const subsidy = calculatePmSuryaGharSubsidy(solarKwp, isResidential);
    const netCapEx = Math.max(0, grossCapEx - subsidy);

    // Generation and self-consumption
    const annualGenKwh = solarKwp * ANNUAL_SOLAR_INSOLATION_HOURS;
    const dailyGenKwh = annualGenKwh / 365;
    const annualDemandKwh = dailyConsumptionKwh * 365;

    // Self consumption: Solar directly consumed + battery daily cycled
    const batteryUsablePerDay = batteryKwh * 0.85; // 85% DoD
    const selfConsumedKwhYear = Math.min(annualDemandKwh, annualGenKwh * 0.75 + batteryUsablePerDay * 365);
    const exportedKwhYear = Math.max(0, annualGenKwh - selfConsumedKwhYear);

    // Savings: Saved grid import at peak tariff + feed-in export at average net-metering rate (~₹3.2/kWh)
    const exportRateInr = 3.2;
    const annualSavingsInr = selfConsumedKwhYear * gridTariffInr + exportedKwhYear * exportRateInr;

    // Financial KPIs
    const simplePaybackYears = annualSavingsInr > 0 ? netCapEx / annualSavingsInr : 0;
    
    // 25-Year Levelized Cost of Energy (LCOE): Net CapEx + O&M discounted over 25 years lifetime
    let lifetimeGenDiscounted = 0;
    let lifetimeCostDiscounted = netCapEx;
    for (let yr = 1; yr <= 25; yr++) {
      const discount = Math.pow(1 + DISCOUNT_RATE, yr);
      const yearGen = annualGenKwh * Math.pow(0.993, yr - 1); // 0.7% degradation/year
      const yearOm = (grossCapEx * 0.015); // 1.5% O&M
      lifetimeGenDiscounted += yearGen / discount;
      lifetimeCostDiscounted += yearOm / discount;
    }
    const lcoePerKwh = lifetimeGenDiscounted > 0 ? lifetimeCostDiscounted / lifetimeGenDiscounted : 0;

    // Estimated 10-year battery degradation retention
    const annualCycles = 365;
    const tenYearCycles = annualCycles * 10;
    const estRetention = Math.max(70, Math.round((1 - Math.pow(tenYearCycles / 6000, 1.8) * 0.2) * 100));

    return {
      grossCapEx,
      subsidy,
      netCapEx,
      annualGenKwh,
      dailyGenKwh,
      annualSavingsInr,
      simplePaybackYears,
      lcoePerKwh,
      selfConsumptionPct: annualGenKwh > 0 ? Math.min(100, Math.round((selfConsumedKwhYear / annualGenKwh) * 100)) : 0,
      batteryRetention10Yr: estRetention,
    };
  }, [solarKwp, batteryKwh, gridTariffInr, dailyConsumptionKwh]);

  if (loading || authLoading) return <p role="status" className="p-6 text-sm text-muted">Loading…</p>;
  if (!user || notFound) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold">Property not found</h1>
        <p className="mt-3 text-muted">
          {user ? "This property does not exist or is not yours." : "Sign in to plan installations."}{" "}
          <Link className="font-semibold text-accent underline" href={user ? "/properties" : `/login?next=/property/${id}/planner`}>
            {user ? "Back to your properties" : "Sign in"}
          </Link>
        </p>
      </div>
    );
  }
  if (error || !property) return <p role="alert" className="p-6 text-sm text-[color:var(--tone-unavailable-fg)]">{error ?? "Could not load property."}</p>;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <PropertyTabs id={id} current="/planner" demo={property.isDemo} />

      <div className="mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Installation Sizing & Investment Planner</h1>
            <p className="mt-1 text-sm text-muted">
              Model solar PV capacity and BESS storage sizing against upfront capital costs, central MNRE PM Surya Ghar subsidies, and payback economics.
            </p>
          </div>
          <span className="badge badge-neutral">MNRE Benchmark Model</span>
        </div>

        {/* Input Configuration Grid */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="card space-y-5 p-5 lg:col-span-1">
            <h2 className="text-base font-semibold">Equipment Sizing</h2>

            <div>
              <div className="flex justify-between text-sm">
                <label htmlFor="solar-kwp" className="font-medium">Solar Array Capacity</label>
                <span className="num font-semibold text-amber-500">{solarKwp} kWp</span>
              </div>
              <input
                id="solar-kwp"
                type="range"
                min="1"
                max="20"
                step="0.5"
                value={solarKwp}
                onChange={(e) => setSolarKwp(parseFloat(e.target.value))}
                className="mt-2 w-full accent-amber-500"
              />
              <p className="mt-1 text-xs text-muted">
                Requires approx {Math.round(solarKwp * 8.5)} m² roof area {twin?.solar?.usableRoofAreaM2?.value ? `(Usable available: ${Math.round(twin.solar.usableRoofAreaM2.value)} m²)` : ""}
              </p>
            </div>

            <div>
              <div className="flex justify-between text-sm">
                <label htmlFor="battery-kwh" className="font-medium">Battery Storage (LFP)</label>
                <span className="num font-semibold text-emerald-500">{batteryKwh} kWh</span>
              </div>
              <input
                id="battery-kwh"
                type="range"
                min="0"
                max="30"
                step="1"
                value={batteryKwh}
                onChange={(e) => setBatteryKwh(parseFloat(e.target.value))}
                className="mt-2 w-full accent-emerald-500"
              />
              <p className="mt-1 text-xs text-muted">Provides ~{(batteryKwh * 0.85 / (dailyConsumptionKwh / 24)).toFixed(1)} hours of autonomous domestic backup</p>
            </div>

            <div className="border-t border-line/60 pt-4">
              <label htmlFor="grid-tariff" className="text-sm font-medium">Grid Peak Tariff (₹/kWh)</label>
              <input
                id="grid-tariff"
                type="number"
                step="0.1"
                min="3"
                max="25"
                value={gridTariffInr}
                onChange={(e) => setGridTariffInr(parseFloat(e.target.value) || 0)}
                className="field mt-1.5 w-full font-mono text-sm"
              />
            </div>

            <div>
              <label htmlFor="daily-consumption" className="text-sm font-medium">Mean Daily Consumption (kWh/day)</label>
              <input
                id="daily-consumption"
                type="number"
                step="0.5"
                min="2"
                max="100"
                value={dailyConsumptionKwh}
                onChange={(e) => setDailyConsumptionKwh(parseFloat(e.target.value) || 0)}
                className="field mt-1.5 w-full font-mono text-sm"
              />
            </div>
          </div>

          {/* Investment & Savings Cards */}
          <div className="space-y-6 lg:col-span-2">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="card p-4">
                <span className="text-xs font-medium text-muted">Gross Capital Investment</span>
                <div className="num mt-2 text-2xl font-bold tracking-tight text-ink">
                  {formatInr(projection.grossCapEx)}
                </div>
                <p className="mt-1 text-xs text-muted">Solar + Battery + Balance of System</p>
              </div>

              <div className="card p-4 border-emerald-500/30 bg-emerald-500/5">
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">PM Surya Ghar Subsidy</span>
                <div className="num mt-2 text-2xl font-bold tracking-tight text-emerald-500">
                  {formatInr(projection.subsidy)}
                </div>
                <p className="mt-1 text-xs text-muted">Direct benefit transfer for residential</p>
              </div>

              <div className="card p-4 border-accent/40 bg-accent/5">
                <span className="text-xs font-medium text-accent">Net Capital Outlay</span>
                <div className="num mt-2 text-2xl font-bold tracking-tight text-accent">
                  {formatInr(projection.netCapEx)}
                </div>
                <p className="mt-1 text-xs text-muted">Actual investment after subsidy</p>
              </div>
            </div>

            {/* Financial Performance KPI Matrix */}
            <div className="card p-5">
              <h3 className="text-sm font-semibold">25-Year Lifecycle Returns & Payback</h3>
              <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted">Annual Bill Savings</dt>
                  <dd className="num mt-1 text-xl font-bold text-emerald-500">{formatInr(projection.annualSavingsInr)}/yr</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Simple Payback Period</dt>
                  <dd className="num mt-1 text-xl font-bold text-ink">{projection.simplePaybackYears.toFixed(1)} years</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Solar LCOE (25 Years)</dt>
                  <dd className="num mt-1 text-xl font-bold text-indigo-500">₹{projection.lcoePerKwh.toFixed(2)} / kWh</dd>
                  <dd className="text-xs text-muted">vs ₹{gridTariffInr.toFixed(1)} grid rate</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Self-Consumption</dt>
                  <dd className="num mt-1 text-xl font-bold text-amber-500">{projection.selfConsumptionPct}%</dd>
                  <dd className="text-xs text-muted">Solar directly used</dd>
                </div>
              </dl>

              <div className="mt-5 border-t border-line/60 pt-4">
                <h4 className="text-xs font-semibold text-muted">Battery Degradation & Reliability Assessment</h4>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span>Projected 10-Year Battery Health (LFP Power-Law):</span>
                  <span className="num font-semibold text-emerald-500">{projection.batteryRetention10Yr}% SOH Remaining</span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-line/60">
                  <div className="h-full bg-emerald-500" style={{ width: `${projection.batteryRetention10Yr}%` }} />
                </div>
              </div>
            </div>

            {/* Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface/50 p-4">
              <div>
                <p className="text-sm font-semibold">Ready to test these equipment capacities?</p>
                <p className="text-xs text-muted">Run dynamic hour-by-hour dispatch simulation with this sized system.</p>
              </div>
              <Link href={`/property/${id}/what-if`} className="btn btn-primary">
                Simulate in What-If
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
