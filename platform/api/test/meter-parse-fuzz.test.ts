import { describe, expect, it } from "vitest";
import { MAX_KW, MeterFileError, type MeterParse, type Unit, UNITS, parseMeterFile } from "../src/energy/parse.js";

/**
 * Fuzzing the meter parser (spec section 66): seeded, so a failure is reproducible from its seed. Whatever the file, the parser
 * either refuses it with a MeterFileError (a message for the owner) or returns readings that keep its promises: every row is
 * accepted, refused for a named reason or a duplicate; readings are oldest first, one per timestamp, finite, non-negative and
 * below the plausibility limit; and the same file always gives the same answer.
 */

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOW = new Date("2026-10-27T06:00:00Z");
type R = () => number;
const pick = <T,>(r: R, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const int = (r: R, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pad = (n: number) => String(n).padStart(2, "0");

function timestamp(r: R, base: number, i: number, minutes: number): string {
  const t = new Date(base + i * minutes * 60_000 + (r() < 0.05 ? int(r, -90, 90) * 60_000 : 0));
  const [y, mo, d, h, mi] = [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), t.getUTCHours(), t.getUTCMinutes()];
  switch (int(r, 0, 9)) {
    case 0:
      return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:00Z`;
    case 1:
      return `${pad(d)}/${pad(mo)}/${y} ${pad(h)}:${pad(mi)}`;
    case 2:
      return `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}+05:30`;
    case 3:
      return "";
    case 4:
      return pick(r, ["not a time", "2026-13-45 99:99", "31/02/2026", "00:00", "2026-10-27T25:00", "\u0000", "2099-01-01 00:00"]);
    default:
      return `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}`;
  }
}

function value(r: R, delim: string): string {
  switch (int(r, 0, 11)) {
    case 0:
      return "";
    case 1:
      return pick(r, ["-1", "abc", "NaN", "Infinity", "1e400", "--2", "1.2.3", "0x10", "1,5", "1 234,5", "1,234.5", "  ", "∞", "١٢"]);
    case 2:
      return String(int(r, 0, 10_000_000));
    case 3:
      return delim === "," ? `"${(r() * 3).toFixed(3)}"` : (r() * 3).toFixed(3).replace(".", ",");
    default:
      return (r() * 3).toFixed(int(r, 0, 4));
  }
}

function structuredFile(seed: number): { text: string; unit: Unit | undefined } {
  const r = rng(seed);
  const delim = pick(r, [",", ";", "\t"]);
  const tsHead = pick(r, ["timestamp", "Date Time", "reading_time", "time", "when"]);
  const useHead = pick(r, ["kWh", "Consumption (kWh)", "kW", "usage", "Wh", "W", "power", "value", "units"]);
  const extra = r() < 0.3 ? [pick(r, ["meter", "voltage", "note"])] : [];
  const cols = r() < 0.5 ? [tsHead, useHead, ...extra] : [useHead, ...extra, tsHead];
  const minutes = pick(r, [1, 5, 15, 30, 60, 1440, 7]);
  const base = Date.UTC(2026, int(r, 0, 8), int(r, 1, 28), int(r, 0, 23));
  const rows = int(r, 0, 300);
  const lines = [cols.map((c) => (r() < 0.1 ? `"${c}"` : c)).join(delim)];
  for (let i = 0; i < rows; i++) {
    const cells = cols.map((c) => (c === tsHead ? timestamp(r, base, r() < 0.05 ? i - 1 : i, minutes) : c === useHead ? value(r, delim) : "x"));
    if (r() < 0.03) cells.pop(); // a short row
    lines.push(cells.join(delim));
  }
  const eol = pick(r, ["\n", "\r\n"]);
  const text = (r() < 0.1 ? "﻿" : "") + lines.join(eol) + (r() < 0.5 ? eol : "");
  return { text, unit: r() < 0.6 ? pick(r, UNITS) : undefined };
}

function noise(seed: number): string {
  const r = rng(seed);
  const alphabet = 'abc019,;\t\n\r"\' :-+./Zé\u0000﻿kWh';
  return Array.from({ length: int(r, 0, 400) }, () => pick(r, [...alphabet])).join("");
}

function attempt(text: string, unit: Unit | undefined): MeterParse | MeterFileError {
  try {
    return parseMeterFile(text, { now: NOW, unit });
  } catch (e) {
    if (e instanceof MeterFileError) return e;
    throw new Error(`a ${(e as Error).constructor.name} escaped the parser: ${(e as Error).message}`, { cause: e });
  }
}

function keepsItsPromises(p: MeterParse): void {
  const refused = Object.values(p.rejected).reduce((a, b) => a + (b ?? 0), 0);
  expect(p.readings.length + refused).toBe(p.rows);
  expect(p.readings.length).toBeGreaterThanOrEqual(3);
  expect(Number.isInteger(p.intervalMinutes) && p.intervalMinutes >= 1 && p.intervalMinutes <= 1440).toBe(true);
  for (let i = 0; i < p.readings.length; i++) {
    const { ts, kwh } = p.readings[i]!;
    expect(Number.isFinite(ts.getTime())).toBe(true);
    expect(Number.isFinite(kwh) && kwh >= 0).toBe(true);
    expect((kwh * 60) / p.intervalMinutes).toBeLessThanOrEqual(MAX_KW);
    if (i > 0) expect(ts.getTime()).toBeGreaterThan(p.readings[i - 1]!.ts.getTime());
  }
  expect(p.gaps.missingIntervals).toBeGreaterThanOrEqual(0);
  expect(p.gaps.longestGapMinutes).toBeGreaterThanOrEqual(0);
}

describe("meter parser, fuzzed", () => {
  it("keeps its promises on 600 seeded, mangled meter files", () => {
    let parsed = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const { text, unit } = structuredFile(seed);
      const out = attempt(text, unit);
      if (out instanceof MeterFileError) {
        expect(out.message.length, `seed ${seed}`).toBeGreaterThan(10);
        continue;
      }
      parsed++;
      keepsItsPromises(out);
    }
    // the generator is useful only if a good share of its files are readable
    expect(parsed).toBeGreaterThan(100);
  });

  it("only ever refuses random text with a message, never crashes", () => {
    for (let seed = 1; seed <= 600; seed++) {
      const out = attempt(noise(seed), pick(rng(seed), [...UNITS, undefined]));
      if (!(out instanceof MeterFileError)) keepsItsPromises(out);
    }
  });

  it("gives the same answer for the same file", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { text, unit } = structuredFile(seed);
      const a = attempt(text, unit);
      const b = attempt(text, unit);
      expect(a instanceof MeterFileError ? a.message : JSON.stringify(a)).toBe(b instanceof MeterFileError ? b.message : JSON.stringify(b));
    }
  });
});
