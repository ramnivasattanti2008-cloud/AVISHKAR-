import { z } from "zod";
import { MODES } from "../engine/schemas.js";
import { measured } from "../schemas.js";
import { FUTURE_KEYS } from "./scenarios.js";

export const FuturesRequest = z
  .object({
    mode: z.enum(MODES).default("BALANCED").describe("What the plan favours, as for any plan."),
    startSocPercent: z.number().min(0).max(100).nullish().describe("The battery's charge now, if you know it."),
    rainSolarPercent: z.number().min(0).max(100).default(20).describe("The share of the expected solar output that comes through on a rainy day. The default is an assumption, not a measurement: set your own."),
    outage: z
      .object({
        startHour: z.number().int().min(0).max(23).default(18).describe("The local clock hour the outage starts."),
        hours: z.number().int().min(1).max(12).default(4).describe("How many hours it lasts."),
      })
      .default({ startHour: 18, hours: 4 })
      .describe("A grid outage to ask about. A question, not a forecast: no outage data exists."),
  })
  .meta({ id: "FuturesRequest" });
export type FuturesRequest = z.infer<typeof FuturesRequest>;

const Outcome = z.object({
  netCostInr: z.number().describe("What the day costs with the plan made for it."),
  noControlCostInr: z.number().describe("What the same day costs with no battery control, no shifting and no car scheduling."),
  savingsInr: z.number(),
  importKwh: z.number(),
  exportKwh: z.number(),
  solarKwh: z.number(),
  loadKwh: z.number(),
  unservedKwh: z.number().describe("Load that could not be served with the plan. Only in an outage is there any."),
  unservedNoControlKwh: z.number().describe("The same with no control."),
  batteryCycles: z.number(),
  autonomyPercent: z.number().nullable().describe("100 × (1 − energy bought ÷ energy used)."),
  shedKwh: z.number().describe("Load switched off because the grid was down: everything above the critical load, hour by hour of the outage. Zero when there is no outage."),
  vsExpectedInr: z.number().nullable().describe("This day's cost with the plan, less the expected day's. Positive is dearer. Null for a day with an outage: its bill is lower because load is switched off, not because the day is cheaper."),
});

export const FutureSchema = z.object({
  key: z.enum(FUTURE_KEYS),
  label: z.string(),
  basis: z.enum(["REFERENCE", "DATA", "ASSUMPTION"]).describe("REFERENCE: the day the forecasts expect. DATA: an end of a band the forecast measured from this place's own past errors. ASSUMPTION: a figure you set or a question you ask."),
  built: z.string().describe("What the day is built from, in words."),
  sameAsExpected: z.boolean().describe("True when this day's sun and demand are the expected day's to the last digit, so it can only give the same result: a band with no width, as when the readings are perfectly regular and the forecast has seen no error."),
  state: z.enum(["RUN", "UNAVAILABLE"]),
  reason: z.string().nullable().describe("Why it was not run, when it was not."),
  result: measured(Outcome),
});

export const FuturesSchema = z
  .object({
    label: z.literal("ENERGY FUTURES"),
    madeAt: z.string(),
    horizon: z.object({ start: z.string(), steps: z.number() }),
    request: z.object({ mode: z.enum(MODES), rainSolarPercent: z.number(), outage: z.object({ startHour: z.number(), hours: z.number() }) }),
    futures: z.array(FutureSchema),
    spread: z
      .object({
        cheapest: z.object({ key: z.enum(FUTURE_KEYS), label: z.string(), netCostInr: z.number() }),
        dearest: z.object({ key: z.enum(FUTURE_KEYS), label: z.string(), netCostInr: z.number() }),
        note: z.string(),
      })
      .nullable()
      .describe("The cheapest and dearest of the futures that were run, leaving out the days with an outage (load is switched off in them). Null when fewer than two were compared."),
    assumptions: z.array(z.string()),
    notes: z.array(z.string()),
  })
  .meta({ id: "EnergyFutures" });
export type FuturesDto = z.infer<typeof FuturesSchema>;
