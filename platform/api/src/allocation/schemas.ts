import { z } from "zod";
import { measured } from "../schemas.js";

const Row = z.object({
  time: z.string(),
  demandKwh: z.number(),
  servedKwh: z.number().describe("The part of the demand the plan could serve; below demandKwh only in an outage."),
  solarToDemandKwh: z.number(),
  batteryToDemandKwh: z.number(),
  gridToDemandKwh: z.number(),
  solarToBatteryKwh: z.number(),
  gridToBatteryKwh: z.number(),
  solarToGridKwh: z.number(),
  batteryToGridKwh: z.number(),
  solarCurtailedKwh: z.number(),
  importPriceInr: z.number(),
  exportPriceInr: z.number(),
});

const Totals = z.object({
  solar: z
    .object({ madeKwh: z.number(), toDemandKwh: z.number(), toBatteryKwh: z.number(), soldKwh: z.number(), thrownAwayKwh: z.number() })
    .describe("The four destinations add up to everything the panels made."),
  demand: z
    .object({ kwh: z.number(), servedKwh: z.number(), fromSolarKwh: z.number(), fromBatteryKwh: z.number(), fromGridKwh: z.number() })
    .describe("The three sources add up to what was served."),
  battery: z
    .object({ inKwh: z.number(), outKwh: z.number(), lostKwh: z.number(), levelChangeKwh: z.number(), outFromSolarKwh: z.number(), outFromGridKwh: z.number() })
    .nullable()
    .describe("What went in, what came out, what was lost between the two, and where what came out had come from. Null with no battery."),
  grid: z.object({ boughtKwh: z.number(), forDemandKwh: z.number(), forBatteryKwh: z.number(), soldKwh: z.number() }),
  money: z.object({
    boughtForDemandInr: z.number(),
    boughtForBatteryInr: z.number(),
    soldInr: z.number(),
    batteryDisplacedInr: z.number().describe("What the energy taken from the battery would have cost at the import price of the hour it was used."),
    storedSolarDisplacedInr: z.number().describe("The same for the part that had come from the sun. Not a saving on its own: the plan's saving is what it is."),
  }),
});

export const AllocationSchema = z
  .object({
    label: z.literal("WHERE EVERY kWh WENT"),
    propertyId: z.uuid(),
    madeAt: z.string(),
    basedOn: z.object({ planId: z.uuid(), madeAt: z.string(), stale: z.boolean(), note: z.string() }).nullable(),
    rule: z.array(z.string()).describe("The order the energy is attributed in. The optimiser does not record which kWh went where, so this is a convention, not a measurement."),
    hours: z.array(Row),
    totals: measured(Totals),
    check: z.object({ balanced: z.boolean(), maxHourErrorKwh: z.number(), note: z.string() }),
    next: z.array(z.object({ label: z.string(), href: z.string(), why: z.string() })),
  })
  .meta({ id: "EnergyAllocation" });
export type AllocationDto = z.infer<typeof AllocationSchema>;
