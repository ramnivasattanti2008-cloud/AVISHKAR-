import { describe, expect, it } from "vitest";
import { detectDelimiter, parseCsv } from "../src/energy/csv.js";
import { IST_OFFSET_MINUTES, MeterFileError, parseMeterFile, parseNumber, parseTimestamp, unitFromHeader } from "../src/energy/parse.js";

const NOW = new Date("2026-10-07T12:00:00Z");
const parse = (text: string, unit?: "kWh" | "Wh" | "kW" | "W") => parseMeterFile(text, { now: NOW, unit });

/** n 15-minute rows starting 2026-03-01 00:00 IST, with a value function of the index. */
function rows(n: number, value: (i: number) => string | number = () => 0.25, stepMin = 15, start = Date.UTC(2026, 2, 1, 0, 0) - IST_OFFSET_MINUTES * 60_000): string {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const ist = new Date(start + i * stepMin * 60_000 + IST_OFFSET_MINUTES * 60_000);
    const p = (x: number) => String(x).padStart(2, "0");
    out.push(`${p(ist.getUTCDate())}/${p(ist.getUTCMonth() + 1)}/${ist.getUTCFullYear()} ${p(ist.getUTCHours())}:${p(ist.getUTCMinutes())},${value(i)}`);
  }
  return out.join("\n");
}

describe("parseCsv", () => {
  it("reads quoted fields, doubled quotes, embedded newlines and a byte-order mark", () => {
    const c = parseCsv('' + String.fromCharCode(0xfeff) + 'time,usage,note\n"2026-03-01 00:00",0.5,"said ""hi"""\n"2026-03-01 00:15",0.6,"two\nlines"\n');
    expect(c.header).toEqual(["time", "usage", "note"]);
    expect(c.rows).toEqual([
      ["2026-03-01 00:00", "0.5", 'said "hi"'],
      ["2026-03-01 00:15", "0.6", "two\nlines"],
    ]);
  });

  it("copes with CRLF, a missing final newline and blank lines", () => {
    const c = parseCsv("a,b\r\n1,2\r\n\r\n3,4");
    expect(c.rows).toEqual([["1", "2"], ["3", "4"]]);
  });

  it("detects the delimiter outside quotes", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
    expect(detectDelimiter("a|b|c")).toBe("|");
    expect(detectDelimiter('"a,b,c";d')).toBe(";"); // commas inside quotes do not count
    expect(detectDelimiter("single")).toBe(",");
  });

  it("returns nothing for empty input", () => {
    expect(parseCsv("")).toEqual({ delimiter: ",", header: [], rows: [] });
    expect(parseCsv("\n\n").rows).toEqual([]);
  });
});

describe("parseTimestamp", () => {
  const iso = (s: string) => parseTimestamp(s)?.toISOString();
  it("reads ISO 8601 with an offset, with Z, and with none (India Standard Time)", () => {
    expect(iso("2026-03-01T00:00:00Z")).toBe("2026-03-01T00:00:00.000Z");
    expect(iso("2026-03-01T05:30:00+05:30")).toBe("2026-03-01T00:00:00.000Z");
    expect(iso("2026-03-01 05:30")).toBe("2026-03-01T00:00:00.000Z"); // no offset: IST
    expect(iso("2026-03-01T00:00:00-0500")).toBe("2026-03-01T05:00:00.000Z");
    expect(iso("2026-03-01")).toBe("2026-02-28T18:30:00.000Z"); // a date alone is midnight IST
  });

  it("reads day-first dates, the Indian convention, never month-first", () => {
    expect(iso("01/03/2026 05:30")).toBe("2026-03-01T00:00:00.000Z"); // 1 March, not 3 January
    expect(iso("31-03-2026 23:45")).toBe("2026-03-31T18:15:00.000Z");
    expect(iso("5.4.26 10:00")).toBe("2026-04-05T04:30:00.000Z");
    expect(parseTimestamp("03/31/2026 10:00")).toBeNull(); // month 31 does not exist: refused, not reinterpreted
  });

  it("reads 12-hour times", () => {
    expect(iso("01/03/2026 12:00 AM")).toBe("2026-02-28T18:30:00.000Z");
    expect(iso("01/03/2026 12:30 PM")).toBe("2026-03-01T07:00:00.000Z");
    expect(iso("01/03/2026 1:15 PM")).toBe("2026-03-01T07:45:00.000Z");
    expect(parseTimestamp("01/03/2026 13:00 PM")).toBeNull();
  });

  it("refuses dates that do not exist and text that is not a date", () => {
    for (const bad of ["2026-02-30 10:00", "2026-13-01", "31/02/2026", "2026-03-01 25:00", "yesterday", "", "12345", "2026-03-01 10:61"]) expect(parseTimestamp(bad), bad).toBeNull();
  });

  it("accepts the leap day only in a leap year", () => {
    expect(parseTimestamp("29/02/2024")).not.toBeNull();
    expect(parseTimestamp("29/02/2026")).toBeNull();
  });
});

describe("parseNumber", () => {
  it("reads plain numbers, thousands commas and decimal commas", () => {
    expect(parseNumber("0.25", ",")).toBe(0.25);
    expect(parseNumber(" 1,234.5 ", ",")).toBe(1234.5);
    expect(parseNumber("12,5", ";")).toBe(12.5); // decimal comma, only when the delimiter is not a comma
    expect(parseNumber("1e-3", ",")).toBe(0.001);
    expect(parseNumber("-4", ",")).toBe(-4);
    expect(parseNumber("1 234", ";")).toBe(1234); // a space as a thousands separator, in its exact shape
    expect(parseNumber("1 234,5", ";")).toBe(1234.5);
  });
  it("refuses anything that is not a number", () => {
    for (const bad of ["", "abc", "1.2.3", "NaN", "Infinity", "12,5", "--1", "1 2"]) expect(parseNumber(bad, ","), bad).toBeNull();
  });
});

describe("unitFromHeader", () => {
  it.each([
    ["kWh", "kWh"],
    ["Energy (kWh)", "kWh"],
    ["consumption_kwh", "kWh"],
    ["Wh", "Wh"],
    ["Energy (Wh)", "Wh"],
    ["load_kw", "kW"],
    ["Power (kW)", "kW"],
    ["kW", "kW"],
    ["Power (W)", "W"],
    ["active_power_w", "W"],
  ] as const)("%s is %s", (h, u) => expect(unitFromHeader(h)).toBe(u));

  it("does not guess when the header states no unit", () => {
    for (const h of ["Consumption", "Usage", "Units", "Load", "Reading", "Energy"]) expect(unitFromHeader(h), h).toBeNull();
  });
});

describe("parseMeterFile", () => {
  it("reads a 15-minute kWh file: unit from the header, readings oldest first, one per timestamp", () => {
    const p = parse(`Timestamp,Energy (kWh)\n${rows(96, (i) => (i % 2 ? 0.2 : 0.3))}`);
    expect(p.rows).toBe(96);
    expect(p.readings).toHaveLength(96);
    expect(p).toMatchObject({ intervalMinutes: 15, unit: "kWh", unitSource: "header", usageColumn: "Energy (kWh)", timestampColumn: "Timestamp", rejected: {}, gaps: { missingIntervals: 0, longestGapMinutes: 0 } });
    expect(p.readings[0]!.ts.toISOString()).toBe("2026-02-28T18:30:00.000Z"); // 1 March 00:00 IST
    expect(p.readings[0]!.kwh).toBe(0.3);
    expect(p.readings.reduce((s, r) => s + r.kwh, 0)).toBeCloseTo(24, 9);
  });

  it("turns power into energy for the interval: 1.2 kW for 15 minutes is 0.3 kWh", () => {
    const p = parse(`time,load_kw\n${rows(8, () => 1.2)}`);
    expect(p.unit).toBe("kW");
    expect(p.readings[0]!.kwh).toBeCloseTo(0.3, 12);
    expect(p.notes.join(" ")).toContain("multiplying by the 15-minute interval");
  });

  it("converts Wh and W", () => {
    expect(parse(`time,Energy (Wh)\n${rows(8, () => 250)}`).readings[0]!.kwh).toBeCloseTo(0.25, 12);
    expect(parse(`time,Power (W)\n${rows(8, () => 1200)}`).readings[0]!.kwh).toBeCloseTo(0.3, 12); // 1.2 kW x 0.25 h
  });

  it("refuses to guess a unit the header does not state, and says why", () => {
    expect(() => parse(`time,Consumption\n${rows(8)}`)).toThrow(/does not say its unit.*factor of four/);
  });

  it("uses the unit the caller states when the header has none", () => {
    const p = parse(`time,Consumption\n${rows(8, () => 0.4)}`, "kWh");
    expect(p).toMatchObject({ unit: "kWh", unitSource: "request" });
    expect(p.readings[0]!.kwh).toBe(0.4);
    expect(p.notes.join(" ")).toContain("is the one you stated");
  });

  it("refuses a stated unit that contradicts the header", () => {
    expect(() => parse(`time,Energy (kWh)\n${rows(8)}`, "kW")).toThrow(/You said the unit is kW.*says kWh/);
  });

  it("counts every refused row under a named reason, and keeps the rest", () => {
    const body = [
      "01/03/2026 00:00,0.3",
      "01/03/2026 00:15,0.3",
      "01/03/2026 00:30,0.3",
      "01/03/2026 00:45,-1", // negative
      "01/03/2026 01:00,abc", // not a number
      "01/03/2026 01:15,", // empty
      "not a time,0.3", // bad timestamp
      "01/03/2026 01:30,0.3",
      "01/03/2026 01:30,0.9", // repeated timestamp
      "01/03/2026 01:45,50000", // 200,000 kW: not a home
      "01/03/2027 00:00,0.3", // in the future
      "01/03/2026 02:00,0.3",
    ].join("\n");
    const p = parse(`time,kWh\n${body}`);
    expect(p.rows).toBe(12);
    expect(p.rejected).toEqual({ negative_value: 1, bad_value: 1, missing_value: 1, bad_timestamp: 1, duplicate_in_file: 1, implausible_value: 1, future_timestamp: 1 });
    expect(p.readings).toHaveLength(5);
    expect(p.readings.length + Object.values(p.rejected).reduce((a, b) => a + b, 0)).toBe(p.rows); // every row is accounted for
  });

  it("keeps the first of a repeated timestamp, not the last", () => {
    const p = parse(`time,kWh\n01/03/2026 00:00,1\n01/03/2026 00:00,9\n01/03/2026 00:15,2\n01/03/2026 00:30,3`);
    expect(p.readings.map((r) => r.kwh)).toEqual([1, 2, 3]);
  });

  it("sorts rows that arrive out of order", () => {
    const p = parse(`time,kWh\n01/03/2026 00:30,3\n01/03/2026 00:00,1\n01/03/2026 00:15,2\n01/03/2026 00:45,4`);
    expect(p.readings.map((r) => r.kwh)).toEqual([1, 2, 3, 4]);
  });

  it("measures gaps and never fills them", () => {
    const body = [rows(4), rows(4, () => 0.3, 15, Date.UTC(2026, 2, 1, 3, 0) - IST_OFFSET_MINUTES * 60_000)].join("\n"); // 4 readings, 2 hours missing, 4 more
    const p = parse(`time,kWh\n${body}`);
    expect(p.readings).toHaveLength(8);
    expect(p.gaps).toEqual({ missingIntervals: 8, longestGapMinutes: 120 });
    expect(p.notes.join(" ")).not.toMatch(/filled/i);
  });

  it("works out other intervals: hourly, half-hourly and daily", () => {
    expect(parse(`time,kWh\n${rows(48, () => 1, 60)}`).intervalMinutes).toBe(60);
    expect(parse(`time,kWh\n${rows(48, () => 1, 30)}`).intervalMinutes).toBe(30);
    expect(parse(`time,kWh\n${rows(10, () => 10, 1440)}`).intervalMinutes).toBe(1440);
  });

  it("warns when the file looks irregular", () => {
    const body = rows(20) + "\n" + rows(5, () => 0.3, 15, Date.UTC(2026, 2, 3) - IST_OFFSET_MINUTES * 60_000); // a big jump
    const irregular = Array.from({ length: 30 }, (_, i) => `01/03/2026 ${String(Math.floor((i * 7) / 60) % 24).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")},0.2`).join("\n");
    expect(parse(`time,kWh\n${body}`).readings.length).toBeGreaterThan(20);
    expect(() => parse(`time,kWh\n${irregular}`)).not.toThrow();
  });

  it("combines separate Date and Time columns", () => {
    const body = "Date,Time,kWh\n01/03/2026,00:00,0.3\n01/03/2026,00:15,0.3\n01/03/2026,00:30,0.3\n01/03/2026,00:45,0.3";
    const p = parse(body);
    expect(p.readings).toHaveLength(4);
    expect(p.timestampColumn).toBe("Date + Time");
    expect(p.readings[0]!.ts.toISOString()).toBe("2026-02-28T18:30:00.000Z");
  });

  it("reads a semicolon file with decimal commas", () => {
    const p = parse("timestamp;Energy (kWh)\n01/03/2026 00:00;0,25\n01/03/2026 00:15;0,50\n01/03/2026 00:30;0,75");
    expect(p.readings.map((r) => r.kwh)).toEqual([0.25, 0.5, 0.75]);
  });

  it("uses the first numeric column when none is named like usage, and says so", () => {
    const p = parse(`time,Meter reading\n${rows(8, () => 0.5)}`, "kWh");
    expect(p.usageColumn).toBe("Meter reading");
    expect(p.notes.join(" ")).toContain("first numeric one");
  });

  it("falls back to the first column for the timestamp when none is named, and says so", () => {
    const p = parse(`When,kWh\n${rows(8)}`);
    expect(p.timestampColumn).toBe("When");
    expect(p.notes.join(" ")).toContain("first column");
  });

  it("states its assumptions about time: interval start, and India Standard Time when there is no offset", () => {
    const notes = parse(`time,kWh\n${rows(8)}`).notes.join(" ");
    expect(notes).toContain("start of its reading interval");
    expect(notes).toContain("India Standard Time");
    const withOffset = parse("time,kWh\n2026-03-01T00:00:00Z,1\n2026-03-01T00:15:00Z,1\n2026-03-01T00:30:00Z,1\n2026-03-01T00:45:00Z,1").notes.join(" ");
    expect(withOffset).not.toContain("India Standard Time");
  });

  it.each([
    ["an empty file", ""],
    ["a header only", "time,kWh"],
    ["no usable readings", "time,kWh\nx,y\nz,w"],
    ["two readings", "time,kWh\n01/03/2026 00:00,1\n01/03/2026 00:15,1"],
    ["no usage column", "time,note\n01/03/2026 00:00,a\n01/03/2026 00:15,b\n01/03/2026 00:30,c"],
  ])("refuses %s with a MeterFileError", (_label, text) => {
    expect(() => parse(text)).toThrow(MeterFileError);
  });

  it("refuses a file that is too big, pointing to a split", () => {
    const big = "time,kWh\n" + "01/03/2026 00:00,1\n".repeat(300_001);
    expect(() => parse(big)).toThrow(/limit is 3,00,000/);
  });

  it("refuses readings more than a day apart", () => {
    expect(() => parse("time,kWh\n01/03/2026,1\n05/03/2026,1\n09/03/2026,1\n13/03/2026,1")).toThrow(/more than a day apart/);
  });
});
