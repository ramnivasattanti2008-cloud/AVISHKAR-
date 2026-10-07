/**
 * The engine's wire format, written against platform/engine/openapi.json (the committed contract). Responses are validated
 * at runtime: a reply that does not match is an error here, never a silently wrong number downstream.
 */
import { z } from "zod";

export const MODES = ["SAVE_MONEY", "INDEPENDENCE", "RESILIENCE", "GREEN", "REVENUE", "BALANCED"] as const;
export type Mode = (typeof MODES)[number];

export interface OptimiseRequest {
  stepHours: 0.25 | 0.5 | 1;
  startTime?: string;
  loadKw: number[];
  pvKw: number[];
  importPrice: number[];
  exportPrice: number[];
  battery?: {
    capacityKwh: number;
    maxChargeKw: number;
    maxDischargeKw: number;
    chargeEfficiency: number;
    dischargeEfficiency: number;
    minSocKwh: number;
    maxSocKwh: number;
    reserveSocKwh?: number | null;
    initialSocKwh: number;
    terminalSocKwh?: number | null;
    wearInrPerKwh?: number;
  } | null;
  grid?: { importLimitKw?: number | null; exportLimitKw?: number | null; outages?: { startStep: number; endStep: number }[] };
  criticalKw?: number;
  backupHours?: number;
  ev?: { energyNeededKwh: number; chargerKw: number; chargerEfficiency: number; availableFromStep: number; departureStep: number } | null;
  appliances?: { id: string; name: string; powerKw: number; durationSteps: number; earliestStartStep: number; latestFinishStep: number; interruptible: boolean }[];
  mode?: Mode;
  carbonKgPerKwh?: number[] | null;
  timeLimitS?: number;
}

const nums = z.array(z.number());

export const OptimiseResponse = z.object({
  mode: z.enum(MODES),
  modeWeights: z.record(z.string(), z.number()),
  solver: z.object({ status: z.enum(["optimal", "infeasible", "error"]), message: z.string(), objective: z.number().nullable(), seconds: z.number(), integerVariables: z.number() }),
  schedule: z
    .object({
      pvUsedKw: nums,
      pvCurtailedKw: nums,
      gridImportKw: nums,
      gridExportKw: nums,
      batteryChargeKw: nums,
      batteryDischargeKw: nums,
      batterySocKwh: nums,
      evChargeKw: nums,
      applianceKw: z.record(z.string(), nums),
      servedLoadKw: nums,
      unservedKw: nums,
    })
    .nullable(),
  appliances: z.array(z.object({ id: z.string(), name: z.string(), startStep: z.number().nullable(), runSteps: z.array(z.number()), energyKwh: z.number() })),
  totals: z
    .object({
      importKwh: z.number(),
      exportKwh: z.number(),
      importCostInr: z.number(),
      exportRevenueInr: z.number(),
      wearCostInr: z.number(),
      netCostInr: z.number(),
      loadKwh: z.number(),
      pvKwh: z.number(),
      pvUsedKwh: z.number(),
      curtailedKwh: z.number(),
      batteryThroughputKwh: z.number(),
      batteryCycles: z.number(),
      evDeliveredKwh: z.number(),
      evShortfallKwh: z.number(),
      unservedKwh: z.number(),
      selfConsumptionRatio: z.number().nullable(),
      selfSufficiencyRatio: z.number().nullable(),
    })
    .nullable(),
  baseline: z.object({ description: z.string(), netCostInr: z.number(), importKwh: z.number(), exportKwh: z.number(), unservedKwh: z.number() }).nullable(),
  savingsInr: z.number().nullable(),
  decisions: z.array(
    z.object({
      step: z.number(),
      kind: z.enum(["charge_battery", "discharge_battery", "export", "curtail", "ev_charge", "appliance", "import_peak", "shed"]),
      kwh: z.number(),
      reason: z.string(),
    }),
  ),
  validation: z.object({ valid: z.boolean(), maxBalanceErrorKw: z.number(), problems: z.array(z.string()) }),
  notes: z.array(z.string()),
});
export type OptimiseResponse = z.infer<typeof OptimiseResponse>;

export const EngineHealth = z.object({ status: z.literal("ok"), version: z.string(), scipy: z.string(), highs: z.string(), modes: z.array(z.string()) });
export type EngineHealth = z.infer<typeof EngineHealth>;

// ------------------------------------------------------------------------- forecasting

export interface SolarForecastRequest {
  location: { latitude: number; longitude: number; altitudeM?: number };
  system: { capacityKwp: number; tiltDeg: number; azimuthDeg: number; lossFraction?: number; tempCoeffPerC?: number; inverterKw?: number | null };
  weather: HourlyWeather;
  errorHistory?: { weather: HourlyWeather; forecastGhiWm2: number[] } | null;
}

export interface HourlyWeather {
  startTime: string;
  convention?: "end" | "start";
  ghiWm2: number[];
  temperatureC: number[];
}

const BinStat = z.object({ name: z.string(), samples: z.number(), p10: z.number(), p50: z.number(), p90: z.number() });
export const BandCalibration = z.object({
  method: z.string(),
  hoursUsed: z.number(),
  bins: z.array(BinStat),
  medianResidualKt: z.number(),
  holdoutHours: z.number(),
  holdoutCoverage: z.number().nullable(),
  targetCoverage: z.number(),
});

export const SolarForecastResponse = z.object({
  times: z.array(z.string()),
  clearSkyKw: nums,
  p50Kw: nums,
  p10Kw: nums.nullable(),
  p90Kw: nums.nullable(),
  kwhP50: z.number(),
  kwhP10: z.number().nullable(),
  kwhP90: z.number().nullable(),
  kwhClearSky: z.number(),
  yieldKwhPerKwpP50: z.number(),
  calibration: BandCalibration.nullable(),
  assumptions: z.array(z.string()),
  notes: z.array(z.string()),
});
export type SolarForecastResponse = z.infer<typeof SolarForecastResponse>;

export interface SolarEvaluateRequest {
  forecastKw: number[];
  actualKw: number[];
  clearSkyKw?: number[] | null;
  minActualKw?: number;
}

export const Metrics = z.object({
  hours: z.number(),
  maeKw: z.number(),
  rmseKw: z.number(),
  mapePct: z.number().nullable(),
  wapePct: z.number().nullable(),
  biasKw: z.number(),
});
export type Metrics = z.infer<typeof Metrics>;

export const SolarEvaluateResponse = z.object({
  forecast: Metrics,
  persistenceBaseline: Metrics.nullable(),
  clearSky: Metrics.nullable(),
  skillVsPersistence: z.number().nullable(),
  skillVsClearSky: z.number().nullable(),
  notes: z.array(z.string()),
});
export type SolarEvaluateResponse = z.infer<typeof SolarEvaluateResponse>;

export interface LoadForecastRequest {
  history: { startTime: string; intervalMinutes: 15 | 30 | 60; kwh: (number | null)[] };
  horizonHours?: number;
  forecastStart?: string | null;
  timezoneOffsetMinutes?: number;
}

export const MethodScore = z.object({
  method: z.string(),
  description: z.string(),
  maeKw: z.number(),
  rmseKw: z.number(),
  wapePct: z.number().nullable(),
  biasKw: z.number(),
  coverage80: z.number().nullable(),
});

export const LoadForecastResponse = z.object({
  status: z.enum(["ok", "unavailable"]),
  unavailableReason: z.string().nullable(),
  times: z.array(z.string()),
  p10Kw: nums,
  p50Kw: nums,
  p90Kw: nums,
  kwhP50: z.number().nullable(),
  peakThresholdKw: z.number().nullable(),
  peakProbability: nums,
  selectedMethod: z.string().nullable(),
  methods: z.array(MethodScore),
  holdoutDays: z.number(),
  historyDays: z.number(),
  gapsShare: z.number(),
  assumptions: z.array(z.string()),
  notes: z.array(z.string()),
});
export type LoadForecastResponse = z.infer<typeof LoadForecastResponse>;
