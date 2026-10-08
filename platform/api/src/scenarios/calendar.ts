/**
 * The next 365 days sorted into calendar months and day types, on the India Standard Time clock: how many weekdays and weekend
 * days each month contributes. An annual estimate is one typical weekday and one typical weekend day per month, weighted by these.
 */
import { IST_OFFSET_MINUTES } from "../energy/parse.js";

const DAY_MS = 86_400_000;
const OFFSET = IST_OFFSET_MINUTES * 60_000;

export interface MonthDays {
  month: number;
  weekdays: number;
  weekends: number;
}

export function nextYearDays(from: Date): MonthDays[] {
  const first = Math.floor((from.getTime() + OFFSET) / DAY_MS) * DAY_MS; // local midnight, expressed in shifted time
  const out: MonthDays[] = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, weekdays: 0, weekends: 0 }));
  for (let d = 0; d < 365; d++) {
    const t = new Date(first + d * DAY_MS);
    const m = out[t.getUTCMonth()]!;
    if ((t.getUTCDay() + 6) % 7 >= 5) m.weekends++;
    else m.weekdays++;
  }
  return out;
}
