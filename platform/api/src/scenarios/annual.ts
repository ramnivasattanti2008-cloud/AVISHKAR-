/**
 * A year of operation, estimated from typical days (spec sections 32 and 33): for each month one typical weekday and one typical
 * weekend day, each planned by the optimiser against the tariff, then weighted by how many such days the next year has. The
 * result is an estimate with stated assumptions, not a forecast: a typical day has no cloudy-day variability, and the load is the
 * property's own average pattern scaled to each month's use.
 */
import type { EngineClient } from "../engine/client.js";
import type { OptimiseRequest, OptimiseResponse } from "../engine/schemas.js";
import { AppError } from "../errors.js";
import type { MonthlySolar } from "../providers/solar-resource.js";
import { priceSeries } from "../plan/service.js";
import type { TariffPlanDto } from "../tariff/service.js";
import type { MonthDays } from "./calendar.js";

export interface PvSystemSpec {
  capacityKwp: number;
  tiltDeg: number;
  azimuthDeg: number;
  lossFraction: number;
  inverterKw: number | null;
}

export interface LoadModel {
  /** kW in each local hour of a typical weekday and weekend day, as measured over the property's complete days. */
  weekday: number[];
  weekend: number[];
  /** Each month's use relative to the average month (1 where the readings do not cover that month). */
  monthFactor: number[];
  /** Months with no readings of their own: they use the average month. */
  filledMonths: number[];
  meanDailyKwh: number;
}

export interface Config {
  solar: PvSystemSpec[];
  battery: NonNullable<OptimiseRequest["battery"]> | null;
  tariff: Pick<TariffPlanDto, "hourlyRates" | "slabs" | "export">;
}

export interface MonthResult {
  month: number;
  days: number;
  netCostInr: number;
  importKwh: number;
  exportKwh: number;
  pvKwh: number;
  loadKwh: number;
}

export interface AnnualResult {
  /** The bill with no solar and no battery: every kWh bought. */
  gridOnlyCostInr: number;
  /** The same equipment with no control: the battery idle, solar used as it falls, the surplus exported. */
  uncontrolledCostInr: number;
  /** The same equipment, planned. */
  netCostInr: number;
  importKwh: number;
  exportKwh: number;
  loadKwh: number;
  pvKwh: number;
  pvUsedKwh: number;
  selfConsumptionRatio: number | null;
  selfSufficiencyRatio: number | null;
  batteryCycles: number;
  months: MonthResult[];
}

export interface YearContext {
  engine: EngineClient;
  latitude: number;
  longitude: number;
  elevationM: number | null;
  climate: MonthlySolar[];
  load: LoadModel;
  days: MonthDays[];
  requestId?: string;
  /** Typical-day profiles already asked for, shared by every configuration of one request. */
  profiles: Map<string, Promise<number[][]>>;
}

/** Local midnight of 1 January 2026 (IST): hours 0 to 23 of a typical day map to the tariff's local hours. */
const LOCAL_MIDNIGHT = Date.UTC(2026, 0, 1) - 330 * 60_000;
const round = (v: number, d = 3): number => Math.round(v * 10 ** d) / 10 ** d;
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/** Typical-day power of one system, 12 months by 24 local hours. */
function pvProfile(ctx: YearContext, s: PvSystemSpec): Promise<number[][]> {
  const key = JSON.stringify([s, ctx.latitude, ctx.longitude]);
  let p = ctx.profiles.get(key);
  if (!p) {
    const months = ctx.climate.filter((m) => m.ghiKwhM2Day !== null).map((m) => ({ month: m.month, ghiKwhM2Day: m.ghiKwhM2Day as number, airTempC: m.airTempC }));
    if (months.length < 12) {
      throw new AppError("PLAN_INPUTS_MISSING", "The solar resource data for this place is incomplete (a month is missing), so a year of solar output cannot be estimated.", { missing: [{ what: "solar_resource", why: "Monthly irradiation is missing for this place." }] });
    }
    p = ctx.engine
      .solarTypicalDays(
        {
          location: { latitude: ctx.latitude, longitude: ctx.longitude, altitudeM: ctx.elevationM ?? 0 },
          system: { capacityKwp: s.capacityKwp, tiltDeg: s.tiltDeg, azimuthDeg: s.azimuthDeg, lossFraction: s.lossFraction, inverterKw: s.inverterKw },
          months,
          timezoneOffsetMinutes: 330,
        },
        { requestId: ctx.requestId },
      )
      .then((r) => r.days.sort((a, b) => a.month - b.month).map((d) => d.pvKw));
    ctx.profiles.set(key, p);
  }
  return p;
}

async function pvByMonth(ctx: YearContext, systems: PvSystemSpec[]): Promise<number[][]> {
  const each = await Promise.all(systems.map((s) => pvProfile(ctx, s)));
  return Array.from({ length: 12 }, (_, m) => Array.from({ length: 24 }, (_, h) => round(sum(each.map((e) => e[m]![h]!)), 5)));
}

/** Run an async job for each item, `width` at a time. */
async function inBatches<T, R>(items: T[], width: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += width) out.push(...(await Promise.all(items.slice(i, i + width).map(f))));
  return out;
}

export async function simulateYear(ctx: YearContext, cfg: Config): Promise<AnnualResult> {
  const pv = cfg.solar.length > 0 ? await pvByMonth(ctx, cfg.solar) : null;
  const hasEquipment = pv !== null || cfg.battery !== null;

  interface Day {
    month: number;
    weekend: boolean;
    count: number;
    load: number[];
    price: ReturnType<typeof priceSeries>;
    pv: number[];
  }
  const days: Day[] = [];
  for (const md of ctx.days) {
    const f = ctx.load.monthFactor[md.month - 1]!;
    const wd = ctx.load.weekday.map((v) => v * f);
    const we = ctx.load.weekend.map((v) => v * f);
    const monthlyKwh = md.weekdays * sum(wd) + md.weekends * sum(we);
    const price = priceSeries(cfg.tariff, LOCAL_MIDNIGHT, 24, monthlyKwh);
    const pvDay = pv ? pv[md.month - 1]! : new Array<number>(24).fill(0);
    if (md.weekdays > 0) days.push({ month: md.month, weekend: false, count: md.weekdays, load: wd, price, pv: pvDay });
    if (md.weekends > 0) days.push({ month: md.month, weekend: true, count: md.weekends, load: we, price, pv: pvDay });
  }

  interface DayOut {
    day: Day;
    net: number;
    uncontrolled: number;
    gridOnly: number;
    imp: number;
    exp: number;
    load: number;
    pv: number;
    pvUsed: number;
    cycles: number;
  }
  const outs = await inBatches(days, 6, async (d): Promise<DayOut> => {
    const gridOnly = sum(d.load.map((l, h) => l * d.price.importPrice[h]!));
    if (!hasEquipment) return { day: d, net: gridOnly, uncontrolled: gridOnly, gridOnly, imp: sum(d.load), exp: 0, load: sum(d.load), pv: 0, pvUsed: 0, cycles: 0 };
    const req: OptimiseRequest = { stepHours: 1, loadKw: d.load, pvKw: d.pv, importPrice: d.price.importPrice, exportPrice: d.price.exportPrice, battery: cfg.battery, mode: "SAVE_MONEY" };
    const r: OptimiseResponse = await ctx.engine.optimise(req, { requestId: ctx.requestId });
    if (r.solver.status !== "optimal" || !r.totals || !r.baseline || !r.validation.valid) {
      throw new AppError("PLAN_INVALID", `A typical day (month ${d.month}, ${d.weekend ? "weekend" : "weekday"}) failed the planner's check, so no yearly estimate is shown.`, { solver: r.solver, problems: r.validation.problems.slice(0, 5) });
    }
    return { day: d, net: r.totals.netCostInr, uncontrolled: r.baseline.netCostInr, gridOnly, imp: r.totals.importKwh, exp: r.totals.exportKwh, load: r.totals.loadKwh, pv: r.totals.pvKwh, pvUsed: r.totals.pvUsedKwh, cycles: r.totals.batteryCycles };
  });

  const months: MonthResult[] = ctx.days.map((md) => ({ month: md.month, days: md.weekdays + md.weekends, netCostInr: 0, importKwh: 0, exportKwh: 0, pvKwh: 0, loadKwh: 0 }));
  const t = { net: 0, uncontrolled: 0, gridOnly: 0, imp: 0, exp: 0, load: 0, pv: 0, pvUsed: 0, cycles: 0 };
  for (const o of outs) {
    const w = o.day.count;
    const m = months[o.day.month - 1]!;
    m.netCostInr += o.net * w;
    m.importKwh += o.imp * w;
    m.exportKwh += o.exp * w;
    m.pvKwh += o.pv * w;
    m.loadKwh += o.load * w;
    t.net += o.net * w;
    t.uncontrolled += o.uncontrolled * w;
    t.gridOnly += o.gridOnly * w;
    t.imp += o.imp * w;
    t.exp += o.exp * w;
    t.load += o.load * w;
    t.pv += o.pv * w;
    t.pvUsed += o.pvUsed * w;
    t.cycles += o.cycles * w;
  }
  return {
    gridOnlyCostInr: round(t.gridOnly, 2),
    uncontrolledCostInr: round(t.uncontrolled, 2),
    netCostInr: round(t.net, 2),
    importKwh: round(t.imp, 1),
    exportKwh: round(t.exp, 1),
    loadKwh: round(t.load, 1),
    pvKwh: round(t.pv, 1),
    pvUsedKwh: round(t.pvUsed, 1),
    selfConsumptionRatio: t.pv > 0 ? round(t.pvUsed / t.pv, 4) : null,
    selfSufficiencyRatio: t.load > 0 ? round(Math.max(0, 1 - t.imp / t.load), 4) : null,
    batteryCycles: round(t.cycles, 1),
    months: months.map((m) => ({ ...m, netCostInr: round(m.netCostInr, 2), importKwh: round(m.importKwh, 1), exportKwh: round(m.exportKwh, 1), pvKwh: round(m.pvKwh, 1), loadKwh: round(m.loadKwh, 1) })),
  };
}

