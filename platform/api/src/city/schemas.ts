import { z } from "zod";
import { measured } from "../schemas.js";

export const CityRequest = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    spanKm: z.number().min(4).max(60).default(12).describe("How wide the square is, in kilometres."),
    cellsPerSide: z.number().int().min(2).max(5).default(4).describe("Cells along each side. More cells do not mean more detail: the solar provider's grid is coarser than a city."),
  })
  .refine((v) => v.spanKm / v.cellsPerSide >= 1.1, { message: "Cells must be at least 1.1 km across: the solar provider is asked about a point rounded to about a kilometre, so smaller cells would repeat one value.", path: ["cellsPerSide"] })
  .meta({ id: "CityRequest" });
export type CityRequest = z.infer<typeof CityRequest>;

const Solar = z.object({
  annualGhiKwhM2Day: z.number().describe("Average daily global horizontal irradiation over the year, kWh/m² per day."),
  bestMonth: z.object({ month: z.number(), ghiKwhM2Day: z.number() }),
  worstMonth: z.object({ month: z.number(), ghiKwhM2Day: z.number() }),
  period: z.string().describe("The climatological period, as the provider states it."),
});

const Yours = z.object({
  properties: z.number().int(),
  names: z.array(z.string()).describe("Your own properties in this cell. Only yours: no one else's property is known to this map."),
  solarKwp: z.number().nullable(),
  batteryKwh: z.number().nullable(),
  evs: z.number().int(),
  flexibleKw: z.number().nullable().describe("Rated power of the appliances you marked flexible."),
  meanDailyKwh: z.number().nullable().describe("From the Energy DNA of those properties that have one; null when none has meter readings."),
});

export const CityCellSchema = z.object({
  id: z.string(),
  row: z.number().int(),
  col: z.number().int(),
  centre: z.object({ latitude: z.number(), longitude: z.number() }),
  bounds: z.object({ west: z.number(), south: z.number(), east: z.number(), north: z.number() }),
  geojson: z.unknown().describe("The cell as a GeoJSON polygon, for the map."),
  solar: measured(Solar),
  yours: Yours.nullable().describe("Null when none of your properties is in this cell."),
});

const Unknown = z.object({ status: z.literal("UNAVAILABLE"), reason: z.string() });

export const CitySchema = z
  .object({
    label: z.literal("CITY ENERGY MAP"),
    madeAt: z.string(),
    grid: z.object({
      centre: z.object({ latitude: z.number(), longitude: z.number() }),
      spanKm: z.number(),
      cellsPerSide: z.number(),
      cellKm: z.number(),
    }),
    cells: z.array(CityCellSchema),
    solarSpread: z
      .object({
        distinctValues: z.number().int().describe("How many different annual values the cells got. One means the provider cannot tell these cells apart."),
        lowest: z.number(),
        highest: z.number(),
        note: z.string(),
      })
      .nullable()
      .describe("Null when no cell got a value."),
    yourTotals: Yours.describe("Your own properties inside the square, added up."),
    cityWide: z
      .object({
        demand: Unknown,
        storage: Unknown,
        evs: Unknown,
        flexibility: Unknown,
        energyRisk: Unknown,
      })
      .describe("What a city energy map would also show, and why AVISHKAR states none of it."),
    notes: z.array(z.string()),
  })
  .meta({ id: "CityEnergyMap" });
export type CityDto = z.infer<typeof CitySchema>;
