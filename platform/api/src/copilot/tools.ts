/**
 * The internal tool layer (spec sections 90 and 91): the only way the Copilot learns anything. Each tool calls the same backend
 * service a page uses and returns a compact, structured result; the Copilot never computes a tariff, a forecast, a saving or a
 * subsidy itself. A tool that cannot answer says why (UNAVAILABLE) instead of failing, and the answer carries that reason.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DEFAULTS } from "../assets/defaults.js";
import { toBatteryDto } from "../assets/service.js";
import { AppError } from "../errors.js";
import { findOpportunities } from "../opportunities/service.js";
import { type ForecastDeps, forecastAccuracy, loadForecast, solarForecast } from "../forecast/service.js";
import { createPlan, getPlan } from "../plan/service.js";
import { resilienceReport } from "../resilience/service.js";
import { PlanRequest } from "../plan/schemas.js";
import { evaluateEligibility } from "../policy/service.js";
import { getProperty } from "../properties/service.js";
import type { DataStatus } from "../provenance/index.js";
import { economics } from "../scenarios/economics.js";
import { ScenarioRequest } from "../scenarios/schemas.js";
import { getScenario, listScenarios, runScenario } from "../scenarios/service.js";
import { getTariff } from "../tariff/service.js";

export const TOOL_NAMES = [
  "getProperty",
  "getWeather",
  "getSatelliteObservations",
  "getSolarForecast",
  "getLoadForecast",
  "getBatteryState",
  "getTariff",
  "getEligibility",
  "getEnergyOpportunities",
  "runOptimization",
  "runSimulation",
  "calculateEconomics",
  "getResilience",
  "getCounterfactual",
  "getLatestPlan",
  "getForecastAccuracy",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export interface ToolContext {
  deps: ForecastDeps;
  userId: string;
  propertyId: string;
  requestId?: string;
}

export interface ToolResult {
  id: string;
  tool: ToolName;
  input: unknown;
  /** What the tool returned. Null when it could not answer. */
  output: unknown;
  status: "OK" | "UNAVAILABLE";
  unavailableReason: string | null;
  /** How the main figure is labelled where it has a label: FORECAST, ESTIMATED, SIMULATED, REFERENCE ... */
  dataStatus: DataStatus | null;
  calledAt: string;
}

interface ToolDef {
  description: string;
  /** Whether calling it stores something (a plan or a scenario). The Copilot only calls these when the person asked for that. */
  writes: boolean;
  input: z.ZodType;
  run(ctx: ToolContext, input: never): Promise<{ output: unknown; dataStatus?: DataStatus | null }>;
}

const none = z.object({}).strict();
const round = (v: number, d = 2): number => Math.round(v * 10 ** d) / 10 ** d;

/** A failure that means "this cannot be answered from what is on file" becomes an answer; anything else is a real error. */
const ANSWERABLE = new Set(["PLAN_INPUTS_MISSING", "ENGINE_UNAVAILABLE", "ENGINE_REJECTED", "NOT_FOUND", "PROVIDER_UNAVAILABLE", "PROVIDER_BAD_RESPONSE", "DATA_UNAVAILABLE", "PLAN_INVALID"]);

export const TOOLS: Record<ToolName, ToolDef> = {
  getProperty: {
    description: "The property: name, place, how its position was obtained, the tariff chosen.",
    writes: false,
    input: none,
    async run(c) {
      const p = await getProperty(c.deps.db, c.userId, c.propertyId, c.deps.policy);
      return { output: { name: p.name, latitude: p.latitude, longitude: p.longitude, address: p.address, positionSource: p.position.label, positionNote: p.position.note, tariffPlanId: p.tariffPlanId }, dataStatus: "REFERENCE" };
    },
  },

  getWeather: {
    description: "The current model analysis and the next 24 hours of forecast weather at the property.",
    writes: false,
    input: none,
    async run(c) {
      const p = await getProperty(c.deps.db, c.userId, c.propertyId, c.deps.policy);
      const w = await c.deps.providers.weather.forecast(p.latitude, p.longitude, { days: 2 }, { requestId: c.requestId, now: c.deps.now });
      const cur = (k: string) => {
        const m = w.current[k as keyof typeof w.current];
        return m?.value == null ? null : { value: m.value, unit: m.unit ?? null, status: m.provenance.status };
      };
      const ghi = w.hourly.global_horizontal_irradiance;
      const next = (ghi?.value ?? []).filter((x) => Date.parse(x.time) >= c.deps.now().getTime()).slice(0, 24);
      const peak = next.reduce<{ time: string; value: number } | null>((a, x) => (a === null || x.value > a.value ? x : a), null);
      return {
        output: {
          fetchedAt: w.fetchedAt,
          stale: w.stale,
          current: { airTemperatureC: cur("air_temperature"), cloudCoverPct: cur("cloud_cover"), irradianceWm2: cur("global_horizontal_irradiance"), windMs: cur("wind_speed"), precipitationMm: cur("precipitation") },
          next24h: { hours: next.length, peakIrradianceWm2: peak, meanIrradianceWm2: next.length ? round(next.reduce((a, x) => a + x.value, 0) / next.length, 1) : null },
          note: "Model data for a grid point near the property, not a station reading.",
        },
        dataStatus: ghi?.provenance.status ?? null,
      };
    },
  },

  getSatelliteObservations: {
    description: "The most recent satellite scenes over the property: when they were acquired and how cloudy. Metadata only: no imagery is analysed.",
    writes: false,
    input: none,
    async run(c) {
      const p = await getProperty(c.deps.db, c.userId, c.propertyId, c.deps.policy);
      const s = await c.deps.providers.satellite.latest(p.latitude, p.longitude, { limit: 3 }, { requestId: c.requestId, now: c.deps.now });
      if (!s.value) throw new AppError("DATA_UNAVAILABLE", s.provenance.notes[0] ?? "No satellite scenes are available.");
      return { output: { scenes: s.value.map((x) => ({ id: x.id, satellite: x.satellite, sensor: x.sensor, acquiredAt: x.acquiredAt, cloudPercent: x.cloudPercent })), note: "Scene metadata only: AVISHKAR does not analyse the imagery." }, dataStatus: s.provenance.status };
    },
  },

  getSolarForecast: {
    description: "The forecast output of the property's solar system for the next days, with its uncertainty band when one can be calibrated.",
    writes: false,
    input: z.object({ days: z.number().int().min(1).max(7).default(3) }),
    async run(c, i: { days: number }) {
      const f = await solarForecast(c.deps, c.userId, c.propertyId, { days: i.days, requestId: c.requestId });
      if (!f.hours.value || !f.energy.value) throw new AppError("DATA_UNAVAILABLE", f.hours.provenance.notes[0] ?? "No solar forecast.");
      const peak = f.hours.value.reduce((a, h) => (h.p50Kw > a.p50Kw ? h : a), f.hours.value[0]!);
      const e = f.energy.value;
      return {
        output: {
          systems: f.systems.map((s) => ({ name: s.name, capacityKwp: s.capacityKwp })),
          periodHours: f.hours.value.length,
          energyKwh: { p50: e.kwhP50, p10: e.kwhP10, p90: e.kwhP90, clearSky: e.kwhClearSky },
          yieldKwhPerKwp: e.yieldKwhPerKwpP50,
          peak: { time: peak.time, kw: peak.p50Kw },
          bandAvailable: f.band.available,
          bandCheck: f.band.calibration?.holdoutCoverage ?? null,
          notes: f.notes,
        },
        dataStatus: f.hours.provenance.status,
      };
    },
  },

  getLoadForecast: {
    description: "The forecast of the property's electricity use from its own meter readings, and how well the method did on days it had not seen.",
    writes: false,
    input: z.object({ hours: z.number().int().min(1).max(168).default(24) }),
    async run(c, i: { hours: number }) {
      const f = await loadForecast(c.deps, c.userId, c.propertyId, { hours: i.hours, requestId: c.requestId });
      if (!f.hours.value || !f.energy.value) throw new AppError("DATA_UNAVAILABLE", f.hours.provenance.notes[0] ?? "No load forecast.");
      const peak = f.hours.value.reduce((a, h) => (h.p50Kw > a.p50Kw ? h : a), f.hours.value[0]!);
      const best = f.model?.methods.find((m) => m.method === f.model?.selectedMethod);
      return {
        output: { periodHours: f.hours.value.length, energyKwh: f.energy.value.kwhP50, peak: { time: peak.time, kw: peak.p50Kw }, method: f.model?.selectedMethod ?? null, meanErrorKw: best?.maeKw ?? null, bandCheck: best?.coverage80 ?? null, dataEndsDaysAgo: f.history?.dataEndsDaysAgo ?? null, notes: f.notes },
        dataStatus: f.hours.provenance.status,
      };
    },
  },

  getBatteryState: {
    description: "The installed batteries: capacity, usable range, reserve and the charge last entered (and how old it is).",
    writes: false,
    input: none,
    async run(c) {
      await getProperty(c.deps.db, c.userId, c.propertyId, c.deps.policy);
      const rows = await c.deps.db.battery.findMany({ where: { propertyId: c.propertyId }, orderBy: { createdAt: "asc" } });
      const now = c.deps.now().getTime();
      return {
        output: {
          batteries: rows.map((b) => {
            const d = toBatteryDto(b);
            return {
              name: b.name,
              status: b.status,
              capacityKwh: b.capacityKwh,
              usableKwh: d.usableKwh,
              maxChargeKw: b.maxChargeKw,
              maxDischargeKw: b.maxDischargeKw,
              reserveSoc: b.reserveSoc,
              chargeEnteredPercent: b.currentSoc === null ? null : round(b.currentSoc * 100, 0),
              chargeEnteredHoursAgo: b.currentSocAt === null ? null : round((now - b.currentSocAt.getTime()) / 3_600_000, 1),
            };
          }),
          note: "AVISHKAR is not connected to the battery: the charge is what you last entered.",
        },
        dataStatus: "REFERENCE",
      };
    },
  },

  getTariff: {
    description: "The tariff chosen for the property: the rate in each hour, the export rate and its basis, the period the source covers.",
    writes: false,
    input: none,
    async run(c) {
      const p = await getProperty(c.deps.db, c.userId, c.propertyId, c.deps.policy);
      if (!p.tariffPlanId) throw new AppError("PLAN_INPUTS_MISSING", "No tariff has been chosen for this property.");
      const t = await getTariff(c.deps.db, c.userId, p.tariffPlanId, c.deps.now());
      return {
        output: { name: t.name, state: t.state, discom: t.discom, consumerType: t.consumerType, hourlyRatesInr: t.hourlyRates, slabs: t.slabs, exportRateInr: t.export.rate, exportBasis: t.export.basis, fixedCharge: t.fixedCharge, validity: t.validity, source: t.source, notes: t.notes },
        dataStatus: t.provenance.status,
      };
    },
  },

  getEligibility: {
    description: "What the published PM Surya Ghar schedule would pay for a solar system of a given size, if the rule on file applies. Never confirms eligibility.",
    writes: false,
    input: z.object({ systemKwp: z.number().positive().max(10_000) }),
    async run(c, i: { systemKwp: number }) {
      const p = await getProperty(c.deps.db, c.userId, c.propertyId, c.deps.policy);
      const consumer = p.tariffPlanId ? (await getTariff(c.deps.db, c.userId, p.tariffPlanId, c.deps.now())).consumerType : "RESIDENTIAL";
      const r = await evaluateEligibility(c.deps.db, { consumerType: consumer, systemKwp: i.systemKwp }, c.deps.now());
      const pm = r.programs.find((x) => x.program === "PM_SURYA_GHAR");
      return {
        output: {
          consumerType: r.consumerType,
          consumerTypeFrom: p.tariffPlanId ? "your tariff" : "an assumption (residential): no tariff is chosen",
          systemKwp: r.systemKwp,
          eligibilityConfirmed: r.eligibilityConfirmed,
          pmSuryaGhar: pm ? { outcome: pm.outcome, subsidyInr: pm.subsidy.value, caveats: pm.caveats.slice(0, 3) } : null,
          netMetering: { outcome: r.netMetering.outcome, caveat: r.netMetering.caveats[0] ?? null },
          notice: r.notice,
        },
        dataStatus: pm?.subsidy.provenance.status ?? "REFERENCE",
      };
    },
  },

  getEnergyOpportunities: {
    description: "What is worth doing at the property: example changes tried on its typical year, with the most each could cost and still repay itself, and what its records lack. Takes several seconds.",
    writes: false,
    input: none,
    async run(c) {
      const r = await findOpportunities(c.deps, c.userId, c.propertyId, { requestId: c.requestId });
      return { output: { items: r.items.map((o) => ({ id: o.id, kind: o.kind, title: o.title, annualSavingsInr: o.annualSavingsInr, breakEven: o.breakEven, detail: o.detail })), checked: r.checked, notes: r.notes }, dataStatus: "ESTIMATED" };
    },
  },

  runOptimization: {
    description: "Make a new plan for the next 24 or 48 hours and store it. Only when the person asks for a new plan.",
    writes: true,
    input: PlanRequest,
    async run(c, i: z.output<typeof PlanRequest>) {
      const p = await createPlan(c.deps, c.userId, c.propertyId, i, { requestId: c.requestId });
      return { output: compactPlan(p), dataStatus: p.result.provenance.status };
    },
  },

  runSimulation: {
    description: "Estimate a typical year with solar or a battery added, or another tariff, and store the scenario. Only when the person asks for that.",
    writes: true,
    input: ScenarioRequest,
    async run(c, i: z.output<typeof ScenarioRequest>) {
      const s = await runScenario(c.deps, c.userId, c.propertyId, i, { requestId: c.requestId });
      return { output: compactScenario(s), dataStatus: s.comparison.provenance.status };
    },
  },

  calculateEconomics: {
    description: "Payback, discounted payback, net present value and rate of return of a yearly saving against an amount paid. Pure arithmetic on the numbers given.",
    writes: false,
    input: z.object({
      investmentInr: z.number().min(0).max(1e10),
      annualSavingsInr: z.number().min(-1e9).max(1e9),
      years: z.number().int().min(1).max(40).default(20),
      discountRatePercent: z.number().min(0).max(40).default(8),
      tariffEscalationPercent: z.number().min(0).max(25).default(0),
      degradationPercent: z.number().min(0).max(10).default(0.5),
    }),
    async run(_c, i: { investmentInr: number; annualSavingsInr: number; years: number; discountRatePercent: number; tariffEscalationPercent: number; degradationPercent: number }) {
      const e = economics({ investmentInr: i.investmentInr, annualSavingsInr: i.annualSavingsInr, years: i.years, discountRate: i.discountRatePercent / 100, tariffEscalation: i.tariffEscalationPercent / 100, degradation: i.degradationPercent / 100 });
      return { output: { paybackYears: e.paybackYears, discountedPaybackYears: e.discountedPaybackYears, npvInr: e.npvInr, irrPercent: e.irrPercent, netGainInr: e.netGainInr, assumptions: i }, dataStatus: "ESTIMATED" };
    },
  },

  getResilience: {
    description: "How many hours the batteries alone could carry the loads marked critical, from the equipment entered. No outage forecast exists.",
    writes: false,
    input: none,
    async run(c) {
      await getProperty(c.deps.db, c.userId, c.propertyId, c.deps.policy);
      const [batteries, appliances] = await Promise.all([c.deps.db.battery.findMany({ where: { propertyId: c.propertyId, status: "EXISTING" } }), c.deps.db.appliance.findMany({ where: { propertyId: c.propertyId, priority: "CRITICAL" } })]);
      if (batteries.length === 0) throw new AppError("DATA_UNAVAILABLE", "No installed battery is entered, so there is no stored energy to carry a critical load through an outage.");
      const criticalKw = appliances.reduce((a, x) => a + (x.ratedPowerW * x.quantity) / 1000, 0);
      if (criticalKw <= 0) throw new AppError("DATA_UNAVAILABLE", "No appliance is marked critical, so there is no critical load to carry. Mark the refrigerator, lights and the like on the Assets tab.");
      const dtos = batteries.map(toBatteryDto);
      const usable = dtos.reduce((a, d) => a + d.usableKwh, 0);
      const eta = batteries.reduce((a, b, i) => a + (dtos[i]!.effective.dischargeEfficiency.value ?? DEFAULTS.battery.oneWayEfficiency.value) * b.capacityKwh, 0) / batteries.reduce((a, b) => a + b.capacityKwh, 0);
      const now = c.deps.now().getTime();
      const known = batteries.every((b) => b.currentSoc !== null && b.currentSocAt !== null && now - b.currentSocAt.getTime() <= 24 * 3_600_000);
      const minFrac = (b: (typeof batteries)[number], d: (typeof dtos)[number]) => (d.effective.minSoc.value ?? 0) * b.capacityKwh;
      const nowKwh = known ? batteries.reduce((a, b, i) => a + Math.max(0, b.currentSoc! * b.capacityKwh - minFrac(b, dtos[i]!)), 0) : null;
      // the fuller answer, with the forecast sun and the battery's charge as entered or assumed (the same engine as the Resilience tab)
      let ifGridFailedNow: Record<string, unknown> | null = null;
      try {
        const rep = await resilienceReport(c.deps, c.userId, c.propertyId, { targetHours: 4, startSocPercent: null }, { requestId: c.requestId });
        const v = rep.resilience.value;
        if (v && v.battery) {
          ifGridFailedNow = {
            hours: v.backupHours.withForecastSun,
            atLeast: v.backupHours.atLeast,
            hoursBatteryAlone: v.backupHours.withoutSun,
            score: v.score,
            chargeAssumed: v.battery.startSocBasis === "ASSUMPTION",
            startChargeKwh: v.battery.startSocKwh,
            reserve: v.recommendedReserve && { targetHours: v.recommendedReserve.targetHours, reserveKwh: v.recommendedReserve.reserveKwh, currentReserveKwh: v.recommendedReserve.currentReserveKwh, feasible: v.recommendedReserve.feasible },
          };
        }
      } catch {
        // without the engine or a forecast the fuller answer is left out, and the batteries-alone figures still stand
      }
      return {
        output: {
          criticalKw: round(criticalKw, 3),
          criticalAppliances: appliances.map((a) => a.name),
          ifGridFailedNow,
          batteryUsableKwh: round(usable, 2),
          hoursAtFullCharge: round((usable * eta) / criticalKw, 1),
          hoursAtCurrentCharge: nowKwh === null ? null : round((nowKwh * eta) / criticalKw, 1),
          assumptions: ["Batteries alone: solar during the outage is not counted (it depends on an inverter that can run without the grid, which is not modelled).", "Discharge losses are included; the critical load is taken as constant at its rated power.", "No outage has been forecast: no outage data is available."],
        },
        dataStatus: "ESTIMATED",
      };
    },
  },

  getCounterfactual: {
    description: "What the same day or year would have cost without the plan or the change: the latest plan against no control, and the latest scenario against no equipment and against no control.",
    writes: false,
    input: none,
    async run(c) {
      const out: Record<string, unknown> = {};
      try {
        const p = await getPlan(c.deps.db, c.userId, c.propertyId);
        const r = p.result.value;
        if (r) out.plan = { madeAt: p.createdAt, mode: p.mode, hours: p.horizon.steps, plannedCostInr: r.netCostInr, noControlCostInr: r.baselineNetCostInr, savingsInr: r.savingsInr, basis: "The same day with no battery control, no appliance shifting and no EV scheduling." };
      } catch (e) {
        if (!(e instanceof AppError && e.code === "NOT_FOUND")) throw e;
      }
      const list = await listScenarios(c.deps.db, c.userId, c.propertyId);
      if (list[0]) {
        const s = await getScenario(c.deps.db, c.userId, c.propertyId, list[0].id);
        out.scenario = { name: s.name, madeAt: s.createdAt, today: { plannedCostInr: s.base.netCostInr, noControlCostInr: s.base.uncontrolledCostInr, noEquipmentCostInr: s.base.gridOnlyCostInr }, changed: { plannedCostInr: s.scenario.netCostInr, noControlCostInr: s.scenario.uncontrolledCostInr, noEquipmentCostInr: s.scenario.gridOnlyCostInr }, basis: "A typical year: no equipment means every kWh bought; no control means the battery idle and solar used as it falls." };
      }
      if (Object.keys(out).length === 0) throw new AppError("DATA_UNAVAILABLE", "No plan or scenario has been made yet, so there is nothing to compare with. Make a plan or run a what-if first.");
      return { output: out, dataStatus: "SIMULATED" };
    },
  },

  getLatestPlan: {
    description: "The most recent plan as it was shown: its outcome, the decisions with the reason for each, and its assumptions.",
    writes: false,
    input: none,
    async run(c) {
      const p = await getPlan(c.deps.db, c.userId, c.propertyId);
      return { output: compactPlan(p, 40), dataStatus: p.result.provenance.status };
    },
  },

  getForecastAccuracy: {
    description: "How the stored load forecasts have done against the readings that followed them.",
    writes: false,
    input: none,
    async run(c) {
      const a = await forecastAccuracy(c.deps, c.userId, c.propertyId);
      return { output: { summary: a.load.summary.value, scoredRuns: a.load.runs.filter((r) => r.status === "SCORED").length, waitingRuns: a.load.runs.filter((r) => r.status === "WAITING").length, solar: a.solar.reason }, dataStatus: a.load.summary.provenance.status };
    },
  },
};

type PlanLike = Awaited<ReturnType<typeof getPlan>>;
function compactPlan(p: PlanLike, decisions = 12) {
  const r = p.result.value;
  return {
    planId: p.id,
    madeAt: p.createdAt,
    mode: p.mode,
    start: p.horizon.start,
    hours: p.horizon.steps,
    netCostInr: r?.netCostInr ?? null,
    noControlCostInr: r?.baselineNetCostInr ?? null,
    savingsInr: r?.savingsInr ?? null,
    importKwh: r?.importKwh ?? null,
    exportKwh: r?.exportKwh ?? null,
    solarUsedKwh: r?.pvUsedKwh ?? null,
    solarKwh: r?.pvKwh ?? null,
    batteryCycles: r?.batteryCycles ?? null,
    decisions: p.decisions.slice(0, decisions),
    totalDecisions: p.decisions.length,
    appliances: p.appliances,
    assumptions: p.assumptions,
    loadBasis: p.inputs.load.basis,
  };
}

type ScenarioLike = Awaited<ReturnType<typeof runScenario>>;
function compactScenario(s: ScenarioLike) {
  return {
    scenarioId: s.id,
    name: s.name,
    annualSavingsInr: s.comparison.value?.annualSavingsInr ?? null,
    savingsPercent: s.comparison.value?.savingsPercent ?? null,
    todayCostInr: s.base.netCostInr,
    changedCostInr: s.scenario.netCostInr,
    selfSufficiency: { today: s.base.selfSufficiencyRatio, changed: s.scenario.selfSufficiencyRatio },
    investmentInr: s.investment.value?.totalInr ?? null,
    investmentUnavailable: s.investment.value === null ? (s.investment.provenance.notes[0] ?? null) : null,
    paybackYears: s.economics.value?.paybackYears ?? null,
    npvInr: s.economics.value?.npvInr ?? null,
    irrPercent: s.economics.value?.irrPercent ?? null,
    subsidyInr: s.subsidy.value,
    assumptions: s.assumptions.slice(0, 6),
  };
}

export interface ToolCatalogEntry {
  name: ToolName;
  description: string;
  writes: boolean;
}

export const TOOL_CATALOG: ToolCatalogEntry[] = TOOL_NAMES.map((n) => ({ name: n, description: TOOLS[n].description, writes: TOOLS[n].writes }));

/** Validate the input, run the tool, and wrap what comes back. A tool that cannot answer returns UNAVAILABLE with its reason. */
export async function callTool(ctx: ToolContext, name: ToolName, rawInput: unknown): Promise<ToolResult> {
  const def = TOOLS[name];
  const parsed = def.input.safeParse(rawInput ?? {});
  if (!parsed.success) throw new AppError("VALIDATION_FAILED", `${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}`);
  const base = { id: randomUUID(), tool: name, input: parsed.data, calledAt: ctx.deps.now().toISOString() };
  try {
    const r = await def.run(ctx, parsed.data as never);
    return { ...base, output: r.output, status: "OK", unavailableReason: null, dataStatus: r.dataStatus ?? null };
  } catch (e) {
    if (e instanceof AppError && ANSWERABLE.has(e.code)) return { ...base, output: null, status: "UNAVAILABLE", unavailableReason: e.message, dataStatus: "UNAVAILABLE" };
    throw e;
  }
}
