/**
 * A virtual power plant simulation (spec section 48) and a community view of the owner's own properties (section 47).
 *
 * The VPP is synthetic from first to last: N homes drawn from distributions the person controls, each a variation of one real
 * property's own load pattern, with solar scaled from the sun at its place. Nothing here is a measurement, and the response is
 * labelled SIMULATED with every assumption listed. The fleet is dispatched by the same optimiser as a single home, as one
 * aggregate battery, one aggregate of shiftable demand and one of vehicle charging, to see what coordination does to the evening
 * peak and to the use of solar.
 */
import { z } from "zod";
import { DEFAULTS } from "../assets/defaults.js";
import { latestDna } from "../energy/service.js";
import { requireEngine } from "../engine/index.js";
import type { OptimiseRequest } from "../engine/schemas.js";
import { AppError } from "../errors.js";
import type { ForecastDeps } from "../forecast/service.js";
import { priceSeries } from "../plan/service.js";
import { getProperty } from "../properties/service.js";
import { simulated } from "../provenance/index.js";
import { loadModel } from "../scenarios/service.js";
import { getTariff } from "../tariff/service.js";
import { type HomeParams, drawFleet } from "./sample.js";

export const HOME_COUNTS = [10, 100, 1000, 10_000] as const;

export const VppRequest = z
  .object({
    archetypePropertyId: z.uuid().describe("One of your properties, whose own daily pattern, tariff and place every simulated home is a variation of."),
    homes: z.union([z.literal(10), z.literal(100), z.literal(1000), z.literal(10_000)]),
    pvSharePercent: z.number().min(0).max(100).default(30).describe("Share of homes with solar. An assumption, not data: change it."),
    pvKwpMean: z.number().positive().max(100).default(3).describe("Mean size of a home's solar, kWp."),
    pvKwpCv: z.number().min(0).max(2).default(0.3).describe("Spread of those sizes (coefficient of variation)."),
    batterySharePercent: z.number().min(0).max(100).default(10).describe("Share of the homes with solar that also have a battery."),
    batteryKwhMean: z.number().positive().max(200).default(5),
    evSharePercent: z.number().min(0).max(100).default(5).describe("Share of homes with an electric vehicle."),
    evKwhPerDay: z.number().positive().max(100).default(8).describe("Energy a vehicle takes from the grid in a day."),
    evChargerKw: z.number().positive().max(50).default(3.3),
    flexibleSharePercent: z.number().min(0).max(60).default(15).describe("Share of each home's load that can be moved within the day."),
    loadCv: z.number().min(0).max(1.5).default(0.35).describe("How much homes differ in how much they use."),
    month: z.number().int().min(1).max(12).optional().describe("Month of the typical day. Default: this month."),
    dayType: z.enum(["weekday", "weekend"]).default("weekday"),
    seed: z.number().int().min(0).max(2_147_483_647).default(1).describe("The same seed describes the same homes."),
  })
  .meta({ id: "VppRequest" });
export type VppRequest = z.infer<typeof VppRequest>;
export type VppRequestInput = z.input<typeof VppRequest>;

const LOCAL_MIDNIGHT = Date.UTC(2026, 0, 1) - 330 * 60_000;
const round = (v: number, d = 1): number => Math.round(v * 10 ** d) / 10 ** d;
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const EV_FROM = 18;
const EV_EFFICIENCY = DEFAULTS.ev.chargerEfficiency.value;
const MAX_APPLIANCE_KW = 1000;
const MAX_APPLIANCES = 20;

/**
 * Shiftable energy as appliances the engine accepts (at most 1,000 kW each). Its power cap is never below the most the uncoordinated
 * day draws in one hour, so the uncoordinated day is one of the schedules the planner may choose: coordination can then only help.
 */
function shiftable(id: string, name: string, energyKwh: number, from: number, to: number, naturalMaxKw: number): NonNullable<OptimiseRequest["appliances"]> {
  if (energyKwh <= 1e-9 || naturalMaxKw <= 1e-9) return [];
  const duration = Math.min(to - from, Math.max(1, Math.floor(energyKwh / naturalMaxKw)));
  const count = Math.min(MAX_APPLIANCES / 2, Math.max(1, Math.ceil(energyKwh / duration / MAX_APPLIANCE_KW)));
  const each = energyKwh / count;
  return Array.from({ length: count }, (_, i) => ({ id: `${id}-${i + 1}`, name: `${name} ${i + 1}`, powerKw: round(each / duration, 6), durationSteps: duration, earliestStartStep: from, latestFinishStep: to, interruptible: true }));
}

export async function simulateVpp(deps: ForecastDeps, userId: string, input: VppRequest, ctx: { requestId?: string } = {}) {
  const { db, now } = deps;
  const engine = requireEngine(deps.engine);
  const at = now();
  const property = await getProperty(db, userId, input.archetypePropertyId, deps.policy);
  const row = await db.property.findUniqueOrThrow({ where: { id: input.archetypePropertyId }, select: { tariffPlanId: true } });
  const dna = await latestDna(db, input.archetypePropertyId);
  const missing: { what: string; why: string }[] = [];
  const tariff = row.tariffPlanId ? await getTariff(db, userId, row.tariffPlanId, at) : null;
  if (!tariff) missing.push({ what: "tariff", why: "Choose a tariff on the property you use as the pattern: the fleet is dispatched against its prices." });
  if (!dna) missing.push({ what: "load", why: "Import meter readings for that property: every simulated home is a variation of its own daily pattern." });
  if (!tariff || !dna) throw new AppError("PLAN_INPUTS_MISSING", `A simulation cannot be run yet: ${missing.map((m) => m.why).join(" ")}`, { missing });
  const resource = await deps.providers.solarResource.climatology(property.latitude, property.longitude, { requestId: ctx.requestId, now });
  if (!resource.value) throw new AppError("PLAN_INPUTS_MISSING", "The solar resource for that place could not be read.", { missing: [{ what: "solar_resource", why: resource.provenance.notes[0] ?? "Unavailable." }] });

  const month = input.month ?? new Date(at.getTime() + 330 * 60_000).getUTCMonth() + 1;
  const climate = resource.value.months.find((m) => m.month === month);
  if (!climate || climate.ghiKwhM2Day === null) throw new AppError("PLAN_INPUTS_MISSING", "The solar resource has no value for that month.", { missing: [{ what: "solar_resource", why: `No irradiation for month ${month}.` }] });

  const load = loadModel(dna);
  const pattern = (input.dayType === "weekend" ? load.weekend : load.weekday).map((v) => v * load.monthFactor[month - 1]!);
  const params: HomeParams = { homes: input.homes, pvSharePercent: input.pvSharePercent, pvKwpMean: input.pvKwpMean, pvKwpCv: input.pvKwpCv, batterySharePercent: input.batterySharePercent, batteryKwhMean: input.batteryKwhMean, evSharePercent: input.evSharePercent, loadCv: input.loadCv, seed: input.seed };
  const fleet = drawFleet(params);

  // one kilowatt-peak of solar at that place, that month; the fleet's solar is that times its total kWp (output is linear in size)
  const tilt = Math.min(40, Math.max(5, Math.round(Math.abs(property.latitude))));
  const sun = await engine.solarTypicalDays(
    {
      location: { latitude: property.latitude, longitude: property.longitude, altitudeM: resource.value.elevationM ?? 0 },
      system: { capacityKwp: 1, tiltDeg: tilt, azimuthDeg: 180, lossFraction: DEFAULTS.solar.lossFraction.value },
      months: [{ month, ghiKwhM2Day: climate.ghiKwhM2Day, airTempC: climate.airTempC }],
      timezoneOffsetMinutes: 330,
    },
    { requestId: ctx.requestId },
  );
  const perKwp = sun.days[0]!.pvKw;
  const pv = perKwp.map((v) => round(v * fleet.pvKwp, 3));

  // aggregate load, the shiftable part of it, and vehicles
  const totalLoad = pattern.map((v) => v * fleet.loadScale);
  const flexKw = totalLoad.map((v) => (v * input.flexibleSharePercent) / 100);
  const flexKwh = sum(flexKw);
  const fixedLoad = totalLoad.map((v, h) => round(v - flexKw[h]!, 4));
  const evKwh = (fleet.withEv * input.evKwhPerDay) / EV_EFFICIENCY; // from the grid, losses included
  const evPower = (fleet.withEv * input.evChargerKw) / EV_EFFICIENCY;

  // no coordination: shiftable load stays where it is, vehicles charge as soon as they are plugged in at full power
  const evNatural = new Array<number>(24).fill(0);
  let remaining = evKwh;
  for (let h = EV_FROM; h < 24 && remaining > 1e-9; h++) {
    evNatural[h] = Math.min(evPower, remaining);
    remaining -= evNatural[h]!;
  }
  const evStrandedKwh = remaining; // charging that cannot finish before midnight even uncoordinated
  const demandBefore = totalLoad.map((v, h) => v + evNatural[h]!);
  const importBefore = demandBefore.map((d, h) => Math.max(0, d - pv[h]!));
  const exportBefore = demandBefore.map((d, h) => Math.max(0, pv[h]! - d));

  const prices = priceSeries(tariff, LOCAL_MIDNIGHT, 24, null);
  const costBefore = sum(importBefore.map((v, h) => v * prices.importPrice[h]!)) - sum(exportBefore.map((v, h) => v * prices.exportPrice[h]!));

  const batteryKwh = fleet.batteryKwh;
  const evPlannedKwh = Math.min(evKwh, evPower * (24 - EV_FROM));
  const appliances = [...shiftable("flex", "Shiftable demand", flexKwh, 0, 24, Math.max(...flexKw)), ...shiftable("ev", "Vehicle charging", evPlannedKwh, EV_FROM, 24, evPower)];
  const req: OptimiseRequest = {
    stepHours: 1,
    loadKw: fixedLoad,
    pvKw: pv,
    importPrice: prices.importPrice,
    exportPrice: prices.exportPrice,
    battery:
      batteryKwh > 0
        ? {
            capacityKwh: round(batteryKwh, 3),
            maxChargeKw: round(batteryKwh / 2, 3),
            maxDischargeKw: round(batteryKwh / 2, 3),
            chargeEfficiency: DEFAULTS.battery.oneWayEfficiency.value,
            dischargeEfficiency: DEFAULTS.battery.oneWayEfficiency.value,
            minSocKwh: round(batteryKwh * DEFAULTS.battery.minSoc.value, 4),
            maxSocKwh: round(batteryKwh, 3),
            initialSocKwh: round(batteryKwh * 0.55, 4),
            terminalSocKwh: round(batteryKwh * 0.55, 4),
            wearInrPerKwh: DEFAULTS.battery.wearInrPerKwh.value,
            cyclic: true,
          }
        : null,
    appliances,
    mode: "SAVE_MONEY",
  };
  const out = await engine.optimise(req, { requestId: ctx.requestId });
  if (out.solver.status !== "optimal" || !out.schedule || !out.totals || !out.validation.valid) {
    throw new AppError("PLAN_INVALID", "The fleet's dispatch failed the planner's check, so no result is shown.", { solver: out.solver, problems: out.validation.problems.slice(0, 5) });
  }
  const s = out.schedule;
  const importAfter = s.gridImportKw;
  const exportAfter = s.gridExportKw;
  const peak = (a: number[]) => a.reduce((m, v, h) => (v > m.kw ? { kw: v, hour: h } : m), { kw: 0, hour: 0 });
  const pb = peak(importBefore);
  const pa = peak(importAfter);
  const pvTotal = sum(pv);
  const loadTotal = sum(totalLoad) + evKwh;
  const costAfter = out.totals.netCostInr;
  const src = { provider: "avishkar-vpp", source: "AVISHKAR virtual power plant simulation: synthetic homes dispatched by the planner", dataType: "vpp_simulation", location: { latitude: property.latitude, longitude: property.longitude }, now: at };

  const assumptions = [
    "Every home is synthetic. Each is a draw from the shares and sizes you chose (the defaults are assumptions, not data), scaled from the daily pattern of your property.",
    `Solar is ${round(tilt, 0)} degrees tilted, facing south, with the default 14% losses, for the sun of ${property.name}'s place in the month chosen (NASA POWER's mean day).`,
    "The day is one typical " + input.dayType + " of that month: no cloudy days, no neighbouring days.",
    "Without coordination, shiftable demand stays where it is and vehicles charge at full power from 6 pm; with it, the fleet is dispatched as one aggregate battery, one aggregate of shiftable demand and one of vehicle charging for the lowest bill on your tariff.",
    `Batteries are ${DEFAULTS.battery.oneWayEfficiency.value.toFixed(3)} efficient each way with a 10% unusable range, and charge or discharge at up to half their capacity per hour.`,
    "Vehicles must finish charging before midnight in this model (they plug in at 6 pm); charging past midnight is not modelled.",
    "The grid is taken to accept any export at the tariff's export credit, with no export limit, and no network constraint (voltage, transformer limits) is modelled.",
    "This is a simulation of a fleet. AVISHKAR does not coordinate real homes, and nothing here is evidence that a utility or regulator would allow, pay for or enable such coordination.",
  ];
  if (evStrandedKwh > 1e-6) assumptions.push(`Even uncoordinated, ${round(evStrandedKwh)} kWh of vehicle charging could not finish before midnight at the charger power given; it is left out of both sides.`);
  const notes = [...out.notes];
  if (property.isDemo) notes.unshift("DEMO DATA: the pattern property is a demo property, so every figure here is built on invented readings and equipment.");

  return {
    label: "VIRTUAL POWER PLANT SIMULATION" as const,
    isDemo: property.isDemo,
    request: input,
    month,
    dayType: input.dayType,
    archetype: { propertyId: property.id, name: property.name, tariff: tariff.name },
    fleet: { homes: fleet.homes, withSolar: fleet.withPv, withBattery: fleet.withBattery, withVehicle: fleet.withEv, solarKwp: round(fleet.pvKwp, 1), batteryKwh: round(fleet.batteryKwh, 1), evChargerKw: round(fleet.withEv * input.evChargerKw, 1), shiftableKwhPerDay: round(flexKwh, 1) },
    result: simulated(
      {
        solarKwhPerDay: round(pvTotal, 1),
        loadKwhPerDay: round(loadTotal, 1),
        peakImportBeforeKw: round(pb.kw, 1),
        peakImportBeforeHour: pb.hour,
        peakImportAfterKw: round(pa.kw, 1),
        peakImportAfterHour: pa.hour,
        peakReductionPercent: pb.kw > 0 ? round(((pb.kw - pa.kw) / pb.kw) * 100, 1) : null,
        peakExportBeforeKw: round(Math.max(...exportBefore), 1),
        peakExportAfterKw: round(Math.max(...exportAfter), 1),
        importKwhBefore: round(sum(importBefore), 1),
        importKwhAfter: round(sum(importAfter), 1),
        solarUsedLocallyBefore: pvTotal > 0 ? round(1 - sum(exportBefore) / pvTotal, 4) : null,
        solarUsedLocallyAfter: pvTotal > 0 ? round(1 - sum(exportAfter) / pvTotal, 4) : null,
        solarCurtailedKwhAfter: round(out.totals.curtailedKwh, 1),
        selfSufficiencyBefore: loadTotal > 0 ? round(Math.max(0, 1 - sum(importBefore) / loadTotal), 4) : null,
        selfSufficiencyAfter: loadTotal > 0 ? round(Math.max(0, 1 - sum(importAfter) / loadTotal), 4) : null,
        costBeforeInr: round(costBefore, 0),
        costAfterInr: round(costAfter, 0),
        savingsInr: round(costBefore - costAfter, 0),
        batteryCycles: round(out.totals.batteryCycles, 2),
      },
      { ...src, notes: ["A simulation of synthetic homes, not a measurement of any real ones."] },
    ),
    hourly: {
      hours: Array.from({ length: 24 }, (_, h) => h),
      loadKw: demandBefore.map((v) => round(v, 1)),
      solarKw: pv.map((v) => round(v, 1)),
      importBeforeKw: importBefore.map((v) => round(v, 1)),
      importAfterKw: importAfter.map((v) => round(v, 1)),
      batteryKwh: s.batterySocKwh.map((v) => round(v, 1)),
    },
    assumptions,
    notes,
  };
}
