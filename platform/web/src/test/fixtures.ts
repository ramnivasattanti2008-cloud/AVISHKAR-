import type { Provenance, TariffPlan } from "@/lib/types";

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
