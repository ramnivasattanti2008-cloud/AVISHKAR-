/** Builds meter files with known answers for the energy tests. Times are ISO 8601 with an explicit +05:30 offset. */

export interface MeterCsvOptions {
  /** Local date of the first reading (00:00 IST). 2026-03-02 is a Monday. */
  start?: string;
  days?: number;
  intervalMinutes?: number;
  /** Average power in kW at a local hour of a given weekday (0 is Monday). */
  kw?: (day: number, hour: number, weekday: number) => number;
  header?: string;
  /** Leave out readings: (day index, slot index within the day) is true. */
  skip?: (day: number, slot: number) => boolean;
  /** Raw extra lines appended after the data. */
  extra?: string[];
  /** Write the usage as power in kW instead of energy in kWh per interval. */
  asPower?: boolean;
}

const p2 = (n: number) => String(n).padStart(2, "0");

export function meterCsv(o: MeterCsvOptions = {}): string {
  const { start = "2026-03-02", days = 14, intervalMinutes = 15, kw = (_d, _h, wd) => (wd >= 5 ? 2 : 1), header = "timestamp,Energy (kWh)", skip = () => false, extra = [], asPower = false } = o;
  const lines = [header];
  const perDay = 1440 / intervalMinutes;
  const t0 = Date.parse(`${start}T00:00:00Z`);
  const wd0 = (new Date(`${start}T00:00:00Z`).getUTCDay() + 6) % 7;
  for (let d = 0; d < days; d++) {
    for (let s = 0; s < perDay; s++) {
      if (skip(d, s)) continue;
      const local = new Date(t0 + (d * 1440 + s * intervalMinutes) * 60_000); // wall-clock fields read through the UTC getters
      const hour = Math.floor((s * intervalMinutes) / 60);
      const power = kw(d, hour, (wd0 + d) % 7);
      const value = asPower ? power : (power * intervalMinutes) / 60;
      lines.push(`${local.getUTCFullYear()}-${p2(local.getUTCMonth() + 1)}-${p2(local.getUTCDate())}T${p2(local.getUTCHours())}:${p2(local.getUTCMinutes())}:00+05:30,${value}`);
    }
  }
  return [...lines, ...extra].join("\n");
}
