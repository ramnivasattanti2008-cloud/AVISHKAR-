import { z } from "zod";
import { AppError, ProviderError } from "../errors.js";
import { type GeoPoint, type Measured, reference } from "../provenance/index.js";
import { checkCoordinates } from "../quality.js";
import { type Cache, cachedFetch } from "./cache.js";
import { coarsen } from "./weather.js";
import type { ProviderHttp } from "./http.js";

export interface MonthlySolar {
  month: number;
  /** All-sky global horizontal irradiation, kWh/m2/day. */
  ghiKwhM2Day: number | null;
  /** Clear-sky global horizontal irradiation, kWh/m2/day. */
  clearSkyKwhM2Day: number | null;
  /** Ratio of all-sky to extraterrestrial irradiation, 0..1. */
  clearnessIndex: number | null;
  airTempC: number | null;
}

export interface SolarResource {
  location: GeoPoint;
  elevationM: number | null;
  /** The climatological period, as the provider states it. */
  period: string;
  months: MonthlySolar[];
  annual: Omit<MonthlySolar, "month">;
  /** Values the provider marked missing or that failed physical checks; they are null above, never filled in. */
  rejected: string[];
}

export interface SolarResourceProvider {
  readonly name: string;
  climatology(latitude: number, longitude: number, ctx?: { requestId?: string; now?: () => Date }): Promise<Measured<SolarResource>>;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;
const PARAMS = ["ALLSKY_SFC_SW_DWN", "CLRSKY_SFC_SW_DWN", "ALLSKY_KT", "T2M"] as const;

const PowerResponse = z.object({
  geometry: z.object({ coordinates: z.array(z.number()).min(2) }),
  properties: z.object({ parameter: z.record(z.string(), z.record(z.string(), z.number())) }),
  header: z.object({ range: z.string().optional(), fill_value: z.number().optional() }),
});

const TTL_SECONDS = 90 * 24 * 3600; // a 20-year climatology does not change from week to week

export class NasaPowerSolarResource implements SolarResourceProvider {
  readonly name = "nasa-power";
  constructor(private readonly deps: { http: ProviderHttp; cache: Cache }) {}

  async climatology(latitude: number, longitude: number, ctx: { requestId?: string; now?: () => Date } = {}): Promise<Measured<SolarResource>> {
    const c = checkCoordinates(latitude, longitude);
    if (!c.ok) throw new AppError("INVALID_COORDINATES", c.reason);
    const lat = coarsen(latitude);
    const lon = coarsen(longitude);
    const now = ctx.now ?? (() => new Date());
    const got = await cachedFetch(
      this.deps.cache,
      `solar:nasa-power:${lat}:${lon}`,
      this.name,
      TTL_SECONDS,
      async () => {
        const r = await this.deps.http.getJson(
          "climatology",
          "/api/temporal/climatology/point",
          { parameters: PARAMS.join(","), community: "RE", latitude: lat, longitude: lon, format: "JSON" },
          { schema: PowerResponse, requestId: ctx.requestId },
        );
        return this.parse(r);
      },
      now,
    );
    const m = reference(got.value, {
      provider: this.name,
      source: "NASA POWER climatology (MERRA-2 / SYN1DEG)",
      dataType: "solar_resource_climatology",
      location: got.value.location,
      now: now(),
      notes: [
        `Climatological average, ${got.value.period}. It describes a typical day in each month, not a forecast.`,
        "Irradiation on a horizontal surface; a tilted, south-facing array receives somewhat more over a year.",
      ],
    });
    if (got.value.rejected.length) m.provenance.notes.push(`${got.value.rejected.length} value(s) were missing or implausible and are left empty.`);
    return m;
  }

  private parse(r: z.infer<typeof PowerResponse>): SolarResource {
    const fill = r.header.fill_value ?? -999;
    const rejected: string[] = [];
    const pick = (param: string, key: string, lo: number, hi: number): number | null => {
      const v = r.properties.parameter[param]?.[key];
      if (v === undefined || v === fill || !Number.isFinite(v) || v < lo || v > hi) {
        rejected.push(`${param} ${key}`);
        return null;
      }
      return v;
    };
    const row = (key: string): Omit<MonthlySolar, "month"> => ({
      ghiKwhM2Day: pick("ALLSKY_SFC_SW_DWN", key, 0, 12),
      clearSkyKwhM2Day: pick("CLRSKY_SFC_SW_DWN", key, 0, 14),
      clearnessIndex: pick("ALLSKY_KT", key, 0, 1),
      airTempC: pick("T2M", key, -90, 60),
    });
    const annual = row("ANN");
    if (annual.ghiKwhM2Day === null) {
      throw new ProviderError(this.name, "climatology", "NASA POWER returned no usable annual irradiation for this location.", "PROVIDER_BAD_RESPONSE");
    }
    const [lon, lat, elev] = r.geometry.coordinates;
    return {
      location: { latitude: lat!, longitude: lon! },
      elevationM: elev ?? null,
      period: r.header.range ?? "climatological period not stated",
      months: MONTHS.map((m, i) => ({ month: i + 1, ...row(m) })),
      annual,
      rejected,
    };
  }
}
