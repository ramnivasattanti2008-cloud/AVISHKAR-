import { z } from "zod";
import { measured } from "../schemas.js";

const iso = z.string();

export const ScenarioRequest = z
  .object({
    name: z.string().trim().min(1).max(80).optional().describe("A label for your own reference."),
    addSolarKwp: z.number().positive().max(1000).optional().describe("Solar capacity to add, kWp."),
    solarTiltDeg: z.number().min(0).max(90).optional().describe("Tilt of the added panels. Default: the latitude, a common rule for a fixed array."),
    solarAzimuthDeg: z.number().min(0).lt(360).optional().describe("Direction the added panels face, degrees clockwise from north. Default: 180, south."),
    addBatteryKwh: z.number().positive().max(10_000).optional().describe("Battery capacity to add, kWh."),
    batteryPowerKw: z.number().positive().max(10_000).optional().describe("Charge and discharge power of the added battery. Default: half its capacity per hour."),
    tariffPlanId: z.uuid().optional().describe("Compare against a different tariff, your own or a curated one."),
    costs: z
      .object({
        solarInrPerKwp: z.number().min(0).max(1_000_000).optional(),
        batteryInrPerKwh: z.number().min(0).max(1_000_000).optional(),
        otherInr: z.number().min(0).max(1_000_000_000).optional().describe("Anything else paid up front: wiring, mounting, a new inverter."),
      })
      .optional()
      .describe("What you would pay, from a quote. AVISHKAR has no price list: without these there is no payback."),
    economics: z
      .object({
        years: z.number().int().min(1).max(40).optional().describe("Years the saving lasts. Default 20."),
        discountRatePercent: z.number().min(0).max(40).optional().describe("What money is worth to you each year. Default 8."),
        tariffEscalationPercent: z.number().min(0).max(25).optional().describe("Yearly rise in the tariff. Default 0: no rise is assumed."),
        degradationPercent: z.number().min(0).max(10).optional().describe("Yearly loss of the saving as equipment ages. Default 0.5."),
      })
      .optional(),
    gridCarbonKgPerKwh: z.number().min(0).max(3).optional().describe("The grid's emission factor, kg CO2 per kWh, from your utility or a published table. None is built in."),
  })
  .refine((v) => v.addSolarKwp !== undefined || v.addBatteryKwh !== undefined || v.tariffPlanId !== undefined, { message: "Change something: add solar, add a battery, or choose another tariff." })
  .meta({ id: "ScenarioRequest" });
export type ScenarioRequest = z.infer<typeof ScenarioRequest>;

const Annual = z.object({
  gridOnlyCostInr: z.number().describe("The bill with no solar and no battery."),
  uncontrolledCostInr: z.number().describe("The same equipment with no control: battery idle, solar used as it falls."),
  netCostInr: z.number().describe("The same equipment, planned hour by hour."),
  importKwh: z.number(),
  exportKwh: z.number(),
  loadKwh: z.number(),
  pvKwh: z.number(),
  pvUsedKwh: z.number(),
  selfConsumptionRatio: z.number().nullable().describe("Share of the solar generation that was not curtailed: used by the property, stored or sold. Despite the name, solar that is exported counts as used; it is not the share consumed on site. Null when there is no solar."),
  selfSufficiencyRatio: z.number().nullable(),
  batteryCycles: z.number(),
  months: z.array(z.object({ month: z.number(), days: z.number(), netCostInr: z.number(), importKwh: z.number(), exportKwh: z.number(), pvKwh: z.number(), loadKwh: z.number() })),
});

const Equipment = z.object({ solarKwp: z.number(), batteryKwh: z.number(), tariff: z.string() });

const Economics = z.object({
  paybackYears: z.number().nullable(),
  discountedPaybackYears: z.number().nullable(),
  npvInr: z.number(),
  irrPercent: z.number().nullable(),
  netGainInr: z.number(),
  cashflows: z.array(z.object({ year: z.number(), savingsInr: z.number(), cumulativeInr: z.number(), discountedCumulativeInr: z.number() })),
});

export const ScenarioSchema = z
  .object({
    id: z.uuid(),
    propertyId: z.uuid(),
    createdAt: iso,
    name: z.string(),
    request: ScenarioRequest,
    equipment: z.object({ base: Equipment, scenario: Equipment }),
    base: Annual,
    scenario: Annual,
    comparison: measured(
      z.object({
        annualSavingsInr: z.number().describe("What the change saves each year: the planned cost of today's setup minus that of the changed one."),
        savingsPercent: z.number().nullable(),
        importKwhChange: z.number(),
        exportKwhChange: z.number(),
        selfSufficiencyChange: z.number().nullable(),
      }),
    ),
    investment: measured(z.object({ totalInr: z.number(), solarInr: z.number(), batteryInr: z.number(), otherInr: z.number() })),
    subsidy: measured(z.number()).describe("What a published scheme would pay on the added solar, if you qualify. Not netted off the investment."),
    economics: measured(Economics).describe("Without any subsidy."),
    economicsIfSubsidised: measured(Economics).nullable(),
    carbon: measured(z.object({ avoidedKgPerYear: z.number() })),
    economicsAssumptions: z.object({ years: z.number(), discountRatePercent: z.number(), tariffEscalationPercent: z.number(), degradationPercent: z.number() }),
    assumptions: z.array(z.string()),
    notes: z.array(z.string()),
  })
  .meta({ id: "Scenario" });
export type ScenarioDto = z.infer<typeof ScenarioSchema>;

export const ScenarioSummarySchema = z
  .object({ id: z.uuid(), createdAt: iso, name: z.string(), annualSavingsInr: z.number(), addSolarKwp: z.number().nullable(), addBatteryKwh: z.number().nullable(), tariffChanged: z.boolean() })
  .meta({ id: "ScenarioSummary" });
