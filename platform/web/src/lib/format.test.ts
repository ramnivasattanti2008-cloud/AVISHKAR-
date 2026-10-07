import { describe, expect, it } from "vitest";
import { STATUS, formatAge, formatDateTime, formatNumber, parseCoordinates, positionLabel } from "./format";
import type { DataStatus } from "./types";

const ALL: DataStatus[] = ["LIVE", "UPDATED", "FORECAST", "ESTIMATED", "SIMULATED", "DEMO", "REFERENCE", "UNAVAILABLE"];

describe("STATUS", () => {
  it("defines every data label the API can send, each with its own tone and a plain meaning", () => {
    expect(Object.keys(STATUS).sort()).toEqual([...ALL].sort());
    expect(new Set(ALL.map((s) => STATUS[s].tone)).size).toBe(ALL.length);
    for (const s of ALL) {
      expect(STATUS[s].label).toBe(s);
      expect(STATUS[s].meaning.length).toBeGreaterThan(20);
    }
  });

  it("never lets an estimate, forecast or demo value pass for a measurement", () => {
    expect(STATUS.ESTIMATED.meaning).toContain("not measured");
    expect(STATUS.FORECAST.meaning).toContain("prediction");
    expect(STATUS.SIMULATED.meaning).toContain("not a measurement");
    expect(STATUS.DEMO.meaning).toContain("not real");
    expect(STATUS.UNAVAILABLE.meaning).toContain("Nothing has been made up");
  });
});

describe("formatAge", () => {
  it.each([
    [0, "0 s"],
    [45, "45 s"],
    [120, "2 min"],
    [3600, "60 min"],
    [4 * 3600, "4 h"],
    [3 * 86400, "3 d"],
    [-5, "0 s"],
  ])("%d seconds is %s", (s, text) => expect(formatAge(s)).toBe(text));
});

describe("formatNumber", () => {
  it("keeps useful precision at each magnitude and groups in the Indian style", () => {
    expect(formatNumber(4.1137)).toBe("4.11");
    expect(formatNumber(21.44)).toBe("21.4");
    expect(formatNumber(104.12)).toBe("104.1");
    expect(formatNumber(123456)).toBe("1,23,456");
    expect(formatNumber(5.2, "kWp")).toBe("5.2 kWp");
    expect(formatNumber(0)).toBe("0");
  });
});

describe("formatDateTime", () => {
  it("formats in the requested zone and returns the input when it is not a date", () => {
    expect(formatDateTime("2026-10-07T12:00:00Z", "UTC")).toMatch(/7 Oct 2026/);
    expect(formatDateTime("2026-10-07T12:00:00Z", "UTC")).toMatch(/12:00/);
    expect(formatDateTime("not a date")).toBe("not a date");
  });
});

describe("positionLabel", () => {
  it("never calls browser geolocation, a click or an address NavIC", () => {
    for (const s of ["browser-geolocation", "manual", "map-click", "geocoded", "imported"]) expect(positionLabel(s)).not.toMatch(/navic/i);
  });
  it("names NavIC only for a NavIC receiver", () => {
    expect(positionLabel("navic", 8)).toBe("POSITION SOURCE: NavIC receiver, accuracy 8 m");
  });
  it("says so when accuracy is not known and passes unknown sources through", () => {
    expect(positionLabel("manual")).toBe("POSITION SOURCE: Entered coordinates, accuracy not reported");
    expect(positionLabel("manual", null)).toContain("accuracy not reported");
    expect(positionLabel("carrier-pigeon", 3.4)).toBe("POSITION SOURCE: carrier-pigeon, accuracy 3 m");
  });
});

describe("parseCoordinates", () => {
  it.each([
    ["12.9716, 77.5946", 12.9716, 77.5946],
    ["12.9716 77.5946", 12.9716, 77.5946],
    ["  -33.86;151.21 ", -33.86, 151.21],
    ["12.9716°N 77.5946°E", 12.9716, 77.5946],
    ["33.86 S, 151.21 E", -33.86, 151.21],
    ["40.7 N 74.0 W", 40.7, -74],
    ["0,0", 0, 0],
  ])("reads %j", (text, latitude, longitude) => expect(parseCoordinates(text)).toEqual({ latitude, longitude }));

  it.each(["", "Bengaluru", "12.9716", "91, 10", "10, 181", "12.9716, 77.5946, 5", "MG Road 560001", "12,34 56,78"])("rejects %j", (text) => expect(parseCoordinates(text)).toBeNull());
});
