import { describe, expect, it } from "vitest";
import { relabelDemo } from "../src/demo/relabel.js";
import { DEMO_DAYS, DEMO_SITES, demoDay, demoMeterCsv, fnv1a, istDate, istMidnight } from "../src/demo/world.js";
import { parseMeterFile } from "../src/energy/parse.js";

const site = (key: string) => DEMO_SITES.find((s) => s.key === key)!;
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe("the demo world's sites", () => {
  it("are the four places the specification asks for (Bengaluru, Pune, Jaipur and one more), each with a story and a pattern of 24 hours", () => {
    expect(DEMO_SITES.map((s) => s.city)).toEqual(["Bengaluru", "Pune", "Jaipur", "Mathura"]);
    for (const s of DEMO_SITES) {
      expect(s.name.startsWith("Demo ")).toBe(true);
      expect(s.weekday).toHaveLength(24);
      expect(s.weekend[0]).toHaveLength(24);
      expect(s.weekend[1]).toHaveLength(24);
      expect(s.month).toHaveLength(12);
      expect(s.address).toContain("demo property");
    }
  });

  it("use the sourced catalogue plan where one exists and the invented tariff only for Bengaluru", () => {
    expect(Object.fromEntries(DEMO_SITES.map((s) => [s.city, s.tariffSeedKey]))).toEqual({ Bengaluru: null, Pune: "curated:shop-pune", Jaipur: "curated:clinic-jaipur", Mathura: "curated:home-mathura" });
  });
});

describe("demo readings", () => {
  it("are a pure function of the site and the date: the same day twice is the same, another day or site is not", () => {
    const a = demoDay(site("bengaluru-home"), "2026-05-14");
    expect(demoDay(site("bengaluru-home"), "2026-05-14")).toEqual(a);
    expect(demoDay(site("bengaluru-home"), "2026-05-15")).not.toEqual(a);
    expect(demoDay(site("mathura-home"), "2026-05-14")).not.toEqual(a);
    expect(fnv1a("abc")).toBe(0x1a47e90b); // the published FNV-1a value, so the seeds do not depend on a library
  });

  it("follow the site's own story: a shop draws almost nothing on Sunday, a clinic keeps its night load, a home peaks in the evening", () => {
    const shopSunday = demoDay(site("pune-shop"), "2026-05-17"); // a Sunday
    const shopMonday = demoDay(site("pune-shop"), "2026-05-18");
    expect(sum(shopSunday)).toBeLessThan(sum(shopMonday) * 0.3);
    const clinic = demoDay(site("jaipur-clinic"), "2026-05-18");
    expect(Math.min(...clinic.slice(0, 5))).toBeGreaterThan(0.2); // the vaccine refrigerator never stops
    const home = demoDay(site("bengaluru-home"), "2026-05-18");
    expect(Math.max(...home.slice(18, 23))).toBeGreaterThan(Math.max(...home.slice(10, 16)));
  });

  it("average out, over a month, close to the site's daily use times that month's factor", () => {
    for (const s of DEMO_SITES) {
      const days = Array.from({ length: 30 }, (_, d) => `2026-05-${String(d + 1).padStart(2, "0")}`);
      const mean = sum(days.map((d) => sum(demoDay(s, d)))) / days.length;
      // weekends and Sundays shift the mean by design; the noise averages out
      expect(mean / (s.dailyKwh * s.month[4]!)).toBeGreaterThan(0.6);
      expect(mean / (s.dailyKwh * s.month[4]!)).toBeLessThan(1.3);
    }
  });

  it("make a meter file the ordinary importer accepts in full: 120 whole local days of hourly kWh ending the day before", () => {
    const now = new Date("2026-10-08T06:30:00Z"); // 12:00 IST on 8 October
    const file = demoMeterCsv(site("jaipur-clinic"), now.getTime());
    expect(file.rows).toBe(DEMO_DAYS * 24);
    expect(file.to).toBe("2026-10-07");
    expect(file.from).toBe("2026-06-10");
    expect(file.csv.split("\n")[1]).toBe(`2026-06-10T00:00:00+05:30,${demoDay(site("jaipur-clinic"), "2026-06-10")[0]}`);
    const parsed = parseMeterFile(file.csv, { now, unit: "kWh" });
    expect(parsed.readings).toHaveLength(DEMO_DAYS * 24);
    expect(parsed.intervalMinutes).toBe(60);
    expect(Object.keys(parsed.rejected)).toHaveLength(0);
    expect(parsed.readings.at(-1)!.ts.toISOString()).toBe("2026-10-07T17:30:00.000Z"); // 23:00 IST on the 7th
  });

  it("do not depend on the time of day they are made, only on the date", () => {
    const morning = demoMeterCsv(site("pune-shop"), new Date("2026-10-07T19:00:00Z").getTime()); // 00:30 IST on the 8th
    const evening = demoMeterCsv(site("pune-shop"), new Date("2026-10-08T18:00:00Z").getTime()); // 23:30 IST on the 8th
    expect(morning.csv).toBe(evening.csv);
    expect(istDate(istMidnight(Date.parse("2026-10-08T18:00:00Z")))).toBe("2026-10-08");
  });
});

describe("relabelling for demo properties", () => {
  const forecast = { value: 4.2, provenance: { provider: "avishkar-engine", status: "FORECAST", notes: ["model note"] } };
  const weather = { value: 31, provenance: { provider: "open-meteo", status: "LIVE", notes: [] } };
  const tariff = { value: 7, provenance: { provider: "avishkar-tariff-engine", status: "REFERENCE", notes: [] } };
  const gap = { value: null, provenance: { provider: "avishkar-nilm", status: "UNAVAILABLE", notes: ["no data"] } };
  const owner = { value: 10, provenance: { provider: "user", status: "ESTIMATED", notes: [] } };

  it("labels every computed value DEMO and says what it was, but keeps outside providers, sourced references and gaps as they are", () => {
    const out = relabelDemo({ forecast, weather, tariff, gap, owner, list: [forecast, weather] }, true);
    expect(out.forecast.provenance.status).toBe("DEMO");
    expect(out.forecast.provenance.notes[0]).toContain("computed as FORECAST from the demo world's invented readings");
    expect(out.forecast.provenance.notes[1]).toBe("model note");
    expect(out.owner.provenance.status).toBe("DEMO");
    expect(out.weather).toBe(weather); // the weather at a real place is real
    expect(out.tariff).toBe(tariff);
    expect(out.gap).toBe(gap);
    expect(out.list[0]!.provenance.status).toBe("DEMO");
    expect(out.list[1]).toBe(weather);
  });

  it("changes nothing outside demo, and never mutates what it was given (provider results are cached and shared)", () => {
    const input = { forecast, numbers: [1, 2, 3] };
    expect(relabelDemo(input, false)).toBe(input);
    const out = relabelDemo(input, true);
    expect(out).not.toBe(input);
    expect(forecast.provenance.status).toBe("FORECAST");
    expect(out.numbers).toBe(input.numbers);
  });

  it("labels only the part of a response that is about a demo property", () => {
    const list = { properties: [{ isDemo: false, twin: forecast }, { isDemo: true, twin: forecast }] };
    const out = relabelDemo(list);
    expect(out.properties[0]!.twin.provenance.status).toBe("FORECAST");
    expect(out.properties[1]!.twin.provenance.status).toBe("DEMO");
  });
});
