/** Small planar-geometry helpers for building-sized shapes. Rings are GeoJSON style: [longitude, latitude] pairs. */

export type Ring = [number, number][];

const R = 6_371_008.8; // mean Earth radius, metres
const rad = (d: number) => (d * Math.PI) / 180;

export function isClosed(ring: Ring): boolean {
  const a = ring[0];
  const b = ring[ring.length - 1];
  return ring.length >= 4 && a !== undefined && b !== undefined && a[0] === b[0] && a[1] === b[1];
}

/** Project to metres around a reference latitude/longitude (equirectangular; accurate to well under 1% at building scale). */
function project(ring: Ring, lat0: number, lon0: number): [number, number][] {
  const k = Math.cos(rad(lat0));
  return ring.map(([lon, lat]) => [R * rad(lon - lon0) * k, R * rad(lat - lat0)]);
}

export function polygonAreaM2(ring: Ring): number {
  if (!isClosed(ring)) return 0;
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const lon0 = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const pts = project(ring, lat0, lon0);
  let a = 0;
  for (let i = 0; i < pts.length - 1; i++) a += pts[i]![0] * pts[i + 1]![1] - pts[i + 1]![0] * pts[i]![1];
  return Math.abs(a) / 2;
}

export function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Shortest distance in metres from a point to the outline of a ring (0 when the point is on the outline). */
export function distanceToRingM(lon: number, lat: number, ring: Ring): number {
  const pts = project(ring, lat, lon); // the point is the origin
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[i + 1]!;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / len2));
    best = Math.min(best, Math.hypot(x1 + t * dx, y1 + t * dy));
  }
  return best;
}
