import { describe, expect, it } from "vitest";
import type { Appliance, Battery, Ev } from "../src/generated/prisma/client.js";
import { departureStep, istIso, local, planStart, resample, windowInHorizon } from "../src/plan/horizon.js";
import { aggregateBatteries, appliancePlan, costsShown, evPlan, marginalSlabRate, priceSeries } from "../src/plan/service.js";

const HOUR = 3_600_000;
/** 2026-10-07 is a Wednesday. 16:00 IST is 10:30 UTC. */
const START = Date.parse("2026-10-07T10:30:00Z");

describe("the horizon on the local clock", () => {
  it("starts at the next whole local hour, and stays put when it already is one", () => {
    expect(new Date(planStart(new Date("2026-10-07T10:10:00Z"))).toISOString()).toBe("2026-10-07T10:30:00.000Z"); // 15:40 IST -> 16:00 IST
    expect(new Date(planStart(new Date("2026-10-07T10:30:00Z"))).toISOString()).toBe("2026-10-07T10:30:00.000Z");
    expect(new Date(planStart(new Date("2026-10-07T10:30:01Z"))).toISOString()).toBe("2026-10-07T11:30:00.000Z");
  });

  it("reads local hour, weekday (Monday is 0) and date from an instant, across midnight", () => {
    expect(local(START)).toEqual({ hour: 16, minute: 0, weekday: 2, date: "2026-10-07" });
    expect(local(Date.parse("2026-10-07T18:30:00Z"))).toMatchObject({ hour: 0, weekday: 3, date: "2026-10-08" });
    expect(local(Date.parse("2026-10-10T18:29:00Z"))).toMatchObject({ weekday: 5 }); // 23:59 Saturday
  });
});

describe("istIso", () => {
  it("writes an instant on the local clock with its offset", () => {
    expect(istIso(START)).toBe("2026-10-07T16:00:00+05:30");
    expect(istIso(Date.parse("2026-10-07T18:30:00Z"))).toBe("2026-10-08T00:00:00+05:30");
    expect(Date.parse(istIso(START))).toBe(START);
  });
});

describe("windowInHorizon", () => {
  const w = (from: string, to: string, steps = 24) => windowInHorizon(from, to, START, steps);
  it("places a window that opens later today", () => expect(w("22:00", "06:00")).toEqual({ startStep: 6, endStep: 14 }));
  it("keeps the rest of a window that is open now", () => expect(w("09:00", "17:00")).toEqual({ startStep: 0, endStep: 1 }));
  it("moves a window that has already closed to tomorrow", () => expect(w("12:00", "14:00")).toEqual({ startStep: 20, endStep: 22 }));
  it("cuts a window at the end of the horizon", () => expect(w("22:00", "06:00", 10)).toEqual({ startStep: 6, endStep: 10 }));
  it("does not place a window that starts after the horizon ends", () => expect(w("20:00", "21:00", 2)).toBeNull());
  it("takes equal start and finish as the whole day", () => expect(w("00:00", "00:00")).toEqual({ startStep: 0, endStep: 24 }));
});

describe("departureStep", () => {
  const all = [0, 1, 2, 3, 4, 5, 6];
  it("finds the next departure and counts whole hours before it", () => expect(departureStep("07:30", all, START, 24)).toEqual({ step: 15, beyondHorizon: false }));
  it("respects the weekdays", () => expect(departureStep("07:30", [4], START, 24)).toEqual({ step: 24, beyondHorizon: true })); // Friday is beyond a 24 h plan
  it("never picks a departure that has passed today", () => expect(departureStep("09:00", [2], START, 200)).toEqual({ step: 161, beyondHorizon: false })); // next Wednesday 09:00 is 6 days 17 hours after Wednesday 16:00
  it("is null when no listed day comes up", () => expect(departureStep("07:30", [], START, 24)).toBeNull());
});

describe("resample: provider hours (UTC) onto local hours (half an hour off)", () => {
  const at = (iso: string, value: number) => ({ time: iso, value });
  it("averages the two hours an end-labelled step overlaps, in proportion", () => {
    // the step 16:00-17:00 IST is 10:30-11:30 UTC: half of the hour ending 11:00 and half of the hour ending 12:00
    const r = resample([at("2026-10-07T11:00:00Z", 100), at("2026-10-07T12:00:00Z", 300)], "end", START, 1);
    expect(r).toEqual([200]);
  });
  it("reads start-labelled hours the same way", () => {
    expect(resample([at("2026-10-07T10:00:00Z", 100), at("2026-10-07T11:00:00Z", 300)], "start", START, 1)).toEqual([200]);
  });
  it("leaves null where an overlapping hour is missing rather than inventing it", () => {
    expect(resample([at("2026-10-07T11:00:00Z", 100)], "end", START, 2)).toEqual([null, null]);
    expect(resample([at("2026-10-07T11:00:00Z", 100), at("2026-10-07T12:00:00Z", 100), at("2026-10-07T13:00:00Z", 50)], "end", START, 2)).toEqual([100, 75]);
  });
  it("matches exactly when the provider hours already sit on the local clock, as the load forecast's do", () => {
    expect(resample([at("2026-10-07T10:30:00Z", 7), at("2026-10-07T11:30:00Z", 9)], "start", START, 2)).toEqual([7, 9]);
  });
  it("is not thrown by hours that are listed in no particular order", () => {
    expect(resample([at("2026-10-07T12:00:00Z", 300), at("2026-10-07T11:00:00Z", 100)], "end", START, 1)).toEqual([200]);
  });
});

describe("costsShown", () => {
  it("makes the saving the difference of the two costs as shown, never a separately rounded figure", () => {
    expect(costsShown(24.593, 64.604)).toEqual({ netCostInr: 24.59, baselineNetCostInr: 64.6, savingsInr: 40.01 });
    // the telling pair: the exact difference is 40.0098, which rounds to 40.01, but the figures shown are 64.60 and 24.60, which differ by 40.00
    const c = costsShown(24.5951, 64.6049);
    expect(c).toEqual({ netCostInr: 24.6, baselineNetCostInr: 64.6, savingsInr: 40 });
    expect(c.baselineNetCostInr - c.netCostInr).toBeCloseTo(c.savingsInr, 9);
  });
});

describe("price series", () => {
  const tou = { hourlyRates: Array.from({ length: 24 }, (_, h) => 4 + h), slabs: null, export: { rate: 3, basis: "ASSUMPTION" as const, meteringMode: "UNKNOWN" as const } };

  it("takes the rate of each step's local hour", () => {
    const p = priceSeries(tou, START, 12, null);
    expect(p.importPrice.slice(0, 3)).toEqual([20, 21, 22]); // 16:00, 17:00, 18:00 IST -> 4 + hour
    expect(p.importPrice[8]).toBe(4); // 00:00 next day
    expect(p.exportPrice.every((x) => x === 3)).toBe(true);
    expect(p.notes).toEqual([]);
  });

  it("caps an export rate that is above the import price, and says so", () => {
    const p = priceSeries({ ...tou, export: { rate: 6, basis: "USER_ENTERED", meteringMode: "UNKNOWN" } }, START, 12, null);
    expect(p.exportPrice.slice(8, 10)).toEqual([4, 5]);
    expect(p.exportPrice[0]).toBe(6);
    expect(p.notes.join(" ")).toContain("capped at the import price");
  });

  it("values export at nothing when the tariff has no export rate", () => {
    const p = priceSeries({ ...tou, export: { rate: null, basis: "ASSUMPTION", meteringMode: "UNKNOWN" } }, START, 3, null);
    expect(p.exportPrice).toEqual([0, 0, 0]);
    expect(p.notes.join(" ")).toContain("no export rate");
  });

  it("prices every hour at the slab the month's usage reaches, which needs a usage figure", () => {
    const slabs = [{ upToKwhPerMonth: 100, rate: 3 }, { upToKwhPerMonth: 300, rate: 6 }, { upToKwhPerMonth: null, rate: 9 }];
    expect(marginalSlabRate(slabs, 50)).toBe(3);
    expect(marginalSlabRate(slabs, 100)).toBe(3);
    expect(marginalSlabRate(slabs, 250)).toBe(6);
    expect(marginalSlabRate(slabs, 5000)).toBe(9);
    const p = priceSeries({ ...tou, slabs }, START, 4, 250);
    expect(p.importPrice).toEqual([6, 6, 6, 6]);
    expect(p.notes.join(" ")).toContain("slab");
    expect(() => priceSeries({ ...tou, slabs }, START, 4, null)).toThrowError(/depends on your monthly use/);
  });
});

const now = new Date("2026-10-07T10:10:00Z");
const bat = (over: Partial<Battery> = {}): Battery =>
  ({ id: "b", propertyId: "p", name: "Wall", status: "EXISTING", capacityKwh: 10, maxChargeKw: 5, maxDischargeKw: 5, chargeEfficiency: null, dischargeEfficiency: null, minSoc: null, maxSoc: null, reserveSoc: null, maxCyclesPerDay: null, ratedCycles: null, wearInrPerKwh: null, currentSoc: null, currentSocAt: null, installedOn: null, notes: null, createdAt: now, updatedAt: now, ...over }) as Battery;

describe("aggregateBatteries", () => {
  it("is null with no installed battery, and ignores a planned one", () => {
    expect(aggregateBatteries([], now, null)).toBeNull();
    expect(aggregateBatteries([bat({ status: "PLANNED" })], now, null)).toBeNull();
  });

  it("uses the documented defaults and assumes the start is at the minimum when nothing says otherwise, and says so", () => {
    const a = aggregateBatteries([bat()], now, null)!;
    expect(a.input).toMatchObject({ capacityKwh: 10, minSocKwh: 1, maxSocKwh: 10, reserveSocKwh: null, initialSocKwh: 1, terminalSocKwh: 1, wearInrPerKwh: 2 });
    expect(a.input.chargeEfficiency).toBeCloseTo(Math.sqrt(0.9), 5);
    expect(a.startBasis).toBe("ASSUMPTION");
    expect(a.usableKwh).toBe(9);
    expect(a.notes.join(" ")).toContain("not known");
  });

  it("starts at the reserve when one is set, and holds it", () => {
    const a = aggregateBatteries([bat({ reserveSoc: 0.3 })], now, null)!;
    expect(a.input).toMatchObject({ reserveSocKwh: 3, initialSocKwh: 3, terminalSocKwh: 3 });
  });

  it("takes a charge entered within the day as the owner's, and ignores one that is older", () => {
    const fresh = aggregateBatteries([bat({ currentSoc: 0.5, currentSocAt: new Date(now.getTime() - 3 * HOUR) })], now, null)!;
    expect(fresh.input.initialSocKwh).toBe(5);
    expect(fresh.startBasis).toBe("USER_ENTERED");
    const old = aggregateBatteries([bat({ currentSoc: 0.5, currentSocAt: new Date(now.getTime() - 48 * HOUR) })], now, null)!;
    expect(old.startBasis).toBe("ASSUMPTION");
    expect(old.input.initialSocKwh).toBe(1);
  });

  it("lets the request state the charge, and moves one outside the usable range to its edge", () => {
    expect(aggregateBatteries([bat()], now, 80)!.input.initialSocKwh).toBe(8);
    const low = aggregateBatteries([bat()], now, 0)!;
    expect(low.input.initialSocKwh).toBe(1);
    expect(low.notes.join(" ")).toContain("moved to its edge");
  });

  it("plans several batteries as one store: capacities and powers add, efficiency is capacity-weighted", () => {
    const a = aggregateBatteries([bat({ capacityKwh: 10, chargeEfficiency: 0.9, dischargeEfficiency: 0.9 }), bat({ id: "c", capacityKwh: 30, maxChargeKw: 10, maxDischargeKw: 10, chargeEfficiency: 0.98, dischargeEfficiency: 0.98 })], now, null)!;
    expect(a.input).toMatchObject({ capacityKwh: 40, maxChargeKw: 15, maxDischargeKw: 15 });
    expect(a.input.chargeEfficiency).toBeCloseTo((0.9 * 10 + 0.98 * 30) / 40, 5);
    expect(a.notes.join(" ")).toContain("2 batteries are planned as one store");
  });
});

const ev = (over: Partial<Ev> = {}): Ev =>
  ({ id: "e", propertyId: "p", name: "Nexon", batteryKwh: 30, chargerKw: 3.3, chargerEfficiency: null, targetSoc: 0.8, currentSoc: 0.2, currentSocAt: now, departureTime: "07:30", departureDays: [0, 1, 2, 3, 4, 5, 6], notes: null, createdAt: now, updatedAt: now, ...over }) as Ev;

describe("evPlan", () => {
  it("needs the energy to the target by the departure hour", () => {
    const p = evPlan([ev()], START, 24);
    expect(p.input).toMatchObject({ energyNeededKwh: 18, chargerKw: 3.3, chargerEfficiency: 0.9, availableFromStep: 0, departureStep: 15 });
    expect(p.notes.join(" ")).toContain("plugged in from the start");
  });
  it("leaves a vehicle out, and says why, when its charge is unknown, already at target, or it leaves at once", () => {
    expect(evPlan([ev({ currentSoc: null })], START, 24)).toMatchObject({ input: null, notes: [expect.stringContaining("current charge is not entered")] });
    expect(evPlan([ev({ currentSoc: 0.9 })], START, 24)).toMatchObject({ input: null, notes: [expect.stringContaining("already at its target")] });
    expect(evPlan([ev({ departureTime: "16:30" })], START, 24)).toMatchObject({ input: null, notes: [expect.stringContaining("within the first hour")] });
  });
  it("plans the first vehicle only, naming it, and has nothing to say with none", () => {
    expect(evPlan([], START, 24)).toEqual({ input: null, notes: [] });
    expect(evPlan([ev(), ev({ id: "f", name: "Other" })], START, 24).notes.join(" ")).toContain("Only the first of your 2 vehicles is planned (Nexon)");
  });
});

const app = (over: Partial<Appliance> = {}): Appliance =>
  ({ id: "a1", propertyId: "p", name: "Washer", kind: "washing machine", priority: "FLEXIBLE", ratedPowerW: 2000, quantity: 1, runtimeMinPerDay: null, schedule: null, earliestStart: "08:00", latestFinish: "22:00", durationMin: 120, interruptible: false, comfortNote: null, createdAt: now, updatedAt: now, ...over }) as Appliance;

describe("appliancePlan", () => {
  it("places a flexible appliance in the next occurrence of its window and sums the critical load", () => {
    const p = appliancePlan([app(), app({ id: "fr", name: "Fridge", priority: "CRITICAL", ratedPowerW: 150, quantity: 2, earliestStart: null, latestFinish: null, durationMin: null })], START, 24);
    expect(p.input).toEqual([{ id: "a1", name: "Washer", powerKw: 2, durationSteps: 2, earliestStartStep: 0, latestFinishStep: 6, interruptible: false }]);
    expect(p.criticalKw).toBe(0.3);
    expect(p.notes).toEqual([]);
  });
  it("does not schedule what has no window or is not flexible", () => {
    expect(appliancePlan([app({ priority: "IMPORTANT" }), app({ id: "x", earliestStart: null, latestFinish: null, durationMin: null })], START, 24).input).toEqual([]);
  });
  it("names an appliance whose run does not fit inside the part of its window the plan covers", () => {
    const p = appliancePlan([app({ durationMin: 360 })], START, 24); // 16:00 to 22:00 is 6 h: fits exactly
    expect(p.input).toHaveLength(1);
    const q = appliancePlan([app({ durationMin: 420, latestFinish: "23:00" })], START, 2);
    expect(q.input).toEqual([]);
    expect(q.notes.join(" ")).toContain("Washer is not scheduled");
  });
  it("rounds minutes up to whole hours and says so", () => {
    const p = appliancePlan([app({ durationMin: 90 })], START, 24);
    expect(p.input[0]!.durationSteps).toBe(2);
    expect(p.notes.join(" ")).toContain("rounded up to whole hours");
  });
});
