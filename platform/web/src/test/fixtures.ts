import type { Bill, Property, Provenance, TariffPlan } from "@/lib/types";

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
