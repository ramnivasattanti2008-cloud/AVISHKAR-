/**
 * The city energy map (spec section 49): a square of cells over a real place, each carrying the solar resource there and whichever of
 * the caller's own properties fall in it.
 *
 * What it does NOT do is the point of it. There is no source of a city's demand, storage, vehicles, flexibility or outage risk: no
 * meter data but the owner's own, no utility feed, no survey. So those are UNAVAILABLE with the reason, not modelled and not filled in
 * from an assumption. Only the caller's own properties appear; no other household's data exists in this system to expose.
 */
import type { ForecastDeps } from "../forecast/service.js";
import { buildGrid, cellOf, cellPolygon } from "./grid.js";
import type { CityDto, CityRequest } from "./schemas.js";
import { unavailable } from "../provenance/index.js";

const round = (v: number, d = 2): number => Math.round(v * 10 ** d) / 10 ** d;
type Solar = NonNullable<CityDto["cells"][number]["solar"]["value"]>;
type Yours = CityDto["yourTotals"];

const empty = (): Yours => ({ properties: 0, names: [], solarKwp: null, batteryKwh: null, evs: 0, flexibleKw: null, meanDailyKwh: null });

/** Run `work` over the items, at most `width` at a time: a city grid is up to 25 cells and the provider is a public service. */
async function pooled<T, R>(items: T[], width: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, async () => {
      for (let i = next++; i < items.length; i = next++) out[i] = await work(items[i]!);
    }),
  );
  return out;
}

export async function cityMap(deps: ForecastDeps, userId: string, req: CityRequest, ctx: { requestId?: string } = {}): Promise<CityDto> {
  const at = deps.now();
  const grid = buildGrid(req.latitude, req.longitude, req.spanKm, req.cellsPerSide);

  // the caller's own properties, placed in cells; nobody else's rows are read
  const rows = await deps.db.property.findMany({ where: { ownerId: userId, deletedAt: null }, select: { id: true, name: true, latitude: true, longitude: true } });
  const inside = rows.map((p) => ({ p, cell: cellOf(grid, p.latitude, p.longitude) })).filter((x) => x.cell !== null);
  const ids = inside.map((x) => x.p.id);
  const [solarRows, batteryRows, evRows, applianceRows, dnaRows] = await Promise.all([
    ids.length ? deps.db.solarSystem.findMany({ where: { propertyId: { in: ids }, status: "EXISTING" }, select: { propertyId: true, capacityKwp: true } }) : [],
    ids.length ? deps.db.battery.findMany({ where: { propertyId: { in: ids }, status: "EXISTING" }, select: { propertyId: true, capacityKwh: true } }) : [],
    ids.length ? deps.db.ev.findMany({ where: { propertyId: { in: ids } }, select: { propertyId: true } }) : [],
    ids.length ? deps.db.appliance.findMany({ where: { propertyId: { in: ids }, priority: "FLEXIBLE" }, select: { propertyId: true, ratedPowerW: true, quantity: true } }) : [],
    ids.length ? deps.db.energyDna.findMany({ where: { propertyId: { in: ids } }, orderBy: { version: "desc" }, select: { propertyId: true, meanDailyKwh: true } }) : [],
  ]);
  const latestDna = new Map<string, number>();
  for (const d of dnaRows) if (!latestDna.has(d.propertyId)) latestDna.set(d.propertyId, d.meanDailyKwh);

  const totalsFor = (propertyIds: string[], names: string[]): Yours => {
    const has = (id: string) => propertyIds.includes(id);
    const solar = solarRows.filter((r) => has(r.propertyId));
    const batt = batteryRows.filter((r) => has(r.propertyId));
    const flex = applianceRows.filter((r) => has(r.propertyId));
    const dna = propertyIds.map((id) => latestDna.get(id)).filter((v): v is number => v !== undefined);
    return {
      properties: propertyIds.length,
      names,
      solarKwp: solar.length ? round(solar.reduce((a, r) => a + r.capacityKwp, 0)) : null,
      batteryKwh: batt.length ? round(batt.reduce((a, r) => a + r.capacityKwh, 0)) : null,
      evs: evRows.filter((r) => has(r.propertyId)).length,
      flexibleKw: flex.length ? round(flex.reduce((a, r) => a + (r.ratedPowerW * r.quantity) / 1000, 0), 3) : null,
      meanDailyKwh: dna.length ? round(dna.reduce((a, v) => a + v, 0)) : null,
    };
  };

  // the solar resource at each cell's centre: the provider's own cache makes a repeat of the same square free
  const solars = await pooled(grid.cells, 4, async (c) => {
    try {
      const m = await deps.providers.solarResource.climatology(c.centre.latitude, c.centre.longitude, { requestId: ctx.requestId, now: deps.now });
      const v = m.value;
      const months = (v?.months ?? []).filter((x) => x.ghiKwhM2Day !== null) as { month: number; ghiKwhM2Day: number }[];
      if (!v || v.annual.ghiKwhM2Day === null || months.length === 0) {
        return unavailable<Solar>(m.provenance.notes[0] ?? "The solar-resource provider returned no annual value for this cell.", { provider: "nasa-power", source: "NASA POWER climatology", dataType: "solar_resource_cell", location: c.centre, now: at });
      }
      const best = months.reduce((a, x) => (x.ghiKwhM2Day > a.ghiKwhM2Day ? x : a), months[0]!);
      const worst = months.reduce((a, x) => (x.ghiKwhM2Day < a.ghiKwhM2Day ? x : a), months[0]!);
      return {
        value: {
          annualGhiKwhM2Day: round(v.annual.ghiKwhM2Day, 3),
          bestMonth: { month: best.month, ghiKwhM2Day: round(best.ghiKwhM2Day, 3) },
          worstMonth: { month: worst.month, ghiKwhM2Day: round(worst.ghiKwhM2Day, 3) },
          period: v.period,
        },
        unit: "kWh/m2/day",
        provenance: m.provenance,
      };
    } catch (e) {
      return unavailable<Solar>(`The solar resource could not be read for this cell: ${e instanceof Error ? e.message : "error"}.`, { provider: "nasa-power", source: "NASA POWER climatology", dataType: "solar_resource_cell", location: c.centre, now: at });
    }
  });

  const cells: CityDto["cells"] = grid.cells.map((c, i) => {
    const mine = inside.filter((x) => x.cell!.id === c.id);
    return {
      id: c.id,
      row: c.row,
      col: c.col,
      centre: c.centre,
      bounds: c.bounds,
      geojson: cellPolygon(c),
      solar: solars[i]!,
      yours: mine.length ? totalsFor(mine.map((x) => x.p.id), mine.map((x) => x.p.name)) : null,
    };
  });

  const values = cells.map((c) => c.solar.value?.annualGhiKwhM2Day).filter((v): v is number => v !== undefined && v !== null);
  const distinct = new Set(values).size;
  const solarSpread = values.length
    ? {
        distinctValues: distinct,
        lowest: Math.min(...values),
        highest: Math.max(...values),
        note:
          distinct === 1
            ? "Every cell returned the same value: over this square the provider cannot tell the cells apart, so the colours show one number, not a pattern."
            : `The cells differ by ${round(Math.max(...values) - Math.min(...values), 3)} kWh/m² per day, ${round(((Math.max(...values) - Math.min(...values)) / Math.min(...values)) * 100, 1)}% of the lowest. A difference this small is the model's grid showing through, not a roof-by-roof difference.`,
      }
    : null;

  const why = (what: string) => ({ status: "UNAVAILABLE" as const, reason: what });
  return {
    label: "CITY ENERGY MAP",
    madeAt: at.toISOString(),
    grid: { centre: grid.centre, spanKm: grid.spanKm, cellsPerSide: grid.cellsPerSide, cellKm: grid.cellKm },
    cells,
    solarSpread,
    yourTotals: inside.length ? totalsFor(inside.map((x) => x.p.id), inside.map((x) => x.p.name)) : empty(),
    cityWide: {
      demand: why("AVISHKAR has no source for how much electricity a city uses: the only meter data it holds is what you imported for your own properties. A figure here would be invented."),
      storage: why("No register of batteries in a city exists here, and nothing surveys them."),
      evs: why("No register of vehicles in a city exists here."),
      flexibility: why("Flexibility is what an owner says can move; nothing but your own entries says that, and nothing speaks for other households."),
      energyRisk: why("No outage, feeder or network data source is connected, so no risk can be stated for an area. The Resilience tab answers the same question for one property, from its own battery and critical load."),
    },
    notes: [
      "Only your own properties appear on this map. No other household's data exists in AVISHKAR to show, aggregate or infer.",
      "The solar resource is a 20-year climatology at each cell's centre, asked of the provider at a point rounded to about a kilometre. It is what the sun does there on average, not a forecast and not a measurement of a roof.",
      "For a simulated fleet of homes over a place, with its assumptions stated, use the virtual power plant simulator on the Community page. It is a simulation: it says nothing about real homes.",
    ],
  };
}
