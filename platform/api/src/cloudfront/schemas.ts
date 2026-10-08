import { z } from "zod";
import { MODES } from "../engine/schemas.js";
import { measured } from "../schemas.js";

const nums = z.array(z.number());

export const CloudFrontRequest = z
  .object({
    arrivalMinutes: z.number().min(1).max(720).default(38).describe("Minutes from now until the front's leading edge reaches the property. The default is an example, not a prediction."),
    reductionPercent: z.number().min(1).max(95).default(22).describe("Share of the sun lost while the front is overhead. The default is an example, not a prediction."),
    durationHours: z.number().min(0.5).max(12).default(3).describe("How long the front takes to pass."),
    mode: z.enum(MODES).default("BALANCED").describe("What the plan favours, as for any plan."),
    startSocPercent: z.number().min(0).max(100).nullish().describe("The battery's charge now, if you know it."),
  })
  .meta({ id: "CloudFrontRequest" });
export type CloudFrontRequest = z.infer<typeof CloudFrontRequest>;

const Outcome = z.object({ importKwh: z.number(), netCostInr: z.number() });

const Result = z.object({
  solarNowKw: z.number().nullable().describe("The solar forecast's output for the current hour. Null when the forecast does not cover it."),
  frontArrivesAt: z.string(),
  frontEndsAt: z.string(),
  reductionPercent: z.number(),
  solarLostKwh: z.number().describe("Sun the front takes from the planned day, in kWh of solar output."),
  solarLostPercentOfDay: z.number().nullable(),
  batteryNowPercent: z.number().nullable().describe("The battery's charge at the start of the plan, as a share of its capacity; null with no battery."),
  batteryNowBasis: z.enum(["USER_ENTERED", "ASSUMPTION"]).nullable(),
  eveningDemand: z
    .object({ level: z.enum(["HIGH", "NORMAL", "LOW"]), eveningMeanKw: z.number(), meanKw: z.number(), ratio: z.number(), rule: z.string() })
    .nullable(),
  advice: z.object({ code: z.enum(["CHARGE_NOW", "HOLD_CHARGE", "NO_CHANGE", "NO_BATTERY"]), text: z.string(), extraChargeKwh: z.number(), extraHeldKwh: z.number() }),
  without: Outcome.describe("Without AVISHKAR: no battery control, no shifting; the sky with the front."),
  with: Outcome.describe("With AVISHKAR: the plan made knowing the front is coming; the same sky."),
  difference: z.object({ importKwh: z.number().describe("Grid energy without AVISHKAR less with it. Negative when the plan buys more, for example to store cheap night energy that replaces dear evening energy."), savingsInr: z.number() }),
  onForecastSky: z.object({ withoutNetCostInr: z.number(), withNetCostInr: z.number() }).describe("The same 24 hours with no front: the no-control cost and the plan's cost on the forecast sky, for comparison."),
  frontCost: z.object({
    withoutAvishkarInr: z.number().describe("What the front adds to the no-control bill: the no-control cost under the front less the no-control cost under the forecast sky."),
    withAvishkarInr: z.number().describe("What the front adds to the plan's bill: the plan's cost knowing the front less the plan's cost on the forecast sky. It can exceed the no-control figure, because the plan had more to lose from the lost sun."),
  }),
});

export const CloudFrontSchema = z
  .object({
    label: z.literal("CLOUD FRONT SCENARIO"),
    request: z.object({ arrivalMinutes: z.number(), reductionPercent: z.number(), durationHours: z.number(), mode: z.enum(MODES) }),
    madeAt: z.string(),
    horizon: z.object({ start: z.string(), stepHours: z.number(), steps: z.number() }),
    hourly: z.object({
      times: z.array(z.string()),
      solarKw: nums.describe("The solar forecast on the forecast sky."),
      solarWithFrontKw: nums,
      loadKw: nums,
      batteryChargeKw: nums.describe("The plan that knows about the front."),
      batteryChargeUnawareKw: nums.describe("The plan made on the forecast sky, without the front."),
      batterySocKwh: nums,
      gridImportKw: nums,
      gridImportUnawareKw: nums,
    }),
    result: measured(Result),
    assumptions: z.array(z.string()),
    notes: z.array(z.string()),
  })
  .meta({ id: "CloudFrontScenario" });
export type CloudFrontDto = z.infer<typeof CloudFrontSchema>;
