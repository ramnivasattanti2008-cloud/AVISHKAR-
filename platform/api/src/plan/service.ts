import { DEFAULTS } from "../assets/defaults.js";
import { toBatteryDto, toEvDto } from "../assets/service.js";
import type { Db } from "../db.js";
import { requireEngine } from "../engine/index.js";
import type { OptimiseRequest, OptimiseResponse } from "../engine/schemas.js";
import { AppError } from "../errors.js";
import type { Appliance, Battery, Ev, Prisma } from "../generated/prisma/client.js";
import { latestDna } from "../energy/service.js";
import { type ForecastDeps, loadForecast, solarForecast } from "../forecast/service.js";
import { simulated } from "../provenance/index.js";
import { getProperty } from "../properties/service.js";
import { getTariff, type TariffPlanDto } from "../tariff/service.js";
import { HOUR_MS, departureStep, istIso, local, planStart, resample, windowInHorizon } from "./horizon.js";
import type { PlanDto, PlanRequest } from "./schemas.js";

interface Ctx {
  requestId?: string;
}

const round = (v: number, d = 4): number => Math.round(v * 10 ** d) / 10 ** d;
const iso = (ms: number): string => new Date(ms).toISOString();

// ---------------------------------------------------------------------------------- prices

/** The slab a month of this size ends in: the price of the next unit, which is what shifting a kWh changes. */
export function marginalSlabRate(slabs: { upToKwhPerMonth: number | null; rate: number }[], monthlyKwh: number): number {
  for (const s of slabs) if (s.upToKwhPerMonth === null || monthlyKwh <= s.upToKwhPerMonth) return s.rate;
  return slabs[slabs.length - 1]!.rate;
}

/** Import and export price per step. Export is capped at the import price (a tariff that paid more than it charged would make the plan import to export). */
export function priceSeries(tariff: Pick<TariffPlanDto, "hourlyRates" | "slabs" | "export">, startMs: number, steps: number, monthlyKwh: number | null) {
  const notes: string[] = [];
  let flat: number | null = null;
  if (tariff.slabs) {
    if (monthlyKwh === null) throw new AppError("PLAN_INPUTS_MISSING", "This tariff is priced in slabs, so the price of the next kWh depends on your monthly use. Import meter data first.");
    flat = marginalSlabRate(tariff.slabs, monthlyKwh);
    notes.push(`The tariff is priced in slabs: the plan uses the rate of the slab your usage of about ${Math.round(monthlyKwh)} kWh a month falls in (INR ${flat} per kWh), the price of the next unit.`);
  }
  const importPrice = Array.from({ length: steps }, (_, i) => flat ?? tariff.hourlyRates[local(startMs + i * HOUR_MS).hour]!);
  const rate = tariff.export.rate ?? 0;
  if (tariff.export.rate === null) notes.push("The tariff has no export rate, so exported energy is valued at nothing.");
  let clamped = 0;
  const exportPrice = importPrice.map((p) => {
    if (rate > p) clamped++;
    return Math.min(rate, p);
  });
  if (clamped > 0) notes.push(`The export rate (INR ${rate}) is above the import price in ${clamped} hour(s); it was capped at the import price there.`);
  return { importPrice, exportPrice, notes };
}

/** Where the credit for exported energy comes from, in a sentence: the plan and the yearly estimate both lean on it. */
export function exportBasisNote(tariff: Pick<TariffPlanDto, "export">): string {
  const { rate, basis } = tariff.export;
  if (rate === null) return "The tariff has no export rate, so energy sent to the grid earns nothing.";
  if (basis === "ASSUMPTION") return `Energy sent to the grid is credited at INR ${rate} per kWh, an assumption: the tariff's source states no export rate. Net metering and net billing rules for your utility are not modelled.`;
  return `Energy sent to the grid is credited at INR ${rate} per kWh (${basis === "USER_ENTERED" ? "entered by you" : "from the tariff's source"}). Net metering and net billing rules for your utility are not modelled.`;
}

// ------------------------------------------------------------------------------------ assets

interface BatteryPlan {
  input: NonNullable<OptimiseRequest["battery"]>;
  usableKwh: number;
  capacityKwh: number;
  startBasis: "USER_ENTERED" | "ASSUMPTION";
  notes: string[];
}

/** One battery standing for the property's installed ones, which the optimiser sees as a single store. Pure. */
export function aggregateBatteries(rows: Battery[], now: Date, startSocPercent: number | null | undefined): BatteryPlan | null {
  const installed = rows.filter((b) => b.status === "EXISTING");
  if (installed.length === 0) return null;
  const dtos = installed.map(toBatteryDto);
  const cap = installed.reduce((a, b) => a + b.capacityKwh, 0);
  const wavg = (f: (i: number) => number) => installed.reduce((a, b, i) => a + f(i) * b.capacityKwh, 0) / cap;
  const minKwh = installed.reduce((a, b, i) => a + (dtos[i]!.effective.minSoc.value ?? 0) * b.capacityKwh, 0);
  const maxKwh = installed.reduce((a, b, i) => a + (dtos[i]!.effective.maxSoc.value ?? 1) * b.capacityKwh, 0);
  const reserves = installed.map((b) => b.reserveSoc);
  const reserveKwh = reserves.some((r) => r !== null) ? installed.reduce((a, b) => a + (b.reserveSoc ?? 0) * b.capacityKwh, 0) : null;
  const reserve = reserveKwh === null ? null : Math.min(maxKwh, Math.max(minKwh, reserveKwh));
  const notes: string[] = [];
  if (installed.length > 1) notes.push(`${installed.length} batteries are planned as one store with their capacities and power limits added.`);
  if (dtos.some((d) => d.effective.chargeEfficiency.basis === "ASSUMPTION" || d.effective.minSoc.basis === "ASSUMPTION" || d.effective.wearInrPerKwh.basis === "ASSUMPTION")) {
    notes.push("Battery efficiency, usable range and wear cost use the documented defaults where you did not enter them.");
  }

  let initial: number;
  let basis: BatteryPlan["startBasis"];
  const fresh = installed.every((b) => b.currentSoc !== null && b.currentSocAt !== null && now.getTime() - b.currentSocAt.getTime() <= 24 * HOUR_MS);
  if (startSocPercent !== null && startSocPercent !== undefined) {
    initial = (startSocPercent / 100) * cap;
    basis = "USER_ENTERED";
  } else if (fresh) {
    initial = installed.reduce((a, b) => a + b.currentSoc! * b.capacityKwh, 0);
    basis = "USER_ENTERED";
    notes.push("The starting charge is the level you last entered (within the day).");
  } else {
    initial = reserve ?? minKwh;
    basis = "ASSUMPTION";
    notes.push(`The battery's charge now is not known, so the plan assumes it starts at its ${reserve === null ? "minimum" : "reserve"} level (${round(initial, 2)} kWh). Enter the charge for a plan that fits tonight.`);
  }
  const clamped = Math.min(maxKwh, Math.max(minKwh, initial));
  if (Math.abs(clamped - initial) > 1e-9) notes.push("The starting charge was outside the battery's usable range and was moved to its edge.");
  return {
    input: {
      capacityKwh: cap,
      maxChargeKw: installed.reduce((a, b) => a + b.maxChargeKw, 0),
      maxDischargeKw: installed.reduce((a, b) => a + b.maxDischargeKw, 0),
      chargeEfficiency: round(wavg((i) => dtos[i]!.effective.chargeEfficiency.value ?? DEFAULTS.battery.oneWayEfficiency.value), 6),
      dischargeEfficiency: round(wavg((i) => dtos[i]!.effective.dischargeEfficiency.value ?? DEFAULTS.battery.oneWayEfficiency.value), 6),
      minSocKwh: round(minKwh, 6),
      maxSocKwh: round(maxKwh, 6),
      reserveSocKwh: reserve === null ? null : round(reserve, 6),
      initialSocKwh: round(clamped, 6),
      terminalSocKwh: round(clamped, 6),
      wearInrPerKwh: round(wavg((i) => dtos[i]!.effective.wearInrPerKwh.value ?? DEFAULTS.battery.wearInrPerKwh.value), 4),
    },
    usableKwh: round(maxKwh - minKwh, 3),
    capacityKwh: cap,
    startBasis: basis,
    notes,
  };
}

/** The first vehicle that needs charging before it departs. Others, and a vehicle with no known charge, are left out and the notes say so. */
export function evPlan(rows: Ev[], startMs: number, steps: number): { input: NonNullable<OptimiseRequest["ev"]>; energyNeededKwh: number; departure: number; notes: string[] } | { input: null; notes: string[] } {
  const notes: string[] = [];
  if (rows.length === 0) return { input: null, notes };
  if (rows.length > 1) notes.push(`Only the first of your ${rows.length} vehicles is planned (${rows[0]!.name}).`);
  const ev = rows[0]!;
  if (ev.currentSoc === null) return { input: null, notes: [...notes, `${ev.name} is not scheduled: its current charge is not entered, so the energy it needs is unknown.`] };
  const need = Math.max(0, (ev.targetSoc - ev.currentSoc) * ev.batteryKwh);
  if (need <= 0) return { input: null, notes: [...notes, `${ev.name} is already at its target charge, so nothing is scheduled.`] };
  const dep = departureStep(ev.departureTime, ev.departureDays, startMs, steps);
  if (!dep || dep.step < 1) return { input: null, notes: [...notes, `${ev.name} is not scheduled: it departs within the first hour or on no day within the next week.`] };
  if (dep.beyondHorizon) notes.push(`${ev.name} departs after this plan ends, so its charge is completed within the plan's hours.`);
  notes.push(`${ev.name} is assumed to be plugged in from the start of the plan.`);
  const dto = toEvDto(ev);
  return {
    input: { energyNeededKwh: round(need, 3), chargerKw: ev.chargerKw, chargerEfficiency: dto.effective.chargerEfficiency.value as number, availableFromStep: 0, departureStep: dep.step },
    energyNeededKwh: round(need, 3),
    departure: startMs + dep.step * HOUR_MS,
    notes,
  };
}

/** Flexible appliances with a window and a duration, placed in the horizon. Anything that cannot be placed is named with the reason. */
export function appliancePlan(rows: Appliance[], startMs: number, steps: number): { input: NonNullable<OptimiseRequest["appliances"]>; notes: string[]; criticalKw: number } {
  const notes: string[] = [];
  const input: NonNullable<OptimiseRequest["appliances"]> = [];
  const criticalKw = round(rows.filter((a) => a.priority === "CRITICAL").reduce((s, a) => s + (a.ratedPowerW * a.quantity) / 1000, 0), 4);
  for (const a of rows) {
    if (a.priority !== "FLEXIBLE" || !a.earliestStart || !a.latestFinish || !a.durationMin) continue;
    const w = windowInHorizon(a.earliestStart, a.latestFinish, startMs, steps);
    const duration = Math.ceil(a.durationMin / 60);
    if (!w) {
      notes.push(`${a.name} is not scheduled: its window (${a.earliestStart} to ${a.latestFinish}) has no whole hour inside the plan.`);
      continue;
    }
    if (duration > w.endStep - w.startStep) {
      notes.push(`${a.name} is not scheduled: it needs ${duration} h but only ${w.endStep - w.startStep} h of its window fall inside the plan.`);
      continue;
    }
    if (input.length >= 20) {
      notes.push(`${a.name} is not scheduled: a plan places at most 20 appliances.`);
      continue;
    }
    input.push({ id: a.id, name: a.name, powerKw: round((a.ratedPowerW * a.quantity) / 1000, 4), durationSteps: duration, earliestStartStep: w.startStep, latestFinishStep: w.endStep, interruptible: a.interruptible });
  }
  if (input.some((x) => rows.find((a) => a.id === x.id)!.durationMin! % 60 !== 0)) notes.push("Run times are rounded up to whole hours.");
  return { input, notes, criticalKw };
}

// ---------------------------------------------------------------------------------- inputs

interface LoadForPlan {
  kw: number[];
  basis: "FORECAST" | "TYPICAL_DAY";
  note: string;
  monthlyKwh: number | null;
}

/**
 * The load for each step: the model's forecast when the meter data is current enough to reach the plan, otherwise the property's
 * own typical day (its Energy DNA) for that day of the week, which is said plainly. Null when neither exists.
 */
async function planLoad(deps: ForecastDeps, userId: string, propertyId: string, startMs: number, steps: number, ctx: Ctx): Promise<LoadForPlan | null> {
  const last = await deps.db.energyObservation.findFirst({ where: { propertyId }, orderBy: { ts: "desc" }, select: { ts: true, intervalMinutes: true } });
  let why = "There are no meter readings yet.";
  if (last) {
    const approxEnd = last.ts.getTime() + last.intervalMinutes * 60_000;
    const gap = Math.max(0, Math.ceil((startMs - approxEnd) / HOUR_MS));
    if (gap + steps <= 168) {
      const f = await loadForecast(deps, userId, propertyId, { hours: gap + steps, requestId: ctx.requestId });
      if (f.hours.value && f.hours.provenance.status === "FORECAST") {
        const resampled = resample(f.hours.value.map((h) => ({ time: h.time, value: h.p50Kw })), "start", startMs, steps);
        if (resampled.every((v): v is number => v !== null)) {
          const kw = resampled.map((v) => round(v, 4));
          return { kw, basis: "FORECAST", note: `The load forecast from your meter readings (method: ${f.model?.selectedMethod ?? "unknown"}).`, monthlyKwh: round((kw.reduce((a, b) => a + b, 0) / steps) * 730, 1) };
        }
        why = "The load forecast did not reach all the hours of the plan.";
      } else why = f.hours.provenance.notes[0] ?? "A load forecast could not be made.";
    } else why = "Your meter data ends too long ago to forecast the coming hours.";
  }
  const dna = await latestDna(deps.db, propertyId);
  if (!dna) return null;
  const p = dna.patterns as { hourly: number[]; weekdayHourly: number[] | null; weekendHourly: number[] | null };
  const kw = Array.from({ length: steps }, (_, i) => {
    const l = local(startMs + i * HOUR_MS);
    const day = l.weekday >= 5 ? (p.weekendHourly ?? p.hourly) : (p.weekdayHourly ?? p.hourly);
    return round(day[l.hour]!, 4);
  });
  return {
    kw,
    basis: "TYPICAL_DAY",
    note: `${why} The load is your typical day from your Energy DNA (${dna.completeDays} complete days), for each day of the week: a pattern, not a forecast.`,
    monthlyKwh: round(dna.meanDailyKwh * 30.4, 1),
  };
}

// ------------------------------------------------------------------------------------ plan

/**
 * The two costs to the paisa, and the saving as the difference of those two, so that what is shown always adds up: rounding the
 * saving on its own can differ from the difference of the rounded costs by a paisa. The database refuses a row that does not add up.
 */
export function costsShown(net: number, baseline: number): { netCostInr: number; baselineNetCostInr: number; savingsInr: number } {
  const netCostInr = round(net, 2);
  const baselineNetCostInr = round(baseline, 2);
  return { netCostInr, baselineNetCostInr, savingsInr: round(baselineNetCostInr - netCostInr, 2) };
}

/**
 * Everything a plan needs, gathered and checked: the property, its tariff, the load, the sun, the equipment, and the optimiser's
 * request built from them. Shared by the plan itself and by the what-if scenarios that re-plan on a changed sky (cloud front).
 */
export async function buildPlanInputs(deps: ForecastDeps, userId: string, propertyId: string, req: PlanRequest, ctx: Ctx = {}) {
  const { db, now } = deps;
  const at = now();
  const property = await getProperty(db, userId, propertyId, deps.policy);
  const startMs = planStart(at);
  const steps = req.hours;
  const where = { latitude: property.latitude, longitude: property.longitude };

  const row = await db.property.findUniqueOrThrow({ where: { id: propertyId }, select: { tariffPlanId: true } });
  const missing: { what: string; why: string }[] = [];
  const tariff = row.tariffPlanId ? await getTariff(db, userId, row.tariffPlanId, at) : null;
  if (!tariff) missing.push({ what: "tariff", why: "Choose the tariff you pay on the Tariff tab: the plan optimises against its prices." });
  const load = await planLoad(deps, userId, propertyId, startMs, steps, ctx);
  if (!load) missing.push({ what: "load", why: "Import at least a week of meter readings on the Meter data tab: the plan needs to know when you use electricity." });
  if (missing.length > 0 || !tariff || !load) {
    throw new AppError("PLAN_INPUTS_MISSING", `A plan cannot be made yet: ${missing.map((m) => m.why).join(" ")}`, { missing });
  }

  const assumptions: string[] = [];
  const prices = priceSeries(tariff, startMs, steps, load.monthlyKwh);
  assumptions.push(...prices.notes);
  assumptions.push("Fixed monthly charges, duties and taxes are the same whatever the plan does, so they are not part of the figures.");
  if (tariff.validity.status === "EXPIRED" || tariff.validity.status === "UNKNOWN") assumptions.push(`Tariff: ${tariff.validity.message}`);

  // solar: the forecast's central estimate; hours the forecast does not reach are taken as no sun
  const solar = await solarForecast(deps, userId, propertyId, { days: 3, requestId: ctx.requestId });
  let pv: number[] = new Array<number>(steps).fill(0);
  let solarNote = solar.hours.value ? "The solar forecast's central estimate, resampled to local hours." : "No solar system is entered, so the plan covers the grid and the battery only.";
  if (solar.hours.value) {
    const r = resample(solar.hours.value.map((h) => ({ time: h.time, value: h.p50Kw })), "end", startMs, steps);
    const unknown = r.filter((v) => v === null).length;
    pv = r.map((v) => round(v ?? 0, 4));
    if (unknown > 0) solarNote += ` The forecast does not reach the last ${unknown} hour(s); no sun is assumed there.`;
    assumptions.push("Solar output is the forecast's central estimate. The provider's hours are half an hour off the local clock, so each local hour averages the two it overlaps.");
    assumptions.push(exportBasisNote(tariff));
  }

  const [batteryRows, evRows, applianceRows] = await Promise.all([db.battery.findMany({ where: { propertyId }, orderBy: { createdAt: "asc" } }), db.ev.findMany({ where: { propertyId }, orderBy: { createdAt: "asc" } }), db.appliance.findMany({ where: { propertyId }, orderBy: { createdAt: "asc" } })]);
  const battery = aggregateBatteries(batteryRows, at, req.startSocPercent);
  if (battery) assumptions.push(...battery.notes);
  else assumptions.push(batteryRows.length > 0 ? "A planned battery is not part of this plan: only installed equipment is." : "No battery is entered: the plan shifts flexible loads and uses solar directly, but cannot store energy.");
  const ev = evPlan(evRows, startMs, steps);
  assumptions.push(...ev.notes);
  const apps = appliancePlan(applianceRows, startMs, steps);
  assumptions.push(...apps.notes);
  assumptions.push("No outage information is available, so none is planned for; the battery reserve you set is held back.");
  const backupHours = req.mode === "RESILIENCE" ? 3 : 0;
  if (backupHours > 0) assumptions.push("Resilience mode keeps 3 hours of your critical load in the battery: an assumption, since you have not set a backup time.");
  if (req.mode === "GREEN") assumptions.push("No grid carbon figures are loaded, so Green mode favours using your own solar and avoiding imports rather than weighing carbon by hour.");

  const request: OptimiseRequest = {
    stepHours: 1,
    startTime: istIso(startMs), // local clock with its offset, so the engine's reasons say "at 23:00" in the time the person lives by
    loadKw: load.kw,
    pvKw: pv,
    importPrice: prices.importPrice,
    exportPrice: prices.exportPrice,
    battery: battery?.input ?? null,
    criticalKw: apps.criticalKw,
    backupHours,
    ev: ev.input ?? null,
    appliances: apps.input,
    mode: req.mode,
  };

  return { at, property, startMs, steps, where, tariff, load, prices, solar, solarNote, pv, battery, ev, apps, assumptions, request };
}

export async function createPlan(deps: ForecastDeps, userId: string, propertyId: string, req: PlanRequest, ctx: Ctx = {}): Promise<PlanDto> {
  const { db } = deps;
  const engine = requireEngine(deps.engine);
  const { at, startMs, steps, where, tariff, load, prices, solar, solarNote, pv, battery, ev, apps, assumptions, request } = await buildPlanInputs(deps, userId, propertyId, req, ctx);

  const out: OptimiseResponse = await engine.optimise(request, { requestId: ctx.requestId });

  if (out.solver.status !== "optimal" || !out.schedule || !out.totals || !out.baseline) {
    throw new AppError("PLAN_INVALID", `The planner found no usable plan (${out.solver.status}): ${out.solver.message}`, { solver: out.solver });
  }
  if (!out.validation.valid) {
    throw new AppError("PLAN_INVALID", "SIMULATION INVALID: the plan failed the planner's independent check, so it is not shown as a plan.", { problems: out.validation.problems.slice(0, 10) });
  }

  const times = Array.from({ length: steps }, (_, i) => iso(startMs + i * HOUR_MS));
  const sch = out.schedule;
  const { netCostInr: netR, baselineNetCostInr: baseR, savingsInr: savings } = costsShown(out.totals.netCostInr, out.baseline.netCostInr);
  const version = (await engine.health({ requestId: ctx.requestId })).version;
  const src = { provider: "avishkar-engine", source: "AVISHKAR planner (linear programme, HiGHS) on forecast inputs", dataType: "energy_plan_outcome", location: where, now: at, modelVersion: `engine-${version}` };

  const dto: PlanDto = {
    id: "00000000-0000-0000-0000-000000000000",
    propertyId,
    createdAt: at.toISOString(),
    mode: out.mode,
    modeWeights: out.modeWeights,
    horizon: { start: iso(startMs), stepHours: 1, steps },
    schedule: {
      times,
      loadKw: load.kw,
      pvForecastKw: pv,
      pvUsedKw: sch.pvUsedKw,
      pvCurtailedKw: sch.pvCurtailedKw,
      gridImportKw: sch.gridImportKw,
      gridExportKw: sch.gridExportKw,
      batteryChargeKw: sch.batteryChargeKw,
      batteryDischargeKw: sch.batteryDischargeKw,
      batterySocKwh: sch.batterySocKwh,
      evChargeKw: sch.evChargeKw,
      applianceKw: sch.applianceKw,
      importPrice: prices.importPrice,
      exportPrice: prices.exportPrice,
    },
    result: simulated(
      {
        netCostInr: netR,
        baselineNetCostInr: baseR,
        savingsInr: savings,
        importKwh: out.totals.importKwh,
        exportKwh: out.totals.exportKwh,
        loadKwh: out.totals.loadKwh,
        pvKwh: out.totals.pvKwh,
        pvUsedKwh: out.totals.pvUsedKwh,
        curtailedKwh: out.totals.curtailedKwh,
        batteryCycles: out.totals.batteryCycles,
        unservedKwh: out.totals.unservedKwh,
        evShortfallKwh: out.totals.evShortfallKwh,
        selfConsumptionRatio: out.totals.selfConsumptionRatio,
        selfSufficiencyRatio: out.totals.selfSufficiencyRatio,
      },
      { ...src, unit: "INR", notes: [`Baseline: ${out.baseline.description}`, "An outcome of the plan on forecast inputs, not a measurement; the real day will differ."] },
    ),
    appliances: out.appliances.map((a) => ({ id: a.id, name: a.name, startTime: a.startStep === null ? null : iso(startMs + a.startStep * HOUR_MS), runHours: a.runSteps.length, energyKwh: a.energyKwh })),
    decisions: out.decisions.map((d) => ({ time: iso(startMs + d.step * HOUR_MS), kind: d.kind, kwh: d.kwh, reason: d.reason })),
    inputs: {
      tariff: { id: tariff.id, name: tariff.name, validity: tariff.validity.status, exportRate: tariff.export.rate, exportBasis: tariff.export.basis },
      load: { basis: load.basis, note: load.note },
      solar: { systems: solar.systems.length, note: solarNote },
      battery: battery
        ? { capacityKwh: battery.capacityKwh, usableKwh: battery.usableKwh, maxChargeKw: battery.input.maxChargeKw, maxDischargeKw: battery.input.maxDischargeKw, startSocKwh: battery.input.initialSocKwh, startSocBasis: battery.startBasis, reserveKwh: battery.input.reserveSocKwh ?? null }
        : null,
      ev: ev.input ? { energyNeededKwh: ev.energyNeededKwh, departure: iso(ev.departure) } : null,
      criticalKw: apps.criticalKw,
    },
    assumptions: [...new Set(assumptions)],
    solver: { status: out.solver.status, seconds: out.solver.seconds, integerVariables: out.solver.integerVariables },
    validation: out.validation,
    notes: out.notes,
  };

  const saved = await db.optimizationRun.create({
    data: {
      propertyId,
      createdAt: at,
      mode: out.mode,
      startsAt: new Date(startMs),
      stepHours: 1,
      steps,
      netCostInr: netR,
      baselineNetCostInr: baseR,
      savingsInr: savings,
      engineVersion: version,
      plan: dto as unknown as Prisma.InputJsonValue,
    },
  });
  return { ...dto, id: saved.id };
}

/** Plans of a property, newest first, without their schedules. */
export async function listPlans(db: Db, userId: string, propertyId: string, limit = 30) {
  await requireOwner(db, userId, propertyId);
  const rows = await db.optimizationRun.findMany({ where: { propertyId }, orderBy: { createdAt: "desc" }, take: Math.min(limit, 100) });
  return rows.map((r) => ({ id: r.id, createdAt: r.createdAt.toISOString(), mode: r.mode, startsAt: r.startsAt.toISOString(), steps: r.steps, netCostInr: r.netCostInr, baselineNetCostInr: r.baselineNetCostInr, savingsInr: r.savingsInr }));
}

/** One stored plan exactly as it was shown, or the latest when no id is given. */
export async function getPlan(db: Db, userId: string, propertyId: string, id?: string): Promise<PlanDto> {
  await requireOwner(db, userId, propertyId);
  const r = id ? await db.optimizationRun.findFirst({ where: { id, propertyId } }) : await db.optimizationRun.findFirst({ where: { propertyId }, orderBy: { createdAt: "desc" } });
  if (!r) throw new AppError("NOT_FOUND", id ? "No such plan." : "No plan has been made for this property yet.");
  return { ...(r.plan as unknown as PlanDto), id: r.id };
}

async function requireOwner(db: Db, userId: string, propertyId: string): Promise<void> {
  const p = await db.property.findFirst({ where: { id: propertyId, ownerId: userId, deletedAt: null }, select: { id: true } });
  if (!p) throw new AppError("NOT_FOUND", "No such property.");
}
