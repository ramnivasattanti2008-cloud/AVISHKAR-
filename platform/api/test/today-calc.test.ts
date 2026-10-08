import { describe, expect, it } from "vitest";
import { RISK_RULE, dayEnergy, hours24, surplus, weatherRisk } from "../src/today/calc.js";

const H = 3_600_000;
const IST = 330 * 60_000;
const day = Date.parse("2026-10-08T00:00:00Z") - IST; // midnight IST
const iso = (ms: number) => new Date(ms).toISOString();
/** An hourly series labelled by the START of each hour, from `fromHour` local, with the given values. */
const startLabelled = (fromHour: number, values: number[]) => values.map((value, i) => ({ time: iso(day + (fromHour + i) * H), value }));
/** The same, labelled by the END of each hour (as irradiance is). */
const endLabelled = (fromHour: number, values: number[]) => values.map((value, i) => ({ time: iso(day + (fromHour + i + 1) * H), value }));

describe("dayEnergy", () => {
  it("adds the hours of the day, in kWh for kW in each hour, and says how many of the 24 it covers", () => {
    const r = dayEnergy(startLabelled(0, Array.from({ length: 24 }, () => 2)), "start", day);
    expect(r).toEqual({ kwh: 48, hoursCovered: 24 });
  });

  it("counts only the part of an hour that is inside the day: the hour ending at midnight is today's, the one ending at 1 am is not", () => {
    const pts = [{ time: iso(day + 24 * H), value: 5 }, { time: iso(day + 25 * H), value: 100 }, { time: iso(day), value: 100 }];
    const r = dayEnergy(pts, "end", day);
    expect(r).toEqual({ kwh: 5, hoursCovered: 1 }); // end-labelled: [23:00, 24:00] is in, [24:00, 25:00] and [-1:00, 0:00] are out
  });

  it("splits an hour that straddles midnight in proportion", () => {
    // a half-hour offset, as the provider's UTC hours sit against IST: the hour 23:30 to 00:30 gives half to each day
    const r = dayEnergy([{ time: iso(day + 24 * H + 30 * 60_000), value: 4 }], "end", day);
    expect(r.hoursCovered).toBeCloseTo(0.5, 12);
    expect(r.kwh).toBeCloseTo(2, 12);
  });

  it("covers only what the series covers: a forecast that starts at noon covers half the day, and says so", () => {
    const r = dayEnergy(startLabelled(12, Array.from({ length: 12 }, () => 1)), "start", day);
    expect(r).toEqual({ kwh: 12, hoursCovered: 12 });
  });
});

describe("hours24 and surplus", () => {
  it("lays a series on the 24 local hours with null where it does not reach, and surplus uses only hours both know", () => {
    const pv = hours24(endLabelled(6, [1, 3, 5, 3, 1]), "end", day); // hours 06 to 10
    const load = hours24(startLabelled(8, [2, 2, 2, 2, 2, 2]), "start", day); // hours 08 to 13
    expect(pv.slice(6, 11)).toEqual([1, 3, 5, 3, 1]);
    expect(pv[5]).toBeNull();
    expect(load[8]).toBe(2);
    expect(load[14]).toBeNull();
    // both are known in hours 8, 9 and 10: pv 5, 3, 1 against a load of 2, 2, 2 leaves 3 + 1 + 0
    expect(surplus(pv, load)).toEqual({ kwh: 4, hours: 3 });
  });

  it("is nothing, over no hours, when the two never overlap", () => {
    expect(surplus([1, null], [null, 2])).toEqual({ kwh: 0, hours: 0 });
  });
});

describe("weatherRisk", () => {
  const now = day + 6 * H;
  const sun = endLabelled(6, [100, 400, 700, 800, 700, 400, 100, 0, 0, 0]); // daylight hours 6 to 12, then none
  const cloud = (v: number) => endLabelled(6, Array.from({ length: 10 }, () => v));
  const dry = endLabelled(6, Array.from({ length: 10 }, () => 0));

  it("is LOW under a mostly clear sky, MEDIUM under broken cloud and HIGH under overcast, by the mean over the daylight hours", () => {
    expect(weatherRisk(cloud(20), dry, sun, now)).toMatchObject({ level: "LOW", meanCloudPercent: 20, hours: 7 });
    expect(weatherRisk(cloud(40), dry, sun, now)!.level).toBe("MEDIUM"); // from 40% up
    expect(weatherRisk(cloud(74), dry, sun, now)!.level).toBe("MEDIUM");
    expect(weatherRisk(cloud(75), dry, sun, now)!.level).toBe("HIGH");
  });

  it("goes one level higher when any daylight hour has moderate rain, to at most HIGH", () => {
    const rain = endLabelled(6, [0, 0, 2.5, 0, 0, 0, 0, 0, 0, 0]);
    expect(weatherRisk(cloud(20), rain, sun, now)).toMatchObject({ level: "MEDIUM", maxRainMmPerHour: 2.5 });
    expect(weatherRisk(cloud(50), rain, sun, now)!.level).toBe("HIGH");
    expect(weatherRisk(cloud(90), rain, sun, now)!.level).toBe("HIGH");
    expect(weatherRisk(cloud(20), endLabelled(6, [0, 0, 2.4, 0, 0, 0, 0, 0, 0, 0]), sun, now)!.level).toBe("LOW"); // just under
  });

  it("looks only at the daylight hours still ahead, and not at night", () => {
    const afternoon = day + 10 * H; // hours 6 to 9 are behind us
    const r = weatherRisk(cloud(10), dry, sun, afternoon)!;
    expect(r.hours).toBe(3); // the hours ending at 11, 12 and 13 o'clock: the one that ended at 10 is behind us
    const night = day + 20 * H;
    expect(weatherRisk(cloud(10), dry, sun, night)).toBeNull(); // no daylight in what is left of the series
  });

  it("states its rule in numbers, as a rule of this page", () => {
    expect(RISK_RULE).toContain("under 40%");
    expect(RISK_RULE).toContain("HIGH from 75%");
    expect(RISK_RULE).toContain("2.5 mm");
    expect(RISK_RULE).toContain("not a standard");
  });
});
