/**
 * The base layers, and in particular what happens when a tile-URL variable is present but blank.
 *
 * `docker-compose.yml` passes `NEXT_PUBLIC_OSM_TILE_URL: ${NEXT_PUBLIC_OSM_TILE_URL:-}`, which is an **empty
 * string** whenever the operator has not chosen a tile service. `??` falls through only on null and undefined,
 * so that empty string became the tile URL: the map asked its own origin for `/{z}/{x}/{y}.png`, received Next's
 * 404 page, and failed to decode it as an image about twenty times over. Every containerised deployment had a
 * blank basemap, and it was invisible until the images were actually built and run on 2026-10-30.
 *
 * `basemaps.ts` reads the environment at module load, so each case re-imports it with `vi.resetModules()`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PUBLIC_OSM = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const KEYS = ["NEXT_PUBLIC_MAP_TILE_URL", "NEXT_PUBLIC_OSM_TILE_URL", "NEXT_PUBLIC_SATELLITE_TILE_URL"] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.resetModules();
});

/** Load basemaps.ts fresh, so it reads whatever the environment now holds. */
async function load() {
  vi.resetModules();
  return import("./basemaps");
}

const standardTiles = (m: { BASEMAPS: { id: string; tiles: string[] }[] }) => m.BASEMAPS.find((b) => b.id === "standard")!.tiles;
const satelliteTiles = (m: { BASEMAPS: { id: string; tiles: string[] }[] }) => m.BASEMAPS.find((b) => b.id === "satellite")!.tiles;

describe("the standard basemap's tile URL", () => {
  it("is the public OpenStreetMap server when nothing is set", async () => {
    expect(standardTiles(await load())).toEqual([PUBLIC_OSM]);
  });

  it("is the public server when the variable is present but empty", async () => {
    process.env.NEXT_PUBLIC_OSM_TILE_URL = "";
    expect(standardTiles(await load())).toEqual([PUBLIC_OSM]);
  });

  it("is the public server when the variable is only whitespace", async () => {
    process.env.NEXT_PUBLIC_MAP_TILE_URL = "   ";
    expect(standardTiles(await load())).toEqual([PUBLIC_OSM]);
  });

  it("is never a relative or empty template, whatever the variables hold", async () => {
    for (const value of ["", "  ", "\t"]) {
      process.env.NEXT_PUBLIC_MAP_TILE_URL = value;
      process.env.NEXT_PUBLIC_OSM_TILE_URL = value;
      const tiles = standardTiles(await load());
      for (const t of tiles) {
        expect(t.trim(), `tile template from ${JSON.stringify(value)}`).not.toBe("");
        expect(t.startsWith("http"), `tile template ${t} must be absolute, or the map asks its own origin`).toBe(true);
      }
    }
  });

  it("uses the service a deployment chooses, and prefers MAP_TILE_URL over OSM_TILE_URL", async () => {
    process.env.NEXT_PUBLIC_MAP_TILE_URL = "https://tiles.example.com/{z}/{x}/{y}.png";
    process.env.NEXT_PUBLIC_OSM_TILE_URL = "https://other.example.com/{z}/{x}/{y}.png";
    expect(standardTiles(await load())).toEqual(["https://tiles.example.com/{z}/{x}/{y}.png"]);
  });

  it("falls back to OSM_TILE_URL when MAP_TILE_URL is blank rather than absent", async () => {
    process.env.NEXT_PUBLIC_MAP_TILE_URL = "";
    process.env.NEXT_PUBLIC_OSM_TILE_URL = "https://chosen.example.com/{z}/{x}/{y}.png";
    expect(standardTiles(await load())).toEqual(["https://chosen.example.com/{z}/{x}/{y}.png"]);
  });
});

describe("the satellite basemap's tile URL", () => {
  it("is Esri World Imagery when the variable is absent or blank", async () => {
    expect(satelliteTiles(await load())[0]).toMatch(/^https:\/\/server\.arcgisonline\.com\//);
    process.env.NEXT_PUBLIC_SATELLITE_TILE_URL = "";
    expect(satelliteTiles(await load())[0]).toMatch(/^https:\/\/server\.arcgisonline\.com\//);
  });

  it("uses the service a deployment chooses", async () => {
    process.env.NEXT_PUBLIC_SATELLITE_TILE_URL = "https://sat.example.com/{z}/{y}/{x}";
    expect(satelliteTiles(await load())).toEqual(["https://sat.example.com/{z}/{y}/{x}"]);
  });
});

describe("every basemap", () => {
  it("has absolute tile templates, an attribution and a max zoom", async () => {
    const { BASEMAPS } = await load();
    expect(BASEMAPS.length).toBeGreaterThanOrEqual(3);
    for (const b of BASEMAPS) {
      expect(b.tiles.length).toBeGreaterThan(0);
      for (const t of b.tiles) expect(t.startsWith("http"), `${b.id}: ${t}`).toBe(true);
      // Tile servers require attribution, and a map without one would breach their usage policy.
      expect(b.attribution.trim()).not.toBe("");
      expect(b.maxzoom).toBeGreaterThan(0);
    }
  });

  it("produces a style whose raster source carries the tiles and the attribution", async () => {
    const { BASEMAPS, styleFor } = await load();
    for (const b of BASEMAPS) {
      const style = styleFor(b);
      const source = style.sources.base as { tiles: string[]; attribution: string; type: string };
      expect(source.type).toBe("raster");
      expect(source.tiles).toEqual(b.tiles);
      expect(source.attribution).toBe(b.attribution);
    }
  });
});
