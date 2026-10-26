import type { EnergyFutures } from "@/lib/types";
import { provenance } from "./fixtures";

type Future = EnergyFutures["futures"][number];
type Outcome = NonNullable<Future["result"]["value"]>;

const sim = (key: string, built: string) => provenance({ status: "SIMULATED", provider: "avishkar-engine", dataType: `future_${key}`, notes: [`A simulated day: ${built}`] });
const none = (key: string, reason: string) => provenance({ status: "UNAVAILABLE", provider: "avishkar-engine", dataType: `future_${key}`, notes: [reason] });

const outcome = (over: Partial<Outcome> = {}): Outcome => ({
  netCostInr: 41.2,
  noControlCostInr: 52.9,
  savingsInr: 11.7,
  importKwh: 21.5,
  exportKwh: 0,
  solarKwh: 19.1,
  loadKwh: 28,
  unservedKwh: 0,
  unservedNoControlKwh: 0,
  batteryCycles: 0.7,
  autonomyPercent: 23.2,
  shedKwh: 0,
  vsExpectedInr: 0,
  ...over,
});

function run(key: Future["key"], label: string, basis: Future["basis"], built: string, o: Partial<Outcome>): Future {
  return { key, label, basis, built, sameAsExpected: false, state: "RUN", reason: null, result: { value: outcome(o), unit: "INR", provenance: sim(key, built) } };
}
function skip(key: Future["key"], label: string, basis: Future["basis"], built: string, reason: string): Future {
  return { key, label, basis, built, sameAsExpected: false, state: "UNAVAILABLE", reason, result: { value: null, unit: "INR", provenance: none(key, reason) } };
}

export function energyFutures(over: Partial<EnergyFutures> = {}): EnergyFutures {
  return {
    label: "ENERGY FUTURES",
    madeAt: "2026-10-08T10:00:00.000Z",
    horizon: { start: "2026-10-08T16:00:00+05:30", steps: 24 },
    request: { mode: "BALANCED", rainSolarPercent: 20, outage: { startHour: 18, hours: 4 } },
    futures: [
      run("expected", "Expected day", "REFERENCE", "The forecasts' central estimates for the sun and the demand: the day the plan is made for.", {}),
      skip("sunny", "Sunny", "DATA", "Solar output at the upper end of the forecast's own band.", "The solar forecast has no calibrated band for this place yet, so its sunny and cloudy ends cannot be stated."),
      run("rain", "Rain", "ASSUMPTION", "Solar output at 20% of the expected output in every hour. The share is your assumption.", { netCostInr: 58.4, vsExpectedInr: 17.2, solarKwh: 3.8, importKwh: 30.1, autonomyPercent: 0 }),
      run("batteryOffline", "Battery offline", "ASSUMPTION", "The battery cannot be used for the whole 24 hours.", { netCostInr: 49.9, vsExpectedInr: 8.7, batteryCycles: 0 }),
      run("outage", "Grid outage", "ASSUMPTION", "A question, not a forecast: the grid is down from 6 pm for 4 hour(s); only the critical load is kept on.", { netCostInr: 30.1, vsExpectedInr: null, shedKwh: 6, unservedKwh: 0.4 }),
    ],
    spread: {
      cheapest: { key: "expected", label: "Expected day", netCostInr: 41.2 },
      dearest: { key: "rain", label: "Rain", netCostInr: 58.4 },
      note: "The days with an outage are left out: their bills are lower because load is switched off, not because the day is cheaper. These are not predictions and carry no probability.",
    },
    assumptions: ["Each day is planned from scratch with the planner told what the day will be.", "No outage forecast exists: an outage is a question you ask."],
    notes: [],
    ...over,
  };
}
