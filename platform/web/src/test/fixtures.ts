import type { AdminAudit, AdminJobs, AdminOverview, Appliance, Today, Battery, Bill, CloudFront, Community, Control, ControlProposal, DemoWorld, ResilienceReport, EnergyDna, EnergyImport, CopilotAnswer, CopilotTools, EnergySummary, Ev, ForecastAccuracy, LoadForecast, Opportunities, Plan, PlanSummary, Property, Provenance, Scenario, ScenarioSummary, SolarForecast, SolarPerformance, SolarSystem, TariffPlan, VppSimulation } from "@/lib/types";

export const provenance = (over: Partial<Provenance> = {}): Provenance => ({
  status: "REFERENCE",
  source: "MSEDCL order",
  provider: "avishkar-tariffs",
  dataType: "tariff_plan",
  generatedAt: "2026-10-07T09:00:00.000Z",
  processingVersion: "api-0.1.0",
  notes: [],
  ...over,
});

/** MSEDCL LT II as recorded in data/tariffs/shop-pune.json: three time-of-day blocks and a per-connection fixed charge. */
export function tariffPlan(over: Partial<TariffPlan> = {}): TariffPlan {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    origin: "CURATED",
    name: "MSEDCL LT II 0-20 kW FY2025-26 (with ToD)",
    state: "MH",
    discom: "MSEDCL",
    category: "LT II (0-20 kW)",
    consumerType: "COMMERCIAL",
    touBlocks: [
      { startHour: 0, endHour: 9, rate: 7.84 },
      { startHour: 9, endHour: 17, rate: 6.52 },
      { startHour: 17, endHour: 24, rate: 9.49 },
    ],
    slabs: null,
    hourlyRates: [...Array(9).fill(7.84), ...Array(8).fill(6.52), ...Array(7).fill(9.49)],
    fixedCharge: { amountInr: 520, basis: "PER_CONNECTION_MONTH" },
    export: { rate: 3.5, basis: "ASSUMPTION", meteringMode: "UNKNOWN" },
    source: "MSEDCL LT II (0-20 kW) FY2025-26, MERC MYT order (Case 217/2024)",
    sourceUrl: null,
    tariffYear: "FY2025-26",
    effectiveFrom: null,
    effectiveTo: "2026-03-31",
    verifiedAt: null,
    validity: { status: "EXPIRED", message: "The source covers the period to 2026-03-31. A newer order has probably replaced it: check your latest bill or enter your current rates." },
    notes: ["The export rate is an assumption, not a figure from the order."],
    provenance: provenance({ notes: ["The export rate is an assumption: the source states none."] }),
    ...over,
  };
}

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const PROPERTY_ID = "22222222-2222-4222-8222-222222222222";

export function property(over: Partial<Property> = {}): Property {
  return {
    id: PROPERTY_ID,
    name: "Home",
    latitude: 12.9784,
    longitude: 77.6408,
    address: null,
    isDemo: false,
    position: { source: "manual", label: "Entered coordinates", note: "", accuracyM: null, description: "POSITION SOURCE: Entered coordinates, accuracy not reported" },
    geometry: { status: "UNAVAILABLE", message: "BUILDING GEOMETRY UNAVAILABLE: analysis uses the point location.", items: [] },
    tariffPlanId: null,
    warnings: [],
    createdAt: "2026-10-07T09:00:00.000Z",
    updatedAt: "2026-10-07T09:00:00.000Z",
    ...over,
  };
}

export const bill = (over: Partial<Bill> = {}): Bill => ({
  tariffId: "11111111-1111-4111-8111-111111111111",
  total: { value: 2884.38, unit: "INR", provenance: provenance({ status: "ESTIMATED", provider: "avishkar-tariff-engine", dataType: "monthly_bill" }) },
  energyCharge: { value: 2364.38, unit: "INR", provenance: provenance({ status: "ESTIMATED", provider: "avishkar-tariff-engine", dataType: "monthly_energy_charge" }) },
  fixedCharge: { value: 520, unit: "INR", provenance: provenance({ status: "ESTIMATED", provider: "avishkar-tariff-engine", dataType: "monthly_fixed_charge" }) },
  effectiveRateInrPerKwh: 9.6146,
  lines: [
    { label: "Energy at the usage-weighted time-of-day rate", kwh: 300, rate: 7.8813, amountInr: 2364.38 },
    { label: "Fixed charge", kwh: null, rate: null, amountInr: 520 },
  ],
  assumptions: ["Usage is assumed to be spread evenly over the 24 hours; a real profile changes the bill.", "Electricity duty, taxes and surcharges are not included."],
  validity: { status: "EXPIRED", message: "expired" },
  ...over,
});

type Handler = (req: { url: URL; method: string; body: unknown }) => Response | Promise<Response>;

/**
 * A fake API in front of `fetch`: routes are matched by method and path, and every call is recorded, so a test can assert the
 * exact request a component sent. An unmatched request fails the test loudly instead of returning something plausible.
 */
export function fakeApi(routes: [method: string, path: RegExp | string, handler: Handler][]) {
  const calls: { method: string; path: string; search: string; body: unknown }[] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input.toString(), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: url.pathname, search: url.search, body });
    const hit = routes.find(([m, p]) => m === method && (typeof p === "string" ? p === url.pathname : p.test(url.pathname)));
    if (!hit) throw new Error(`fakeApi: no route for ${method} ${url.pathname}`);
    return hit[2]({ url, method, body });
  };
  return { fetch: impl as typeof fetch, calls, called: (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path) };
}

const param = (value: number | null, basis: "USER_ENTERED" | "ASSUMPTION" | "PLANNER", note = "") => ({ value, basis, note });
const stamp = { propertyId: PROPERTY_ID, source: "USER_ENTERED" as const, createdAt: "2026-10-07T09:00:00.000Z", updatedAt: "2026-10-07T09:00:00.000Z" };

export function battery(over: Partial<Battery> = {}): Battery {
  return {
    id: "b1000000-0000-4000-8000-000000000001",
    ...stamp,
    name: "Garage battery",
    status: "EXISTING",
    capacityKwh: 10,
    maxChargeKw: 5,
    maxDischargeKw: 5,
    entered: { chargeEfficiency: null, dischargeEfficiency: null, minSoc: null, maxSoc: null, reserveSoc: null, maxCyclesPerDay: null, ratedCycles: null, wearInrPerKwh: null, currentSoc: null },
    effective: {
      chargeEfficiency: param(0.9487, "ASSUMPTION", "Round-trip 0.90 split evenly: the default of the AVISHKAR Python EMS."),
      dischargeEfficiency: param(0.9487, "ASSUMPTION"),
      minSoc: param(0.1, "ASSUMPTION"),
      maxSoc: param(1, "ASSUMPTION"),
      reserveSoc: param(null, "PLANNER", "Not set: the planner works the reserve out from your critical loads."),
      wearInrPerKwh: param(2, "ASSUMPTION"),
    },
    usableKwh: 9,
    currentSocAt: null,
    installedOn: null,
    notes: null,
    ...over,
  };
}

export function solarSystem(over: Partial<SolarSystem> = {}): SolarSystem {
  return {
    id: "50000000-0000-4000-8000-000000000001",
    ...stamp,
    name: "South roof",
    status: "EXISTING",
    capacityKwp: 3.3,
    tiltDeg: 15,
    azimuthDeg: 180,
    inverterKw: null,
    entered: { lossFraction: null },
    effective: { lossFraction: param(0.14, "ASSUMPTION") },
    installedOn: null,
    notes: null,
    ...over,
  };
}

export function ev(over: Partial<Ev> = {}): Ev {
  return {
    id: "e0000000-0000-4000-8000-000000000001",
    ...stamp,
    name: "Family car",
    batteryKwh: 40,
    chargerKw: 7.4,
    targetSoc: 0.8,
    currentSoc: null,
    currentSocAt: null,
    departureTime: "07:30",
    departureDays: [0, 1, 2, 3, 4],
    entered: { chargerEfficiency: null },
    effective: { chargerEfficiency: param(0.9, "ASSUMPTION", "A typical figure; no source recorded.") },
    notes: null,
    ...over,
  };
}

export function appliance(over: Partial<Appliance> = {}): Appliance {
  return {
    id: "a0000000-0000-4000-8000-000000000001",
    ...stamp,
    name: "Kitchen fridge",
    kind: "refrigerator",
    priority: "CRITICAL",
    ratedPowerW: 150,
    quantity: 1,
    totalRatedKw: 0.15,
    runtimeMinPerDay: null,
    schedule: null,
    flexibility: { earliestStart: null, latestFinish: null, durationMin: null, interruptible: false, windowMinutes: null },
    comfortNote: null,
    ...over,
  };
}

export function energyImport(over: Partial<EnergyImport> = {}): EnergyImport {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    filename: "meter.csv",
    uploadedAt: "2026-10-07T09:00:00.000Z",
    rows: 1344,
    accepted: 1344,
    rejected: 0,
    duplicates: 0,
    intervalMinutes: 15,
    usageColumn: "Energy (kWh)",
    unit: "kWh",
    from: "2026-03-01T18:30:00.000Z",
    to: "2026-03-15T18:15:00.000Z",
    rejectedByReason: {},
    gaps: { missingIntervals: 0, longestGapMinutes: 0 },
    notes: ["Each timestamp is taken as the start of its reading interval."],
    ...over,
  };
}

const est = (value: number | null, unit: string) =>
  value === null
    ? { value: null, unit, provenance: provenance({ status: "UNAVAILABLE", provider: "avishkar-energy-dna", notes: ["Fewer than two complete weekend days: one day is not a pattern."] }) }
    : { value, unit, provenance: provenance({ status: "ESTIMATED", provider: "avishkar-energy-dna", notes: ["Estimated: 14 complete days of your meter readings, 2026-03-01 to 2026-03-15"] }) };

export function energyDna(over: Partial<EnergyDna> = {}): EnergyDna {
  const hourly = Array.from({ length: 24 }, (_, h) => (h === 19 ? 2.5 : 1));
  return {
    id: "d0000000-0000-4000-8000-000000000001",
    version: 1,
    computedAt: "2026-10-07T09:00:00.000Z",
    period: { from: "2026-03-01T18:30:00.000Z", to: "2026-03-15T18:15:00.000Z", completeDays: 14, totalDays: 14, intervalMinutes: 15 },
    baseline: { meanDailyKwh: est(30.9, "kWh/day"), weekdayDailyKwh: est(24, "kWh/day"), weekendDailyKwh: est(48, "kWh/day"), baseloadKw: est(0.9, "kW"), peakKw: est(2.5, "kW"), peakHour: est(19, "hour of day") },
    patterns: { hourlyKw: hourly, weekdayHourlyKw: hourly, weekendHourlyKw: hourly.map((v) => v * 2), monthlyDailyKwh: { "2026-03": 30.9 } },
    unavailable: [{ what: "Weather sensitivity", reason: "needs a temperature history, which AVISHKAR does not ingest yet." }],
    ...over,
  };
}

export function energySummary(over: Partial<EnergySummary> = {}): EnergySummary {
  const days = Array.from({ length: 14 }, (_, i) => ({ date: `2026-03-${String(i + 2).padStart(2, "0")}`, kwh: 24, readings: 96, expectedReadings: 96, complete: true }));
  return {
    imports: [energyImport()],
    coverage: { observations: 1344, from: "2026-03-01T18:30:00.000Z", to: "2026-03-15T18:15:00.000Z", days: 14, intervalMinutes: 15 },
    dailyKwh: days,
    dna: energyDna(),
    dnaUnavailableReason: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------------------------------- forecasts

const prov = (over: Partial<Provenance> = {}) => provenance({ provider: "avishkar-engine", source: "AVISHKAR solar model (pvlib) driven by the Open-Meteo irradiance forecast", dataType: "solar_output_forecast", status: "FORECAST", modelVersion: "engine-0.1.0", ...over });

/** Two days of hourly values (UTC labels): a sun that peaks at 06-07 UTC, 80% / 120% around the central estimate. */
export function solarForecast(over: Partial<SolarForecast> = {}): SolarForecast {
  const hours = Array.from({ length: 48 }, (_, h) => {
    const hod = h % 24;
    const clear = hod >= 1 && hod <= 12 ? 4 * Math.sin(((hod - 0.5) / 12) * Math.PI) : 0;
    const p50 = clear * 0.7;
    return { time: new Date(Date.UTC(2026, 9, 7, h)).toISOString(), clearSkyKw: clear, p50Kw: p50, p10Kw: p50 * 0.8, p90Kw: p50 * 1.2 };
  });
  return {
    propertyId: PROPERTY_ID,
    generatedAt: "2026-10-07T09:00:00.000Z",
    systems: [{ id: "33333333-3333-4333-8333-333333333333", name: "Roof", status: "EXISTING", capacityKwp: 5, tiltDeg: 12, azimuthDeg: 180, lossFraction: 0.14, lossBasis: "ASSUMPTION" }],
    hours: { value: hours, unit: "kW", provenance: prov() },
    energy: { value: { kwhP50: 31.4, kwhP10: 25.1, kwhP90: 37.7, kwhClearSky: 44.9, yieldKwhPerKwpP50: 6.28 }, unit: "kWh", provenance: prov() },
    band: { available: true, reason: null, calibration: { method: "empirical", hoursUsed: 330, bins: [], medianResidualKt: 0, holdoutHours: 80, holdoutCoverage: 0.79, targetCoverage: 0.8 } },
    weather: { provider: "open-meteo", fetchedAt: "2026-10-07T08:55:00.000Z", stale: false, grid: { latitude: 12.97, longitude: 77.56 }, elevationM: 910 },
    assumptions: ["Fixed system losses of 14% (assumed)."],
    notes: [],
    ...over,
  };
}

export function solarPerformance(over: Partial<SolarPerformance> = {}): SolarPerformance {
  const m = (mae: number) => ({ hours: 672, maeKw: mae, rmseKw: mae * 1.4, mapePct: 22, wapePct: mae * 20, biasKw: 0.04 });
  return {
    propertyId: PROPERTY_ID,
    generatedAt: "2026-10-07T09:00:00.000Z",
    result: {
      value: { window: { from: "2026-09-09T00:00:00Z", to: "2026-10-07T06:00:00.000Z", hours: 672 }, forecast: m(0.3), persistenceBaseline: m(0.5), clearSky: m(0.9), skillVsPersistence: 0.4, skillVsClearSky: 0.67 },
      provenance: prov({ status: "ESTIMATED", dataType: "solar_forecast_skill", notes: ["Estimated: scored against analysis."] }),
    },
    basis: "A measure of the weather forecast, not of metered panel output.",
    notes: [],
    ...over,
  };
}

export function loadForecast(over: Partial<LoadForecast> = {}): LoadForecast {
  const hours = Array.from({ length: 24 }, (_, h) => {
    const p50 = 0.5 + (h >= 18 && h < 22 ? 2 : 0);
    return { time: new Date(Date.UTC(2026, 9, 7, h)).toISOString(), p10Kw: p50 * 0.8, p50Kw: p50, p90Kw: p50 * 1.3, peakProbability: h >= 18 && h < 22 ? 0.7 : 0.01 };
  });
  const lp = (over2: Partial<Provenance> = {}) => provenance({ provider: "avishkar-engine", source: "AVISHKAR load model on this property's own meter readings", dataType: "load_forecast", status: "FORECAST", ...over2 });
  return {
    propertyId: PROPERTY_ID,
    generatedAt: "2026-10-07T09:00:00.000Z",
    hours: { value: hours, unit: "kW", provenance: lp() },
    energy: { value: { kwhP50: 28.4 }, unit: "kWh", provenance: lp() },
    peakThresholdKw: 2.5,
    model: {
      selectedMethod: "same_hour_of_week",
      holdoutDays: 14,
      historyDays: 70,
      gapsShare: 0.01,
      methods: [
        { method: "same_hour_of_week", description: "Mean of the same hour of the week over up to the last 8 weeks", maeKw: 0.08, rmseKw: 0.11, wapePct: 6.2, biasKw: 0, coverage80: 0.81 },
        { method: "last_week", description: "The value at the same hour a week earlier", maeKw: 0.14, rmseKw: 0.2, wapePct: 11, biasKw: 0.01, coverage80: 0.79 },
      ],
    },
    history: { from: "2026-07-30T00:00:00Z", to: "2026-10-07T00:00:00.000Z", intervalMinutes: 60, readingsUsed: 1680, readingsOtherInterval: 0, readingsOffGrid: 0, emptyIntervals: 12, dataEndsDaysAgo: 0.4 },
    assumptions: [],
    notes: [],
    ...over,
  };
}

// ----------------------------------------------------------------------------------------------------------- plans

/** A 24 hour plan from 16:00 IST (10:30 UTC): charge the battery on cheap night power and use it in the dear evening. */
export function plan(over: Partial<Plan> = {}): Plan {
  const start = Date.UTC(2026, 9, 7, 10, 30);
  const steps = 24;
  const times = Array.from({ length: steps }, (_, i) => new Date(start + i * 3_600_000).toISOString());
  const hourIst = (i: number) => (16 + i) % 24;
  const night = (i: number) => hourIst(i) < 6;
  const evening = (i: number) => hourIst(i) >= 18 && hourIst(i) < 22;
  const zeros = () => Array.from({ length: steps }, () => 0);
  const p = provenance({ provider: "avishkar-engine", source: "AVISHKAR planner (linear programme, HiGHS) on forecast inputs", dataType: "energy_plan_outcome", status: "SIMULATED", modelVersion: "engine-0.1.0", notes: ["Baseline: the same day with no control.", "An outcome of the plan on forecast inputs, not a measurement; the real day will differ."] });
  return {
    id: "44444444-4444-4444-8444-444444444444",
    propertyId: PROPERTY_ID,
    createdAt: "2026-10-07T10:10:00.000Z",
    mode: "BALANCED",
    modeWeights: { importCost: 1, exportRevenue: 1, importEnergyPenalty: 1, backupReserve: 0 },
    horizon: { start: times[0]!, stepHours: 1, steps },
    schedule: {
      times,
      loadKw: Array.from({ length: steps }, (_, i) => (evening(i) ? 2.5 : 0.5)),
      pvForecastKw: Array.from({ length: steps }, (_, i) => (i < 2 ? 1.2 : 0)),
      pvUsedKw: Array.from({ length: steps }, (_, i) => (i < 2 ? 1.2 : 0)),
      pvCurtailedKw: zeros(),
      gridImportKw: Array.from({ length: steps }, (_, i) => (night(i) ? 3 : i < 2 ? 0 : 0.5)),
      gridExportKw: zeros(),
      batteryChargeKw: Array.from({ length: steps }, (_, i) => (night(i) ? 2.5 : 0)),
      batteryDischargeKw: Array.from({ length: steps }, (_, i) => (evening(i) ? 2 : 0)),
      batterySocKwh: Array.from({ length: steps }, (_, i) => (night(i) ? Math.min(9, 1 + 2.5 * (i - 7)) : evening(i) ? 4 : 2)),
      evChargeKw: zeros(),
      applianceKw: { washer: Array.from({ length: steps }, (_, i) => (i === 1 ? 2 : 0)) },
      importPrice: Array.from({ length: steps }, (_, i) => (night(i) ? 4 : evening(i) ? 10 : 6)),
      exportPrice: Array.from({ length: steps }, () => 3),
    },
    result: {
      value: { netCostInr: 41.2, baselineNetCostInr: 52.9, savingsInr: 11.7, importKwh: 21.5, exportKwh: 0, loadKwh: 28, pvKwh: 2.4, pvUsedKwh: 2.4, curtailedKwh: 0, batteryCycles: 0.7, unservedKwh: 0, evShortfallKwh: 0, selfConsumptionRatio: 1, selfSufficiencyRatio: 0.3 },
      unit: "INR",
      provenance: p,
    },
    appliances: [{ id: "washer", name: "Washer", startTime: times[1]!, runHours: 2, energyKwh: 4 }],
    decisions: Array.from({ length: 12 }, (_, i) => ({ time: times[8 + i]!, kind: i < 6 ? "charge_battery" : "discharge_battery", kwh: 2.5, reason: i < 6 ? "Charge now at INR 4.00 per kWh: it avoids buying later at INR 10.00." : "Use the battery now: buying would cost INR 10.00 per kWh." })),
    inputs: {
      tariff: { id: "55555555-5555-4555-8555-555555555555", name: "Test ToD", validity: "OPEN_ENDED", exportRate: 3, exportBasis: "USER_ENTERED" },
      load: { basis: "FORECAST", note: "The load forecast from your meter readings (method: same_hour_of_week)." },
      solar: { systems: 1, note: "The solar forecast's central estimate, resampled to local hours." },
      battery: { capacityKwh: 10, usableKwh: 9, maxChargeKw: 5, maxDischargeKw: 5, startSocKwh: 1, startSocBasis: "ASSUMPTION", reserveKwh: null },
      ev: null,
      criticalKw: 0,
    },
    recommendation: {
      headline: "Use the battery from 16:00: 2 kWh before 19:00.",
      kind: "USE_BATTERY",
      why: ["discharged at 18:00 to avoid importing at INR 10.00 per kWh"],
      dataUsed: ["Tariff: Test ToD (in force, no end date)", "Load: The load forecast from your meter readings (method: same_hour_of_week).", "Sun: The solar forecast's central estimate, resampled to local hours.", "Battery: 9 kWh usable, starting at 1 kWh (assumed)"],
      assumptions: ["The battery's charge now is not known, so the plan assumes it starts at its minimum level (1 kWh)."],
      expectedBenefit: { savingsInr: 11.7, basis: "The whole 24-hour plan against the same hours with no control, not this move alone. A forecast, not a promise." },
      confidence: {
        assessed: true,
        agreeing: 3,
        total: 4,
        statement: "Less steady: the planner gives the same advice for the next 3 hours in 3 of 4 forecasts tried. It changes if the sun or the demand lands at the edge of its band.",
        scenarios: [
          { label: "The forecast as it is (central estimate)", agrees: true, chargeKwh: 0, dischargeKwh: 2, moves: ["idle", "idle", "discharge"] },
          { label: "Less sun than forecast (10th percentile)", agrees: true, chargeKwh: 0, dischargeKwh: 2, moves: ["idle", "idle", "discharge"] },
          { label: "More sun than forecast (90th percentile)", agrees: false, chargeKwh: 1.2, dischargeKwh: 0.8, moves: ["charge", "idle", "discharge"] },
          { label: "More demand than forecast (90th percentile)", agrees: true, chargeKwh: 0, dischargeKwh: 2.4, moves: ["idle", "idle", "discharge"] },
        ],
      },
    },
    assumptions: ["The battery's charge now is not known, so the plan assumes it starts at its minimum level (1 kWh).", "No outage information is available, so none is planned for; the battery reserve you set is held back."],
    solver: { status: "optimal", seconds: 0.03, integerVariables: 2 },
    validation: { valid: true, maxBalanceErrorKw: 0, problems: [] },
    notes: [],
    ...over,
  };
}

export function forecastAccuracy(over: Partial<ForecastAccuracy> = {}): ForecastAccuracy {
  const scores = (mae: number, bias: number) => ({ hours: 24, maeKw: mae, rmseKw: mae * 1.3, wapePct: 14, biasKw: bias, coverage80: 0.79, lastWeek: { hours: 24, maeKw: 0.3, modelMaeKw: mae }, skillVsLastWeek: 1 - mae / 0.3 });
  const p = provenance({ provider: "avishkar-learning", source: "Stored forecasts scored against this property's own meter readings", dataType: "load_forecast_accuracy", status: "ESTIMATED", notes: ["Estimated: the average over the 2 stored forecast(s) that could be scored."] });
  return {
    propertyId: PROPERTY_ID,
    generatedAt: "2026-10-09T10:00:00.000Z",
    load: {
      runs: [
        { id: "77777777-7777-4777-8777-777777777771", issuedAt: "2026-10-09T09:00:00.000Z", firstHour: "2026-10-09T10:30:00.000Z", hours: 24, model: "load:same_hour_of_week", status: "WAITING", reason: "The meter data does not yet cover these hours. Import newer readings and it is scored.", scores: null },
        { id: "77777777-7777-4777-8777-777777777772", issuedAt: "2026-10-07T09:00:00.000Z", firstHour: "2026-10-07T10:30:00.000Z", hours: 24, model: "load:same_hour_of_week", status: "SCORED", reason: null, scores: scores(0.15, -0.05) },
        { id: "77777777-7777-4777-8777-777777777773", issuedAt: "2026-10-05T09:00:00.000Z", firstHour: "2026-10-05T10:30:00.000Z", hours: 24, model: "load:same_hour_of_week", status: "SCORED", reason: null, scores: scores(0.21, -0.09) },
        { id: "77777777-7777-4777-8777-777777777774", issuedAt: "2026-10-03T09:00:00.000Z", firstHour: "2026-10-03T10:30:00.000Z", hours: 24, model: "load:last_week", status: "NOT_SCORABLE", reason: "Fewer than 12 of its 24 hours have a complete meter reading, so there is not enough to score it against.", scores: null },
      ],
      summary: { value: { scored: 2, meanMaeKw: 0.18, meanBiasKw: -0.07, meanCoverage80: 0.79, meanSkillVsLastWeek: 0.4 }, provenance: p },
    },
    solar: { available: false, reason: "Solar forecasts are scored against the weather model's analysis, not against generation: there is no generation meter in the data to score them against." },
    notes: [],
    ...over,
  };
}

export function community(over: Partial<Community> = {}): Community {
  const sim = provenance({ status: "SIMULATED", provider: "avishkar-community", dataType: "community_simulation", notes: ["Simulated result, not a measurement."] });
  return {
    label: "COMMUNITY ENERGY SIMULATION",
    month: 10,
    dayType: "weekday",
    members: [
      { propertyId: PROPERTY_ID, name: "Sunny", latitude: 12.97, longitude: 77.59, status: "SURPLUS", reason: null, loadKwhPerDay: 20, solarKwhPerDay: 21.6, surplusKwhPerDay: 14.2, deficitKwhPerDay: 12.6, solarKwp: 5, batteryUsableKwh: 9, shiftableKw: 0, vehicleChargerKw: 0 },
      { propertyId: "99999999-9999-4999-8999-999999999999", name: "Shady", latitude: 12.98, longitude: 77.6, status: "DEFICIT", reason: null, loadKwhPerDay: 20, solarKwhPerDay: 0, surplusKwhPerDay: 0, deficitKwhPerDay: 20, solarKwp: 0, batteryUsableKwh: 0, shiftableKw: 2, vehicleChargerKw: 0 },
      { propertyId: "88888888-8888-4888-8888-888888888881", name: "Blank", latitude: 12.99, longitude: 77.61, status: "NO_DATA", reason: "No meter readings have been imported for this property, so its daily pattern is not known.", loadKwhPerDay: null, solarKwhPerDay: 0, surplusKwhPerDay: null, deficitKwhPerDay: null, solarKwp: 0, batteryUsableKwh: 0, shiftableKw: 0, vehicleChargerKw: 0 },
    ],
    totals: { value: { properties: 2, loadKwhPerDay: 40, solarKwhPerDay: 21.6, surplusKwhPerDay: 14.2, deficitKwhPerDay: 32.6, shareableKwhPerDay: 6.3, storageUsableKwh: 9, shiftableKw: 2, vehicleChargerKw: 0 }, provenance: sim },
    hourly: { hours: Array.from({ length: 24 }, (_, h) => h), loadKw: Array.from({ length: 24 }, () => 1.7), solarKw: Array.from({ length: 24 }, (_, h) => (h >= 6 && h < 18 ? 3.2 : 0)), shareableKw: Array.from({ length: 24 }, (_, h) => (h >= 6 && h < 18 ? 0.5 : 0)) },
    notes: ["This is a simulation over properties you own. AVISHKAR does not move electricity between properties and says nothing about whether that is allowed.", "Only properties your account owns appear here. Nothing about anyone else's is shown."],
    ...over,
  };
}

export function vppSimulation(over: Partial<VppSimulation> = {}): VppSimulation {
  return {
    label: "VIRTUAL POWER PLANT SIMULATION",
    isDemo: false,
    request: { homes: 100 },
    month: 10,
    dayType: "weekday",
    archetype: { propertyId: PROPERTY_ID, name: "Home", tariff: "Test ToD" },
    fleet: { homes: 100, withSolar: 31, withBattery: 3, withVehicle: 4, solarKwp: 93.4, batteryKwh: 15.2, evChargerKw: 13.2, shiftableKwhPerDay: 300 },
    result: {
      value: { solarKwhPerDay: 402.6, loadKwhPerDay: 2038.1, peakImportBeforeKw: 262.4, peakImportBeforeHour: 18, peakImportAfterKw: 223.1, peakImportAfterHour: 19, peakReductionPercent: 15, peakExportBeforeKw: 41.5, peakExportAfterKw: 38, importKwhBefore: 1790, importKwhAfter: 1795, solarUsedLocallyBefore: 0.7, solarUsedLocallyAfter: 0.74, solarCurtailedKwhAfter: 0, selfSufficiencyBefore: 0.12, selfSufficiencyAfter: 0.12, costBeforeInr: 16_100, costAfterInr: 15_050, savingsInr: 1050, batteryCycles: 0.9 },
      provenance: provenance({ status: "SIMULATED", provider: "avishkar-vpp", dataType: "vpp_simulation", notes: ["A simulation of synthetic homes, not a measurement of any real ones."] }),
    },
    hourly: { hours: Array.from({ length: 24 }, (_, h) => h), loadKw: Array.from({ length: 24 }, () => 85), solarKw: Array.from({ length: 24 }, (_, h) => (h >= 6 && h < 18 ? 40 : 0)), importBeforeKw: Array.from({ length: 24 }, () => 75), importAfterKw: Array.from({ length: 24 }, () => 72), batteryKwh: Array.from({ length: 24 }, () => 8) },
    assumptions: ["Every home is synthetic. Each is a draw from the shares and sizes you chose (the defaults are assumptions, not data).", "This is a simulation of a fleet. AVISHKAR does not coordinate real homes."],
    notes: [],
    ...over,
  };
}

export function copilotTools(over: Partial<CopilotTools> = {}): CopilotTools {
  return {
    tools: [
      { name: "getLatestPlan", description: "The most recent plan as it was shown.", writes: false },
      { name: "runOptimization", description: "Make a new plan and store it.", writes: true },
    ],
    questions: ["How much will I save?", "Which tariff am I on?"],
    languageModel: false,
    ...over,
  };
}

export function copilotAnswer(over: Partial<CopilotAnswer> = {}): CopilotAnswer {
  return {
    question: "How much will I save?",
    intent: "SAVINGS",
    status: "ANSWERED",
    paragraphs: ["The latest plan (balanced, made 7 Oct) is expected to cost ₹41.20 over 24 hours against ₹52.90 with no control: it saves ₹11.70 [1].", "That is a simulated outcome of forecasts, not a measurement."],
    citations: [{ marker: 1, toolResultId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", tool: "getLatestPlan" }],
    toolResults: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", tool: "getLatestPlan", input: {}, output: { netCostInr: 41.2, noControlCostInr: 52.9, savingsInr: 11.7 }, status: "OK", unavailableReason: null, dataStatus: "SIMULATED", calledAt: "2026-10-08T10:00:00.000Z" }],
    generatedBy: "TEMPLATES",
    notes: [],
    suggestions: [],
    ...over,
  };
}

export function opportunities(over: Partial<Opportunities> = {}): Opportunities {
  const p = provenance({ status: "ESTIMATED", provider: "avishkar-opportunities", dataType: "opportunity", notes: [] });
  return {
    propertyId: PROPERTY_ID,
    generatedAt: "2026-10-08T10:00:00.000Z",
    items: [
      { id: "battery-10", kind: "ADD_BATTERY", title: "Install a 10 kWh battery", detail: "Saves about ₹10,900 a year by moving cheap or free energy into the dear hours.", annualSavingsInr: 10_900, breakEven: { totalInr: 103_000, perUnitInr: 10_300, unit: "kWh", basis: "the present value of the saving over 20 years at 8% a year" }, provenance: p, scenario: { addBatteryKwh: 10 }, href: "/what-if" },
      { id: "solar-3", kind: "ADD_SOLAR", title: "Install 3 kWp of solar", detail: "Saves about ₹14,300 a year.", annualSavingsInr: 14_300, breakEven: { totalInr: 135_600, perUnitInr: 45_200, unit: "kWp", basis: "x" }, provenance: p, scenario: { addSolarKwp: 3 }, href: "/what-if" },
      { id: "data-battery-charge", kind: "PROVIDE_DATA", title: "Enter your battery's charge", detail: "The plan assumes the battery starts at its reserve level when it does not know its charge.", annualSavingsInr: null, breakEven: null, provenance: provenance({ status: "REFERENCE", notes: [] }), scenario: null, href: "/assets" },
    ],
    checked: [{ title: "Switch to Flat 14", annualSavingsInr: -4_200 }, { title: "Add a 5 kWh battery", annualSavingsInr: 60 }],
    notes: ["These are a few example sizes, not a recommendation: AVISHKAR has no price list."],
    ...over,
  };
}

export function scenario(over: Partial<Scenario> = {}): Scenario {
  const month = (m: number, cost: number, imp: number, pv: number) => ({ month: m, days: 30, netCostInr: cost, importKwh: imp, exportKwh: 0, pvKwh: pv, loadKwh: 600 });
  const annual = (cost: number, imp: number, pv: number) => ({
    gridOnlyCostInr: 57_670,
    uncontrolledCostInr: cost + 2_000,
    netCostInr: cost,
    importKwh: imp,
    exportKwh: 0,
    loadKwh: 7_300,
    pvKwh: pv,
    pvUsedKwh: pv,
    selfConsumptionRatio: pv > 0 ? 1 : null,
    selfSufficiencyRatio: 1 - imp / 7_300,
    batteryCycles: 0,
    months: Array.from({ length: 12 }, (_, i) => month(i + 1, cost / 12, imp / 12, pv / 12)),
  });
  const p = provenance({ provider: "avishkar-scenarios", source: "AVISHKAR typical-year simulation", dataType: "scenario_comparison", status: "ESTIMATED", notes: ["Estimated: typical days from your own readings and the monthly solar climatology: an estimate for a typical year, not a forecast of any particular one."] });
  const econ = (payback: number) => ({
    paybackYears: payback,
    discountedPaybackYears: payback + 1.5,
    npvInr: 118_400,
    irrPercent: 13.4,
    netGainInr: 210_000,
    cashflows: Array.from({ length: 20 }, (_, i) => ({ year: i + 1, savingsInr: 33_000, cumulativeInr: -250_000 + 33_000 * (i + 1), discountedCumulativeInr: -250_000 + 20_000 * (i + 1) })),
  });
  return {
    id: "88888888-8888-4888-8888-888888888888",
    propertyId: PROPERTY_ID,
    createdAt: "2026-10-08T10:00:00.000Z",
    name: "Add 5 kWp solar",
    request: { addSolarKwp: 5, costs: { solarInrPerKwp: 50_000 } },
    equipment: { base: { solarKwp: 0, batteryKwh: 0, tariff: "Test ToD" }, scenario: { solarKwp: 5, batteryKwh: 0, tariff: "Test ToD" } },
    base: annual(57_670, 7_300, 0),
    scenario: annual(24_400, 2_900, 7_800),
    comparison: { value: { annualSavingsInr: 33_270, savingsPercent: 57.7, importKwhChange: -4_400, exportKwhChange: 0, selfSufficiencyChange: 0.6 }, unit: "INR", provenance: p },
    investment: { value: { totalInr: 250_000, solarInr: 250_000, batteryInr: 0, otherInr: 0 }, unit: "INR", provenance: provenance({ status: "REFERENCE", provider: "avishkar-scenarios", notes: ["Entered by you, from a quote; AVISHKAR has not checked it."] }) },
    subsidy: { value: 78_000, unit: "INR", provenance: provenance({ status: "ESTIMATED", provider: "avishkar-policy-engine", notes: [] }) },
    economics: { value: econ(7.5), provenance: p },
    economicsIfSubsidised: { value: econ(5.2), provenance: p },
    carbon: { value: null, provenance: provenance({ status: "UNAVAILABLE", provider: "avishkar-scenarios", notes: ["No grid emission factor is built in: a sourced figure for your region has not been loaded. Enter your utility's or a published factor to see the carbon change."] }) },
    economicsAssumptions: { years: 20, discountRatePercent: 8, tariffEscalationPercent: 0, degradationPercent: 0.5 },
    assumptions: ["A year is one typical weekday and one typical weekend day for each month, planned hour by hour for the lowest bill, then weighted by how many such days the next 12 months have.", "The added panels face south (180 degrees); you did not give a direction."],
    notes: [],
    ...over,
  };
}

export function scenarioSummary(over: Partial<ScenarioSummary> = {}): ScenarioSummary {
  return { id: "88888888-8888-4888-8888-888888888888", createdAt: "2026-10-08T10:00:00.000Z", name: "Add 5 kWp solar", annualSavingsInr: 33_270, addSolarKwp: 5, addBatteryKwh: null, tariffChanged: false, ...over };
}

export function planSummary(over: Partial<PlanSummary> = {}): PlanSummary {
  return { id: "44444444-4444-4444-8444-444444444444", createdAt: "2026-10-07T10:10:00.000Z", mode: "BALANCED", startsAt: "2026-10-07T10:30:00.000Z", steps: 24, netCostInr: 41.2, baselineNetCostInr: 52.9, savingsInr: 11.7, ...over };
}

export function demoWorld(over: Partial<DemoWorld> = {}): DemoWorld {
  const site = (key: string, name: string, city: string, propertyId: string | null, tariff: string | null) => ({ key, name, city, latitude: 20, longitude: 77, story: `${name} story.`, propertyId, tariff });
  return {
    label: "DEMO DATA",
    loaded: false,
    sites: [
      site("bengaluru-home", "Demo home, Bengaluru", "Bengaluru", null, null),
      site("pune-shop", "Demo shop, Pune", "Pune", null, null),
      site("jaipur-clinic", "Demo clinic, Jaipur", "Jaipur", null, null),
      site("mathura-home", "Demo home, Mathura", "Mathura", null, null),
    ],
    notes: ["DEMO DATA: the meter readings, the equipment and the Bengaluru tariff are invented."],
    ...over,
  };
}

export function cloudFront(over: Partial<CloudFront> = {}): CloudFront {
  const times = Array.from({ length: 24 }, (_, i) => new Date(Date.parse("2026-10-07T10:30:00Z") + i * 3_600_000).toISOString());
  const sun = (i: number) => (i < 2 ? [2.4, 0.8][i]! : 0);
  return {
    label: "CLOUD FRONT SCENARIO",
    request: { arrivalMinutes: 38, reductionPercent: 22, durationHours: 3, mode: "BALANCED" },
    madeAt: "2026-10-07T10:10:00.000Z",
    horizon: { start: times[0]!, stepHours: 1, steps: 24 },
    hourly: {
      times,
      solarKw: times.map((_, i) => sun(i)),
      solarWithFrontKw: times.map((_, i) => sun(i) * (i === 0 ? 0.846 : 0.78)),
      loadKw: times.map(() => 1),
      batteryChargeKw: times.map((_, i) => (i < 2 ? 1.5 : 0)),
      batteryChargeUnawareKw: times.map(() => 0),
      batterySocKwh: times.map(() => 4),
      gridImportKw: times.map(() => 0.9),
      gridImportUnawareKw: times.map(() => 0.8),
    },
    result: {
      value: {
        solarNowKw: 5.4,
        frontArrivesAt: "2026-10-07T16:18:00+05:30",
        frontEndsAt: "2026-10-07T19:18:00+05:30",
        reductionPercent: 22,
        solarLostKwh: 0.55,
        solarLostPercentOfDay: 17.2,
        batteryNowPercent: 42,
        batteryNowBasis: "ASSUMPTION",
        eveningDemand: { level: "HIGH", eveningMeanKw: 2.5, meanKw: 0.9, ratio: 2.78, rule: "HIGH at 1.25 times the daily mean or more, LOW below 0.9." },
        advice: { code: "CHARGE_NOW", text: "Charge the battery now: knowing the front is coming, the plan stores 3 kWh more before and during it than it would otherwise.", extraChargeKwh: 3, extraHeldKwh: 0 },
        without: { importKwh: 21.5, netCostInr: 160.5 },
        with: { importKwh: 22.2, netCostInr: 140.25 },
        difference: { importKwh: -0.7, savingsInr: 20.25 },
        onForecastSky: { withoutNetCostInr: 156.4, withNetCostInr: 139.05 },
        frontCost: { withoutAvishkarInr: 4.1, withAvishkarInr: 1.2 },
      },
      provenance: provenance({ status: "SIMULATED", provider: "avishkar-engine", dataType: "cloud_front_scenario", notes: ["A scenario: the front is assumed, and the sun now is the forecast's value for this hour, not a measurement. The real day will differ."] }),
    },
    assumptions: ["The front is a scenario you set, not an observation: AVISHKAR has no cloud-nowcast source (a satellite that returns every few days cannot see a front minutes away).", "Another assumption."],
    notes: [],
    ...over,
  };
}

export function resilienceReport(over: Partial<ResilienceReport> = {}): ResilienceReport {
  const sim = (dataType: string, notes: string[] = []) => provenance({ status: "SIMULATED", provider: "avishkar-resilience", dataType, notes });
  return {
    label: "RESILIENCE AND AUTONOMY",
    request: { targetHours: 4, startSocPercent: null },
    madeAt: "2026-10-07T10:10:00.000Z",
    outageRisk: { status: "UNAVAILABLE", reason: "Grid outage risk is unavailable: no outage or grid-reliability data source exists, and none is invented. The figures use the weather and the battery only." },
    resilience: {
      value: {
        criticalKw: 1,
        criticalLoads: [{ name: "Fridge", quantity: 2, ratedPowerW: 500, kw: 1 }],
        battery: { usableKwh: 9, startSocKwh: 1, startSocBasis: "ASSUMPTION", reserveKwh: null },
        backupHours: { withForecastSun: 4.7, atLeast: false, withoutSun: 4.7 },
        score: 20,
        scoreMethod: "Score = 100 x the hours the critical load is served if the grid fails at the start of the next hour, counted up to 24, divided by 24.",
        recommendedReserve: { targetHours: 4, reserveKwh: 5.22, reservePercentOfCapacity: 52, currentReserveKwh: 1, gapKwh: 4.22, feasible: true, longestPossibleHours: 8.5 },
      },
      provenance: sim("resilience", ["A calculation on forecast sun and the battery's charge as entered or assumed, not a measurement of any outage."]),
    },
    autonomy: {
      value: { score: 24, methodology: "Autonomy = 100 x (1 - energy bought from the grid / energy used), over the hours of your latest plan.", parts: { consumedKwh: 28, solarUsedKwh: 2.4, batteryReleasedKwh: 8, boughtKwh: 21.5, gridDependencyPercent: 77 }, criticalCoverageHours: 4.7, planId: "44444444-4444-4444-8444-444444444444", planMadeAt: "2026-10-07T10:10:00.000Z" },
      provenance: sim("autonomy"),
    },
    assumptions: ["No outage is predicted.", "The critical load is the rated power of each CRITICAL appliance."],
    notes: [],
    ...over,
  };
}

const yes = { allowed: true, reason: null };
const no = (reason: string) => ({ allowed: false, reason });

export function proposal(over: Partial<ControlProposal> = {}): ControlProposal {
  return {
    id: "c1000000-0000-4000-8000-000000000001",
    planId: "44444444-4444-4444-8444-444444444444",
    createdAt: "2026-10-07T10:10:00.000Z",
    kind: "BATTERY_CHARGE",
    startsAt: "2026-10-07T20:30:00.000Z",
    endsAt: "2026-10-07T23:30:00.000Z",
    command: { avgKw: 2, peakKw: 3, kwh: 6 },
    reason: "charged from the grid at INR 4.00 per kWh, ahead of the INR 10.00 per kWh peak",
    state: "PROPOSED",
    decidedAt: null,
    decidedBy: null,
    decisionNote: null,
    result: null,
    safety: { ok: true, checks: [{ check: "device power limit", ok: true, detail: "3 kW against the battery's own 5 kW." }] },
    can: { approve: yes, reject: yes, withdraw: no("Only an approved move that has not started can be withdrawn."), rollback: no("Only an applied move, or an approved one that has started, can be rolled back.") },
    ...over,
  };
}

export function control(over: Partial<Control> = {}): Control {
  const modes = [
    { mode: "OBSERVE" as const, label: "Observe", meaning: "AVISHKAR watches and explains. It proposes no moves.", available: true, unavailableReason: null },
    { mode: "RECOMMEND" as const, label: "Recommend", meaning: "AVISHKAR shows the moves the plan would make as advice.", available: true, unavailableReason: null },
    { mode: "APPROVE" as const, label: "Approve", meaning: "Each move waits for your decision.", available: true, unavailableReason: null },
    { mode: "AUTOMATE" as const, label: "Automate", meaning: "Moves inside your safety limits are made without asking.", available: false, unavailableReason: "No device is connected to AVISHKAR, so there is nothing for it to act on." },
  ];
  return {
    mode: "APPROVE",
    modeMeaning: "Each move waits for your decision.",
    limits: { maxChargeKw: null, maxDischargeKw: null, minSocPercent: null },
    automateUntil: null,
    updatedAt: null,
    executor: { name: "none", available: false, message: "No device is connected to AVISHKAR, so there is nothing for it to act on." },
    modes,
    proposals: [proposal()],
    ...over,
  };
}

export function adminOverview(over: Partial<AdminOverview> = {}): AdminOverview {
  return {
    generatedAt: "2026-10-08T10:00:00.000Z",
    users: { total: 12, admins: 1, joinedLast7Days: 3 },
    properties: { total: 20, demo: 4, withMeterData: 9, withTariff: 11, withSolar: 6, withBattery: 3 },
    dataHealth: { meterDataStale: 2, forecastsAwaitingScore: 5, forecastsScored: 30, forecastsNotScorable: 4, propertiesOnExpiredTariff: 2 },
    catalogue: {
      tariffs: [
        { id: "a1000000-0000-4000-8000-000000000001", name: "UPPCL LMV-1 FY2025-26", state: "UP", discom: "UPPCL", category: "LMV-1 urban domestic", validity: "EXPIRED", validityMessage: "The source covers the period to 2026-03-31.", verifiedAt: "2026-10-07T00:00:00.000Z", source: "UPERC tariff order", sourceUrl: "https://example.org/order", propertiesUsing: 2 },
        { id: "a1000000-0000-4000-8000-000000000002", name: "Rajasthan NDS 2025", state: "RJ", discom: null, category: "NDS", validity: "OPEN_ENDED", validityMessage: "In force from 2025-10-01.", verifiedAt: null, source: "RERC schedule", sourceUrl: null, propertiesUsing: 0 },
      ],
      policyRules: [{ id: "b1000000-0000-4000-8000-000000000001", program: "PM_SURYA_GHAR", ruleKey: "residential_cfa", region: "IN", appliesTo: "RESIDENTIAL", source: "National Portal for Rooftop Solar", sourceUrl: null, verifiedAt: "2026-10-07T00:00:00.000Z", effectiveFrom: null, effectiveTo: null }],
    },
    models: {
      engine: { state: "healthy", version: "0.1.0", solver: "HiGHS 1.9", error: null },
      forecastRuns: [{ kind: "LOAD", model: "same_hour_of_week", engineVersion: "0.1.0", runs: 17 }],
      planRunsByEngineVersion: { "0.1.0": 41 },
    },
    usageLast7Days: { "plan.create": 41, "copilot.ask": 12 },
    providers: [
      { provider: "open-meteo", state: "healthy", calls: 30, failures: 0, p95Ms: 420, lastError: null },
      { provider: "overpass", state: "degraded", calls: 6, failures: 2, p95Ms: 9000, lastError: "overpass answered HTTP 504" },
    ],
    ...over,
  };
}

export function adminJobs(over: Partial<AdminJobs> = {}): AdminJobs {
  const run = { id: "d1000000-0000-4000-8000-000000000001", job: "weather-refresh", trigger: "SCHEDULE" as const, startedAt: "2026-10-08T09:00:00.000Z", finishedAt: "2026-10-08T09:00:04.000Z", status: "OK" as const, seconds: 4, summary: { places: 3, ok: 3, failed: 0 }, error: null };
  return {
    schedulerEnabled: true,
    jobs: [
      { name: "weather-refresh", description: "Fetches the weather forecast for each place with a saved property.", everyMinutes: 60, retryMinutes: 15, dueInSeconds: 1800, recent: [run] },
      { name: "tariff-validity", description: "Counts the tariff plans whose published period has ended.", everyMinutes: 1440, retryMinutes: 60, dueInSeconds: 0, recent: [] },
    ],
    ...over,
  };
}

export function adminAudit(over: Partial<AdminAudit> = {}): AdminAudit {
  return {
    entries: [
      { id: "212", createdAt: "2026-10-08T09:30:00.000Z", action: "admin.audit.read", user: "admin@example.com", entityType: null, entityId: null, requestId: "req-1", ip: "10.0.0.1", detail: { action: null } },
      { id: "211", createdAt: "2026-10-08T09:20:00.000Z", action: "plan.create", user: "someone@example.com", entityType: "property", entityId: "p1", requestId: "req-2", ip: "10.0.0.2", detail: null },
    ],
    next: "211",
    ...over,
  };
}

export function today(over: Partial<Today> = {}): Today {
  const f = (dataType: string, status: "FORECAST" | "ESTIMATED" | "SIMULATED" = "FORECAST", notes: string[] = []) => provenance({ status, provider: "avishkar-today", dataType, notes });
  return {
    label: "TODAY",
    propertyId: PROPERTY_ID,
    madeAt: "2026-10-08T10:00:00.000Z",
    localDate: "2026-10-08",
    generation: { value: { kwh: 21.4, hoursCovered: 24, forecastIssuedAt: "2026-10-08T05:00:00.000Z" }, unit: "kWh", provenance: f("solar_energy_today") },
    consumption: { value: { kwh: 28.2, hoursCovered: 24, basis: "FORECAST" }, unit: "kWh", provenance: f("load_energy_today") },
    surplus: { value: { kwh: 9.6, note: "Over the 24 hours of today for which both the solar forecast and the use are known." }, unit: "kWh", provenance: f("solar_surplus_today") },
    weatherRisk: { value: { level: "MEDIUM", meanCloudPercent: 52, maxRainMmPerHour: 0, hours: 9, rule: "Over the next 12 hours of daylight: LOW when the mean cloud cover is under 40%." }, provenance: provenance({ status: "FORECAST", provider: "open-meteo", dataType: "weather_risk" }) },
    resilience: { value: { hours: 9.5, atLeast: false, score: 40 }, unit: "h", provenance: provenance({ status: "SIMULATED", provider: "avishkar-resilience", dataType: "resilience" }) },
    plan: {
      value: { planId: "44444444-4444-4444-8444-444444444444", madeAt: "2026-10-08T09:00:00.000Z", stale: false, savingsInr: 40.4, baselineNetCostInr: 150.2, netCostInr: 109.8, importKwh: 12.5, autonomyScore: 81 },
      unit: "INR",
      provenance: f("plan_summary", "SIMULATED", ["An outcome expected from forecasts, not a measurement."]),
    },
    recommendation: plan().recommendation!,
    achieved: { expectedSavingsInr: 40.4, basis: "What the latest plan is expected to save against the same hours with no control. A forecast, not a measurement: AVISHKAR has no device feed to measure what actually happened.", carbon: { status: "UNAVAILABLE", reason: "No emission-factor table has been read from a source, so no carbon figure is stated." } },
    next: [],
    ...over,
  };
}
