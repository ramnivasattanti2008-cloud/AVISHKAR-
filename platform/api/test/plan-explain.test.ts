import { describe, expect, it } from "vitest";
import { type ScenarioResult, batteryMoves, confidence, headline, sameMoves, scenarioSpecs, windowKwh } from "../src/plan/explain.js";

const H = 3_600_000;
const IST = 330 * 60_000;
const at = (hhmm: string, day = "2026-10-08") => Date.parse(`${day}T${hhmm}:00Z`) - IST;

describe("batteryMoves", () => {
  it("calls an hour charge, discharge or idle by what the battery does, ignoring dust", () => {
    expect(batteryMoves([2, 0, 0.04, 0.2], [0, 1.5, 0, 0.1])).toEqual(["charge", "discharge", "idle"]); // only the first three hours count
    expect(batteryMoves([0.06, 0, 0], [0, 0.06, 0])).toEqual(["charge", "discharge", "idle"]);
    expect(batteryMoves([1, 1], [0, 0], 5)).toEqual(["charge", "charge"]); // never more moves than there are hours
  });

  it("compares moves hour by hour, exactly", () => {
    expect(sameMoves(["charge", "idle"], ["charge", "idle"])).toBe(true);
    expect(sameMoves(["charge", "idle"], ["idle", "charge"])).toBe(false);
    expect(sameMoves(["charge"], ["charge", "idle"])).toBe(false);
  });
});

describe("scenarioSpecs", () => {
  const pv = [1, 2];
  const load = [3, 4];
  it("varies each band that exists, and invents none that does not", () => {
    const s = scenarioSpecs(pv, load, { pvLow: [0.5, 1], pvHigh: [1.5, 3], loadLow: null, loadHigh: [5, 6] });
    expect(s.map((x) => x.key)).toEqual(["solar_low", "solar_high", "load_high"]);
    expect(s[0]).toMatchObject({ pvKw: [0.5, 1], loadKw: load }); // only the sun moves
    expect(s[2]).toMatchObject({ pvKw: pv, loadKw: [5, 6] }); // only the demand moves
    expect(scenarioSpecs(pv, load, { pvLow: null, pvHigh: null, loadLow: null, loadHigh: null })).toEqual([]);
  });
});

describe("windowKwh", () => {
  it("sums the battery energy of the advice hours only, to the hundredth", () => {
    expect(windowKwh([1.234, 2, 3, 99], [0.5, 0, 0, 99])).toEqual({ chargeKwh: 6.23, dischargeKwh: 0.5 });
  });
});

describe("confidence", () => {
  const central = { moves: ["charge", "charge", "idle"] as const, chargeKwh: 4, dischargeKwh: 0 };
  const c = { moves: [...central.moves], chargeKwh: central.chargeKwh, dischargeKwh: central.dischargeKwh };
  const run = (key: ScenarioResult["key"], label: string, moves: ScenarioResult["moves"], usable = true): ScenarioResult => ({ key, label, usable, moves, chargeKwh: moves.filter((m) => m === "charge").length * 2, dischargeKwh: 0 });

  it("counts the forecasts in which the advice is the same, the central one included, and says so", () => {
    const r = confidence(c, [run("solar_low", "Less sun", ["charge", "charge", "idle"]), run("solar_high", "More sun", ["charge", "idle", "idle"]), run("load_high", "More demand", ["charge", "charge", "idle"])], true);
    expect(r).toMatchObject({ assessed: true, agreeing: 3, total: 4 });
    expect(r.statement).toBe("Less steady: the planner gives the same advice for the next 3 hours in 3 of 4 forecasts tried. It changes if the sun or the demand lands at the edge of its band.");
    expect(r.scenarios.map((s) => s.agrees)).toEqual([true, true, false, true]);
    expect(r.scenarios[0]!.label).toContain("central estimate");
  });

  it("is steady only when every forecast tried agrees", () => {
    const r = confidence(c, [run("solar_low", "Less sun", [...c.moves]), run("solar_high", "More sun", [...c.moves])], true);
    expect(r).toMatchObject({ agreeing: 3, total: 3 });
    expect(r.statement).toMatch(/^Steady: .* in all 3 forecasts tried/);
  });

  it("leaves out a scenario the planner could not plan, counting it neither way", () => {
    const r = confidence(c, [run("solar_low", "Less sun", [...c.moves]), run("solar_high", "More sun", ["idle", "idle", "idle"], false)], true);
    expect(r).toMatchObject({ agreeing: 2, total: 2 });
    expect(r.scenarios[2]).toMatchObject({ agrees: null, chargeKwh: null });
  });

  it("is not assessed, and says why, with no battery, no bands or no usable scenario: never a number made up", () => {
    expect(confidence(c, [], true)).toMatchObject({ assessed: false, agreeing: 0, total: 0 });
    expect(confidence(c, [], true).statement).toContain("carry no bands to vary");
    expect(confidence(c, [run("solar_low", "x", [], false)], true).statement).toContain("no usable plan in any varied forecast");
    const none = confidence(c, [run("solar_low", "x", [...c.moves])], false);
    expect(none.assessed).toBe(false);
    expect(none.statement).toContain("there is no battery");
  });
});

describe("headline", () => {
  const start = at("13:00");
  const dec = (hour: string, kind: string, reason: string) => ({ time: new Date(at(hour)).toISOString(), kind, kwh: 1, reason });

  it("says to charge the battery from the plan's first hour, with the energy and the planner's reasons", () => {
    const h = headline(true, start, [2, 1.5, 0.5, 0], [0, 0, 0, 3], [dec("13:00", "charge_battery", "charged from the grid at INR 4.00 per kWh, ahead of the INR 10.00 per kWh peak"), dec("14:00", "charge_battery", "second reason"), dec("15:00", "charge_battery", "third reason"), dec("19:00", "discharge_battery", "later")]);
    expect(h.kind).toBe("CHARGE_BATTERY");
    expect(h.text).toBe("Charge the battery from 13:00: 4 kWh before 16:00.");
    expect(h.why).toEqual(["charged from the grid at INR 4.00 per kWh, ahead of the INR 10.00 per kWh peak", "second reason"]); // two reasons at most, none from outside the window
  });

  it("says to use the battery when the next hours release charge", () => {
    const h = headline(true, start, [0, 0, 0], [1, 2, 0], [dec("13:00", "discharge_battery", "discharged at 13:00 to avoid importing at INR 8.00 per kWh")]);
    expect(h.kind).toBe("USE_BATTERY");
    expect(h.text).toBe("Use the battery from 13:00: 3 kWh before 16:00.");
  });

  it("says to leave it as it is, naming when it next moves and why", () => {
    const h = headline(true, start, [0, 0, 0, 0, 2], [0, 0, 0, 0, 0], [dec("17:00", "charge_battery", "charged from the grid at INR 4.00 per kWh")]);
    expect(h.kind).toBe("HOLD");
    expect(h.text).toBe("Leave the battery as it is until 16:00: the plan neither charges nor uses it in that time.");
    expect(h.why).toEqual(["The battery's next move is at 17:00: charged from the grid at INR 4.00 per kWh."]);
    expect(headline(true, start, [0, 0, 0], [0, 0, 0], []).why).toEqual(["The plan does not move the battery at all in this period."]);
  });

  it("has nothing to say about a battery that is not there", () => {
    const h = headline(false, start, [0, 0, 0], [0, 0, 0], []);
    expect(h.kind).toBe("NO_BATTERY_MOVE");
    expect(h.text).toContain("no battery");
    expect(H).toBe(3_600_000);
  });
});
