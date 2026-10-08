/**
 * The synthetic homes of a virtual power plant simulation (spec section 48). Every home is a draw from distributions the person
 * chose (or the defaults, which are assumptions, not data), scaled from one real property's own pattern. A seeded generator makes
 * a simulation repeatable: the same request always describes the same homes.
 */

/** mulberry32: a small, well-behaved seeded generator, uniform on [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A standard normal draw (Box-Muller). */
export function normal(r: () => number): number {
  const u = Math.max(r(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/** A positive draw with the given mean and coefficient of variation (lognormal), so a size is never negative. */
export function lognormal(r: () => number, mean: number, cv: number): number {
  if (cv <= 0) return mean;
  const s2 = Math.log(1 + cv * cv);
  return Math.exp(Math.log(mean) - s2 / 2 + Math.sqrt(s2) * normal(r));
}

export interface HomeParams {
  homes: number;
  /** Share of all homes with solar. */
  pvSharePercent: number;
  pvKwpMean: number;
  pvKwpCv: number;
  /** Share of the homes with solar that also have a battery. */
  batterySharePercent: number;
  batteryKwhMean: number;
  evSharePercent: number;
  loadCv: number;
  seed: number;
}

export interface Fleet {
  homes: number;
  withPv: number;
  withBattery: number;
  withEv: number;
  /** Sum of every home's load scale: the aggregate load is this times the archetype's hourly pattern. */
  loadScale: number;
  pvKwp: number;
  batteryKwh: number;
}

/** Draw the homes and add them up. The result is the whole fleet: only sums are kept, never a household's own numbers. */
export function drawFleet(p: HomeParams): Fleet {
  const r = rng(p.seed);
  const f: Fleet = { homes: p.homes, withPv: 0, withBattery: 0, withEv: 0, loadScale: 0, pvKwp: 0, batteryKwh: 0 };
  for (let i = 0; i < p.homes; i++) {
    f.loadScale += lognormal(r, 1, p.loadCv);
    const pv = r() < p.pvSharePercent / 100;
    if (pv) {
      f.withPv++;
      f.pvKwp += lognormal(r, p.pvKwpMean, p.pvKwpCv);
      // batteries go with solar: this share is of the homes that have it
      if (r() < p.batterySharePercent / 100) {
        f.withBattery++;
        f.batteryKwh += lognormal(r, p.batteryKwhMean, 0.3);
      }
    }
    if (r() < p.evSharePercent / 100) f.withEv++;
  }
  return f;
}
