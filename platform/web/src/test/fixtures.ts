import type { Appliance, Battery, Bill, EnergyDna, EnergyImport, EnergySummary, Ev, Property, Provenance, SolarSystem, TariffPlan } from "@/lib/types";

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
