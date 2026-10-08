import { describe, expect, it } from "vitest";
import { deriveProposals, runsOf } from "../src/control/proposals.js";
import type { PlanDto } from "../src/plan/schemas.js";

const H = 3_600_000;
const START = Date.parse("2026-10-08T10:30:00Z"); // 16:00 IST

/** A 24-hour plan with only what a test needs: a battery that charges hours 2-4, discharges hours 6-7, a washer and a car. */
function plan(over: { charge?: number[]; discharge?: number[]; ev?: number[]; soc?: number[]; battery?: boolean } = {}): PlanDto {
  const z = () => Array.from({ length: 24 }, () => 0);
  const charge = z();
  [2, 3, 4].forEach((i, k) => (charge[i] = [2, 3, 1][k]!));
  const discharge = z();
  discharge[6] = 2;
  discharge[7] = 1.5;
  const soc = Array.from({ length: 24 }, (_, i) => (i < 5 ? 1 + 2 * i : i < 8 ? 7 - (i - 4) * 1.5 : 2.5));
  const times = Array.from({ length: 24 }, (_, i) => new Date(START + i * H).toISOString());
  return {
    id: "00000000-0000-4000-8000-000000000001",
    propertyId: "00000000-0000-4000-8000-000000000002",
    createdAt: new Date(START - H / 2).toISOString(),
    mode: "BALANCED",
    modeWeights: {},
    horizon: { start: times[0]!, stepHours: 1, steps: 24 },
    schedule: {
      times,
      loadKw: z(),
      pvForecastKw: z(),
      pvUsedKw: z(),
      pvCurtailedKw: z(),
      gridImportKw: z(),
      gridExportKw: z(),
      batteryChargeKw: over.charge ?? charge,
      batteryDischargeKw: over.discharge ?? discharge,
      batterySocKwh: over.soc ?? soc,
      evChargeKw: over.ev ?? z(),
      applianceKw: {},
      importPrice: z(),
      exportPrice: z(),
    },
    result: { value: null, provenance: {} as never },
    appliances: [{ id: "w1", name: "Washer", startTime: times[1]!, runHours: 2, energyKwh: 4 }],
    decisions: [
      { time: times[2]!, kind: "charge_battery", kwh: 2, reason: "charged from the grid at INR 4.00 per kWh, ahead of the INR 10.00 per kWh peak" },
      { time: times[6]!, kind: "discharge_battery", kwh: 2, reason: "discharged at 22:00 to avoid importing at INR 10.00 per kWh" },
      { time: times[1]!, kind: "appliance", kwh: 4, reason: "Washer placed from 17:00 to 19:00, inside its window, at the cheapest hours" },
    ],
    inputs: {
      tariff: { id: "00000000-0000-4000-8000-000000000003", name: "T", validity: "WITHIN", exportRate: 3, exportBasis: "USER_ENTERED" },
      load: { basis: "FORECAST", note: "" },
      solar: { systems: 0, note: "" },
      battery: over.battery === false ? null : { capacityKwh: 10, usableKwh: 9, maxChargeKw: 5, maxDischargeKw: 5, startSocKwh: 1, startSocBasis: "ASSUMPTION", reserveKwh: null },
      ev: null,
      criticalKw: 0,
    },
    assumptions: [],
    solver: { status: "optimal", seconds: 0.1, integerVariables: 0 },
    validation: { valid: true, maxBalanceErrorKw: 0, problems: [] },
    notes: [],
  } as unknown as PlanDto;
}

const NO_LIMITS = { maxChargeKw: null, maxDischargeKw: null, minSocPercent: null };
const before = new Date(START - H);

describe("runsOf", () => {
  it("finds the stretches above dust, with their first and last step", () => {
    expect(runsOf([0, 1, 1, 0, 0, 2, 0.04, 3])).toEqual([[1, 2], [5, 5], [7, 7]]);
    expect(runsOf([0, 0, 0])).toEqual([]);
    expect(runsOf([1, 1])).toEqual([[0, 1]]);
  });
});

describe("deriveProposals", () => {
  it("turns each contiguous move into one proposal with its times, its command and the planner's own reason", () => {
    const d = deriveProposals(plan(), NO_LIMITS, before);
    expect(d.map((x) => x.kind)).toEqual(["APPLIANCE_RUN", "BATTERY_CHARGE", "BATTERY_DISCHARGE"]); // in time order
    const charge = d.find((x) => x.kind === "BATTERY_CHARGE")!;
    expect(charge.startsAt.toISOString()).toBe(new Date(START + 2 * H).toISOString());
    expect(charge.endsAt.toISOString()).toBe(new Date(START + 5 * H).toISOString());
    expect(charge.command).toEqual({ avgKw: 2, peakKw: 3, kwh: 6 }); // (2 + 3 + 1) kWh over three hours
    expect(charge.reason).toBe("charged from the grid at INR 4.00 per kWh, ahead of the INR 10.00 per kWh peak");
    const dis = d.find((x) => x.kind === "BATTERY_DISCHARGE")!;
    expect(dis.command).toEqual({ avgKw: 1.75, peakKw: 2, kwh: 3.5 });
    const wash = d.find((x) => x.kind === "APPLIANCE_RUN")!;
    expect(wash.endsAt.getTime() - wash.startsAt.getTime()).toBe(2 * H);
    expect(wash.command).toMatchObject({ applianceId: "w1", name: "Washer", runHours: 2 });
    expect(wash.reason).toContain("Washer placed from 17:00 to 19:00");
  });

  it("splits separate moves into separate proposals and joins consecutive hours into one", () => {
    const charge = Array.from({ length: 24 }, (_, i) => (i === 1 || i === 2 || i === 9 ? 2 : 0));
    const d = deriveProposals(plan({ charge }), NO_LIMITS, before).filter((x) => x.kind === "BATTERY_CHARGE");
    expect(d).toHaveLength(2);
    expect(d[0]!.endsAt.getTime() - d[0]!.startsAt.getTime()).toBe(2 * H);
    expect(d[1]!.endsAt.getTime() - d[1]!.startsAt.getTime()).toBe(H);
  });

  it("leaves out moves that have already finished", () => {
    const now = new Date(START + 5.5 * H); // after the charging, before the discharging
    expect(deriveProposals(plan(), NO_LIMITS, now).map((x) => x.kind)).toEqual(["BATTERY_DISCHARGE"]);
    expect(deriveProposals(plan(), NO_LIMITS, new Date(START + 30 * H))).toEqual([]);
  });

  it("passes the checks it can pass, and says what each one compared", () => {
    const c = deriveProposals(plan(), { maxChargeKw: 4, maxDischargeKw: 4, minSocPercent: 10 }, before).find((x) => x.kind === "BATTERY_CHARGE")!;
    expect(c.safety.ok).toBe(true);
    expect(c.safety.checks.map((k) => k.check)).toEqual(["device power limit", "your power limit", "your lowest charge"]);
    expect(c.safety.checks[1]!.detail).toBe("3 kW against the 4 kW you set.");
  });

  it("blocks a move that breaks a limit the owner set, and says which and by how much", () => {
    const d = deriveProposals(plan(), { maxChargeKw: 2, maxDischargeKw: null, minSocPercent: null }, before).find((x) => x.kind === "BATTERY_CHARGE")!;
    expect(d.safety.ok).toBe(false);
    const bad = d.safety.checks.find((k) => !k.ok)!;
    expect(bad.check).toBe("your power limit");
    expect(bad.detail).toBe("3 kW against the 2 kW you set.");
  });

  it("blocks a discharge that would take the battery below the lowest charge the owner allows", () => {
    // the plan leaves 2.5 kWh in a 10 kWh battery after the discharge; an owner who wants 30% (3 kWh) kept says no
    const d = deriveProposals(plan(), { maxChargeKw: null, maxDischargeKw: null, minSocPercent: 30 }, before).find((x) => x.kind === "BATTERY_DISCHARGE")!;
    expect(d.safety.ok).toBe(false);
    expect(d.safety.checks.find((k) => k.check === "your lowest charge")!.detail).toBe("2.5 kWh left at the end, against the 3 kWh (30%) you set as the lowest.");
  });

  it("blocks a battery move for a plan that has no battery to command", () => {
    const p = plan({ battery: false });
    const d = deriveProposals(p, NO_LIMITS, before).filter((x) => x.kind.startsWith("BATTERY"));
    expect(d.length).toBeGreaterThan(0);
    for (const x of d) expect(x.safety).toMatchObject({ ok: false, checks: [{ check: "battery", ok: false }] });
  });

  it("proposes the car's charging and nothing for a plan with no moves", () => {
    const ev = Array.from({ length: 24 }, (_, i) => (i >= 3 && i <= 5 ? 7 : 0));
    const d = deriveProposals(plan({ ev }), NO_LIMITS, before).find((x) => x.kind === "EV_CHARGE")!;
    expect(d.command).toEqual({ avgKw: 7, peakKw: 7, kwh: 21 });
    const quiet = plan({ charge: new Array(24).fill(0), discharge: new Array(24).fill(0) });
    quiet.appliances = [];
    expect(deriveProposals(quiet, NO_LIMITS, before)).toEqual([]);
  });
});
