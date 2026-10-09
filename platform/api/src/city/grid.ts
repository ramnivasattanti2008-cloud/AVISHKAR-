/**
 * The grid a city map is drawn on: a square of equal cells around a centre, on an equirectangular approximation (a city is small
 * enough for one). Pure, so the cells a value is reported for are exactly the cells the map draws.
 */

/** Metres per degree of latitude, and of longitude at a given latitude (WGS84, good to a metre or so over a city). */
const LAT_M_PER_DEG = 110_574;
const lonMPerDeg = (latitude: number): number => 111_320 * Math.cos((latitude * Math.PI) / 180);

export interface Cell {
  /** "r2c3": the row from the north, the column from the west, both from 0. */
  id: string;
  row: number;
  col: number;
  centre: { latitude: number; longitude: number };
  bounds: { west: number; south: number; east: number; north: number };
}

export interface Grid {
  centre: { latitude: number; longitude: number };
  spanKm: number;
  cellsPerSide: number;
  cellKm: number;
  cells: Cell[];
}

const round = (v: number, d = 6): number => Math.round(v * 10 ** d) / 10 ** d;

export function buildGrid(latitude: number, longitude: number, spanKm: number, cellsPerSide: number): Grid {
  const latSpan = (spanKm * 1000) / LAT_M_PER_DEG;
  const lonSpan = (spanKm * 1000) / Math.max(lonMPerDeg(latitude), 1); // near a pole the cells would be absurd; the caller's coordinates are checked elsewhere
  const latStep = latSpan / cellsPerSide;
  const lonStep = lonSpan / cellsPerSide;
  const north = latitude + latSpan / 2;
  const west = longitude - lonSpan / 2;
  const cells: Cell[] = [];
  for (let row = 0; row < cellsPerSide; row++) {
    for (let col = 0; col < cellsPerSide; col++) {
      const n = north - row * latStep;
      const s = n - latStep;
      const w = west + col * lonStep;
      const e = w + lonStep;
      cells.push({
        id: `r${row}c${col}`,
        row,
        col,
        centre: { latitude: round((n + s) / 2), longitude: round((w + e) / 2) },
        bounds: { west: round(w), south: round(s), east: round(e), north: round(n) },
      });
    }
  }
  return { centre: { latitude: round(latitude), longitude: round(longitude) }, spanKm, cellsPerSide, cellKm: round(spanKm / cellsPerSide, 3), cells };
}

/** The cell a point falls in, or null when it is outside the grid. The north and west edges belong to the cell, the south and east to the next one. */
export function cellOf(grid: Grid, latitude: number, longitude: number): Cell | null {
  return (
    grid.cells.find((c) => longitude >= c.bounds.west && longitude < c.bounds.east && latitude <= c.bounds.north && latitude > c.bounds.south) ??
    // the far south and east edges of the whole grid belong to the last cell, so a point exactly on them is not lost
    grid.cells.find((c) => c.row === grid.cellsPerSide - 1 && latitude === c.bounds.south && longitude >= c.bounds.west && longitude <= c.bounds.east) ??
    grid.cells.find((c) => c.col === grid.cellsPerSide - 1 && longitude === c.bounds.east && latitude <= c.bounds.north && latitude >= c.bounds.south) ??
    null
  );
}

export function cellPolygon(c: Cell): { type: "Polygon"; coordinates: [number, number][][] } {
  const { west: w, south: s, east: e, north: n } = c.bounds;
  return { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] };
}
