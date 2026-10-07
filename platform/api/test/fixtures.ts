import type { Ring } from "../src/geo.js";
import { json } from "./helpers.js";

/** Realistic, deterministic provider responses shaped like the live APIs (verified against them). */

export function square(lat: number, lon: number, halfM = 10): Ring {
  const dLat = halfM / 111_320;
  const dLon = halfM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat - dLat],
    [lon + dLon, lat + dLat],
    [lon - dLon, lat + dLat],
    [lon - dLon, lat - dLat],
  ];
}

/** 48 hourly values starting at 00:00 UTC of the day containing `now`, so "the next 24 hours" is always covered. */
export function openMeteoBody(now: Date, over: { current?: Record<string, unknown>; hours?: number } = {}) {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const hours = over.hours ?? 48;
  const times = Array.from({ length: hours }, (_, h) => new Date(start + h * 3_600_000).toISOString().slice(0, 16));
  const sun = (t: string) => {
    const h = Number(t.slice(11, 13));
    return h >= 1 && h <= 12 ? Math.round(850 * Math.sin(((h - 0.5) / 12) * Math.PI)) : 0; // 01-12 UTC is 06:30-17:30 IST
  };
  return {
    latitude: 12.970123,
    longitude: 77.56364,
    elevation: 910,
    utc_offset_seconds: 0,
    timezone: "GMT",
    current: {
      time: new Date(Math.floor(now.getTime() / 900_000) * 900_000 - 600_000).toISOString().slice(0, 16),
      interval: 900,
      temperature_2m: 28.2,
      relative_humidity_2m: 53,
      cloud_cover: 27,
      wind_speed_10m: 1.99,
      precipitation: 0,
      shortwave_radiation: 530,
      ...over.current,
    },
    hourly: {
      time: times,
      temperature_2m: times.map(() => 26),
      relative_humidity_2m: times.map(() => 60),
      cloud_cover: times.map(() => 30),
      wind_speed_10m: times.map(() => 2),
      precipitation: times.map(() => 0),
      shortwave_radiation: times.map(sun),
      direct_normal_irradiance: times.map((t) => sun(t) * 0.7),
      diffuse_radiation: times.map((t) => sun(t) * 0.3),
    },
  };
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
export const POWER_ANNUAL_GHI = 5.4809;
export function powerBody() {
  const monthly = (annual: number) => ({ ...Object.fromEntries(MONTHS.map((m) => [m, annual])), ANN: annual });
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [77.59, 12.97, 841.72] },
    properties: {
      parameter: {
        ALLSKY_SFC_SW_DWN: monthly(POWER_ANNUAL_GHI),
        CLRSKY_SFC_SW_DWN: monthly(6.6418),
        ALLSKY_KT: monthly(0.56),
        T2M: monthly(23.74),
      },
    },
    header: { range: "20-year Meteorological and Solar Monthly & Annual Climatologies (January 2001 - December 2020)", fill_value: -999.0 },
  };
}

export function overpassBody(elements: unknown[]) {
  return { version: 0.6, generator: "Overpass API", elements };
}
export function buildingWay(id: number, ring: Ring, tags: Record<string, string> = { building: "yes" }) {
  return { type: "way", id, tags, geometry: ring.map(([lon, lat]) => ({ lat, lon })) };
}

export function stacBody(acquired = "2026-10-04T05:25:21.271000Z", cloud = 26.2) {
  return {
    features: [
      {
        id: "S2C_43PGQ_20261004_0_L2A",
        geometry: { type: "Polygon", coordinates: [[[77.4, 12.8], [77.9, 12.8], [77.9, 13.3], [77.4, 13.3], [77.4, 12.8]]] },
        properties: { datetime: acquired, platform: "sentinel-2c", instruments: ["msi"], "eo:cloud_cover": cloud, updated: "2026-10-04T12:09:34.232Z", "s2:product_type": "S2MSI2A", "s2:processing_baseline": "05.13" },
        assets: { thumbnail: { href: "https://example.test/preview.jpg" } },
      },
    ],
  };
}

export const LAT = 12.9716;
export const LON = 77.5946;

type Route = (u: URL) => Response | Promise<Response>;
export interface Routes {
  nominatim?: Route;
  openMeteo?: Route;
  power?: Route;
  overpass?: Route;
  stac?: Route;
}

/** Dispatch the fake network by host, like the real services. Anything not overridden answers with healthy fixtures. */
export function router(now: () => Date, over: Routes = {}): Route {
  return (u) => {
    const h = u.hostname;
    if (h.includes("nominatim")) return (over.nominatim ?? (() => json([])))(u);
    if (h.includes("open-meteo")) return (over.openMeteo ?? (() => json(openMeteoBody(now()))))(u);
    if (h.includes("nasa.gov")) return (over.power ?? (() => json(powerBody())))(u);
    if (h.includes("overpass")) return (over.overpass ?? (() => json(overpassBody([buildingWay(111, square(LAT, LON, 10))]))))(u);
    if (h.includes("element84")) return (over.stac ?? (() => json(stacBody())))(u);
    return json({ error: `unexpected host ${h}` }, 500);
  };
}
