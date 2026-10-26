import { describe, expect, it } from "vitest";
import { buildGrid, cellOf, cellPolygon } from "../src/city/grid.js";

const BENGALURU = { latitude: 12.9784, longitude: 77.6408 };

describe("the grid a city map is drawn on", () => {
  const g = buildGrid(BENGALURU.latitude, BENGALURU.longitude, 8, 4);

  it("is a square of equal cells around the centre", () => {
    expect(g.cells).toHaveLength(16);
    expect(g.cellKm).toBe(2);
    expect(g.cells.map((c) => c.id)).toContain("r0c0");
    expect(g.cells.map((c) => c.id)).toContain("r3c3");
    const widths = g.cells.map((c) => c.bounds.east - c.bounds.west);
    const heights = g.cells.map((c) => c.bounds.north - c.bounds.south);
    // equal to within the rounding of the bounds, which is 6 decimals of a degree: about 11 cm
    for (const w of widths) expect(w).toBeCloseTo(widths[0]!, 5);
    for (const h of heights) expect(h).toBeCloseTo(heights[0]!, 5);
  });

  it("covers the span asked for, and no more: 8 km across at this latitude", () => {
    const north = Math.max(...g.cells.map((c) => c.bounds.north));
    const south = Math.min(...g.cells.map((c) => c.bounds.south));
    const west = Math.min(...g.cells.map((c) => c.bounds.west));
    const east = Math.max(...g.cells.map((c) => c.bounds.east));
    expect((north - south) * 110.574).toBeCloseTo(8, 1); // km
    expect((east - west) * 111.32 * Math.cos((BENGALURU.latitude * Math.PI) / 180)).toBeCloseTo(8, 1);
    expect((north + south) / 2).toBeCloseTo(BENGALURU.latitude, 6);
    expect((west + east) / 2).toBeCloseTo(BENGALURU.longitude, 6);
  });

  it("numbers rows from the north and columns from the west", () => {
    const topLeft = g.cells.find((c) => c.id === "r0c0")!;
    const bottomRight = g.cells.find((c) => c.id === "r3c3")!;
    expect(topLeft.bounds.north).toBeGreaterThan(bottomRight.bounds.north);
    expect(topLeft.bounds.west).toBeLessThan(bottomRight.bounds.west);
  });

  it("puts the centre point in a cell, and a point outside the grid in none", () => {
    expect(cellOf(g, BENGALURU.latitude, BENGALURU.longitude)).not.toBeNull();
    expect(cellOf(g, BENGALURU.latitude + 1, BENGALURU.longitude)).toBeNull();
    expect(cellOf(g, BENGALURU.latitude, BENGALURU.longitude - 1)).toBeNull();
  });

  it("puts every point of the grid in exactly one cell, edges included", () => {
    const n = Math.max(...g.cells.map((c) => c.bounds.north));
    const s = Math.min(...g.cells.map((c) => c.bounds.south));
    const w = Math.min(...g.cells.map((c) => c.bounds.west));
    const e = Math.max(...g.cells.map((c) => c.bounds.east));
    const points: [number, number][] = [];
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) points.push([s + ((n - s) * i) / 8, w + ((e - w) * j) / 8]);
    for (const [lat, lon] of points) {
      const hits = g.cells.filter((c) => cellOf(g, lat, lon)?.id === c.id);
      expect(hits.length, `${lat},${lon}`).toBe(1);
    }
  });

  it("gives each cell a closed polygon in GeoJSON order", () => {
    const p = cellPolygon(g.cells[0]!);
    expect(p.type).toBe("Polygon");
    expect(p.coordinates[0]).toHaveLength(5);
    expect(p.coordinates[0]![0]).toEqual(p.coordinates[0]![4]); // closed
    for (const [lon, lat] of p.coordinates[0]!) {
      expect(Math.abs(lon)).toBeLessThan(180); // longitude first, as GeoJSON requires
      expect(Math.abs(lat)).toBeLessThan(90);
    }
  });

  it("makes smaller cells of a smaller span, and the same grid for the same question", () => {
    expect(buildGrid(BENGALURU.latitude, BENGALURU.longitude, 4, 4).cellKm).toBe(1);
    expect(buildGrid(BENGALURU.latitude, BENGALURU.longitude, 8, 4)).toEqual(g);
  });
});
