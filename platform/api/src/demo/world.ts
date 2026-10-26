/**
 * The demo world (spec sections 74 and 93): four invented properties in real Indian places, so every part of AVISHKAR can be
 * tried before an owner has a meter file. Everything here is DEMO DATA and says so: the readings, the equipment and the
 * Bengaluru tariff are invented. The places are real, so the weather, the sun and the building outlines fetched for them are
 * real, and the tariffs of Pune, Jaipur and Mathura are the sourced catalogue plans.
 *
 * Deterministic: a day's readings depend only on the site and the date, through a seeded generator, so loading the world
 * twice, or on another day, gives the same readings for the days both cover. Nothing here reads the clock.
 */
import { lognormal, rng } from "../vpp/sample.js";

export const DEMO_LABEL = "DEMO DATA";
/** The source written on the one invented tariff, so it can be told apart from a plan the owner entered. */
export const DEMO_TARIFF_SOURCE = "Invented for the AVISHKAR demo world. It is not a regulator's order or any discom's tariff.";
export const DEMO_DAYS = 120;
const DAY_MS = 86_400_000;
const IST_MS = 330 * 60_000;

type Shape = readonly number[];

export interface DemoSite {
  key: "bengaluru-home" | "pune-shop" | "jaipur-clinic" | "mathura-home";
  name: string;
  city: string;
  latitude: number;
  longitude: number;
  address: string;
  /** The curated catalogue plan to use ("curated:<file>"), or null for the invented demo tariff. */
  tariffSeedKey: string | null;
  /** Mean use on an ordinary day, kWh, before the month's factor. */
  dailyKwh: number;
  /** Relative power in each local hour, 0 to 23, on a working day. */
  weekday: Shape;
  /** Relative power on Saturday and Sunday (index 0 is Saturday). */
  weekend: readonly [Shape, Shape];
  /** Factor for each month, January first: air conditioning in a hot summer, little in Bengaluru. */
  month: readonly number[];
  /** Spread of an hour's use around its pattern (coefficient of variation). */
  noise: number;
  solar: { name: string; capacityKwp: number; tiltDeg: number; azimuthDeg: number } | null;
  battery: { name: string; capacityKwh: number; maxChargeKw: number; maxDischargeKw: number; reserveSoc?: number } | null;
  ev: { name: string; batteryKwh: number; chargerKw: number; targetSoc: number; currentSoc: number; departureTime: string; departureDays: number[] } | null;
  appliances: { name: string; kind: string; priority: "CRITICAL" | "IMPORTANT" | "FLEXIBLE" | "DISCRETIONARY"; ratedPowerW: number; earliestStart?: string; latestFinish?: string; durationMin?: number }[];
  story: string;
}

const HOME: Shape = [0.35, 0.3, 0.3, 0.3, 0.3, 0.4, 0.9, 1.3, 1.1, 0.7, 0.6, 0.6, 0.65, 0.6, 0.55, 0.6, 0.7, 0.9, 1.3, 1.6, 1.7, 1.5, 1.0, 0.6];
const HOME_WEEKEND: Shape = [0.4, 0.35, 0.3, 0.3, 0.3, 0.35, 0.6, 1.0, 1.2, 1.2, 1.1, 1.1, 1.2, 1.1, 1.0, 1.0, 1.0, 1.1, 1.4, 1.6, 1.7, 1.5, 1.1, 0.7];
const SHOP: Shape = [0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.2, 0.5, 1.0, 1.0, 1.05, 1.1, 1.1, 1.05, 1.0, 1.0, 1.1, 1.3, 1.35, 1.3, 1.0, 0.25, 0.15];
const SHOP_SUNDAY: Shape = Array.from({ length: 24 }, () => 0.15);
const CLINIC: Shape = [0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.35, 0.6, 1.0, 1.15, 1.2, 1.2, 1.15, 1.0, 1.0, 1.05, 1.05, 1.0, 0.95, 0.8, 0.5, 0.35, 0.3, 0.3];
const CLINIC_SUNDAY: Shape = [0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.35, 0.6, 0.7, 0.7, 0.7, 0.6, 0.35, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3];

export const DEMO_SITES: readonly DemoSite[] = [
  {
    key: "bengaluru-home",
    name: "Demo home, Bengaluru",
    city: "Bengaluru",
    latitude: 12.9719,
    longitude: 77.6412,
    address: "Indiranagar, Bengaluru, Karnataka (demo property)",
    tariffSeedKey: null,
    dailyKwh: 14,
    weekday: HOME,
    weekend: [HOME_WEEKEND, HOME_WEEKEND],
    month: [0.95, 1.0, 1.1, 1.15, 1.1, 0.95, 0.9, 0.9, 0.92, 0.95, 0.95, 0.95],
    noise: 0.15,
    solar: { name: "Roof array", capacityKwp: 5, tiltDeg: 13, azimuthDeg: 180 },
    battery: { name: "Home battery", capacityKwh: 10, maxChargeKw: 5, maxDischargeKw: 5 },
    ev: { name: "Family car", batteryKwh: 30, chargerKw: 7.4, targetSoc: 0.9, currentSoc: 0.4, departureTime: "08:30", departureDays: [0, 1, 2, 3, 4] },
    appliances: [
      { name: "Refrigerator", kind: "refrigerator", priority: "CRITICAL", ratedPowerW: 150 },
      { name: "Washing machine", kind: "washing machine", priority: "FLEXIBLE", ratedPowerW: 2000, earliestStart: "08:00", latestFinish: "20:00", durationMin: 120 },
      { name: "Dishwasher", kind: "dishwasher", priority: "FLEXIBLE", ratedPowerW: 1800, earliestStart: "13:00", latestFinish: "23:00", durationMin: 90 },
    ],
    story: "A family home with rooftop solar, a battery and an electric car, on an invented time-of-day tariff (Karnataka has no sourced plan here).",
  },
  {
    key: "pune-shop",
    name: "Demo shop, Pune",
    city: "Pune",
    latitude: 18.5204,
    longitude: 73.8567,
    address: "Shivajinagar, Pune, Maharashtra (demo property)",
    tariffSeedKey: "curated:shop-pune",
    dailyKwh: 32,
    weekday: SHOP,
    weekend: [SHOP, SHOP_SUNDAY],
    month: [0.9, 0.95, 1.05, 1.15, 1.15, 1.0, 0.9, 0.9, 0.95, 1.0, 0.95, 0.9],
    noise: 0.12,
    solar: { name: "Shop roof", capacityKwp: 8, tiltDeg: 18, azimuthDeg: 180 },
    battery: null,
    ev: null,
    appliances: [
      { name: "Display chiller", kind: "refrigerator", priority: "CRITICAL", ratedPowerW: 400 },
      { name: "Water pump", kind: "pump", priority: "FLEXIBLE", ratedPowerW: 1500, earliestStart: "07:00", latestFinish: "19:00", durationMin: 60 },
    ],
    story: "A shop open 9 to 9 and closed on Sundays, with solar and no battery, on the MSEDCL LT II plan from the catalogue.",
  },
  {
    key: "jaipur-clinic",
    name: "Demo clinic, Jaipur",
    city: "Jaipur",
    latitude: 26.9124,
    longitude: 75.7873,
    address: "C-Scheme, Jaipur, Rajasthan (demo property)",
    tariffSeedKey: "curated:clinic-jaipur",
    dailyKwh: 48,
    weekday: CLINIC,
    weekend: [CLINIC, CLINIC_SUNDAY],
    month: [0.85, 0.9, 1.05, 1.25, 1.4, 1.35, 1.15, 1.1, 1.1, 1.0, 0.9, 0.85],
    noise: 0.1,
    solar: { name: "Clinic roof", capacityKwp: 10, tiltDeg: 25, azimuthDeg: 180 },
    battery: { name: "Backup battery", capacityKwh: 15, maxChargeKw: 6, maxDischargeKw: 6, reserveSoc: 0.3 },
    ev: null,
    appliances: [
      { name: "Vaccine refrigerator", kind: "refrigerator", priority: "CRITICAL", ratedPowerW: 300 },
      { name: "Autoclave", kind: "sterilizer", priority: "FLEXIBLE", ratedPowerW: 3000, earliestStart: "09:00", latestFinish: "17:00", durationMin: 60 },
    ],
    story: "A clinic with a vaccine refrigerator that must not lose power, solar and a backup battery, on the Rajasthan NDS plan from the catalogue.",
  },
  {
    key: "mathura-home",
    name: "Demo home, Mathura",
    city: "Mathura",
    latitude: 27.4924,
    longitude: 77.6737,
    address: "Mathura, Uttar Pradesh (demo property)",
    tariffSeedKey: "curated:home-mathura",
    dailyKwh: 9,
    weekday: HOME,
    weekend: [HOME_WEEKEND, HOME_WEEKEND],
    month: [0.8, 0.85, 1.0, 1.3, 1.55, 1.6, 1.35, 1.3, 1.25, 1.05, 0.85, 0.8],
    noise: 0.15,
    solar: null,
    battery: null,
    ev: null,
    appliances: [
      { name: "Refrigerator", kind: "refrigerator", priority: "CRITICAL", ratedPowerW: 150 },
      { name: "Air conditioner", kind: "air conditioner", priority: "IMPORTANT", ratedPowerW: 1500 },
      { name: "Water pump", kind: "pump", priority: "FLEXIBLE", ratedPowerW: 750, earliestStart: "05:00", latestFinish: "21:00", durationMin: 30 },
    ],
    story: "A home with no solar yet and hot summers, on the UPPCL domestic plan from the catalogue: the place to try a what-if.",
  },
];

/** 32-bit FNV-1a, so a seed is a pure function of its text. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The local (IST) calendar date of an instant, YYYY-MM-DD. */
export function istDate(ms: number): string {
  return new Date(ms + IST_MS).toISOString().slice(0, 10);
}

/** Midnight IST at the start of the local day containing `ms`, as a UTC instant. */
export function istMidnight(ms: number): number {
  return Math.floor((ms + IST_MS) / DAY_MS) * DAY_MS - IST_MS;
}

/**
 * One local day of hourly readings for a site, kWh per hour, 24 values. A pure function of the site and the date: the seed is
 * the site key and the date, so the same day always gives the same readings.
 */
export function demoDay(site: DemoSite, date: string): number[] {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 Sunday .. 6 Saturday
  const shape = dow === 6 ? site.weekend[0] : dow === 0 ? site.weekend[1] : site.weekday;
  const sum = site.weekday.reduce((a, b) => a + b, 0);
  const dayKwh = site.dailyKwh * site.month[d.getUTCMonth()]!;
  const r = rng(fnv1a(`${site.key}:${date}`));
  // a day-to-day swing shared by all its hours (visitors, a hot afternoon), then each hour's own variation
  const dayFactor = lognormal(r, 1, 0.08);
  return shape.map((s) => Math.round(((dayKwh * s) / sum) * dayFactor * lognormal(r, 1, site.noise) * 1000) / 1000);
}

/** The demo meter file for a site: `days` whole local days of hourly readings ending at the IST midnight before `endMs`. */
export function demoMeterCsv(site: DemoSite, endMs: number, days = DEMO_DAYS): { csv: string; from: string; to: string; rows: number } {
  const end = istMidnight(endMs);
  const lines = ["timestamp,usage_kwh"];
  for (let k = days; k >= 1; k--) {
    const dayStart = end - k * DAY_MS;
    const date = istDate(dayStart);
    demoDay(site, date).forEach((kwh, h) => {
      const hh = String(h).padStart(2, "0");
      lines.push(`${date}T${hh}:00:00+05:30,${kwh}`);
    });
  }
  return { csv: lines.join("\n") + "\n", from: istDate(end - days * DAY_MS), to: istDate(end - DAY_MS), rows: days * 24 };
}
