import { AppError } from "../errors.js";
import type { Db } from "../db.js";
import type { DataQuality, EnergyTwin, GeometryKind, Prisma, SatelliteObservation } from "../generated/prisma/client.js";
import { type Measured, estimated, forecast, reference, unavailable } from "../provenance/index.js";
import { type PropertyDto, type PropertyPolicy, getProperty } from "../properties/service.js";
import type { Footprint } from "../providers/footprint.js";
import type { Providers } from "../providers/index.js";
import type { SatelliteScene } from "../providers/satellite.js";
import { type AssetSnapshot, profilesFromSnapshot, summariseAssets } from "../assets/service.js";
import { latestDna } from "../energy/service.js";
import type { TwinTariffSchema } from "../schemas-twin.js";
import { type TariffPlanDto, getTariffRow, toTariffDto } from "../tariff/service.js";
import type { z } from "zod";
import { type Assumption, ASSUMPTIONS, completeness, estimatePv, nextDayIrradiation } from "./estimate.js";

export type TwinTariff = z.infer<typeof TwinTariffSchema>;

export interface TwinDeps {
  db: Db;
  providers: Providers;
  now: () => Date;
  policy: PropertyPolicy;
}

export interface SourceRecord {
  provider: string;
  dataType: string;
  status: string;
  ok: boolean;
  at: string;
  note: string;
}

export interface Gap {
  what: string;
  reason: string;
}

export interface TwinDto {
  id: string;
  propertyId: string;
  version: number;
  createdAt: string;
  reason: string;
  dataQuality: DataQuality;
  confidence: number;
  confidenceMeaning: string;
  confidenceBasis: { item: string; weight: number; available: boolean }[];
  location: { latitude: number; longitude: number; elevationM: number | null };
  geometry: { kind: GeometryKind | null; roofAreaM2: Measured<number> };
  solar: {
    annualGhiKwhM2Day: Measured<number>;
    clearSkyKwhM2Day: Measured<number>;
    clearnessIndex: Measured<number>;
    usableRoofAreaM2: Measured<number>;
    capacityKwEstimate: Measured<number>;
    yieldKwhPerKwpDay: Measured<number>;
    estimatedDailyGenerationKwh: Measured<number>;
    forecastNext24hGhiKwhM2: Measured<number>;
    forecastNext24hKwhPerKwp: Measured<number>;
  };
  satellite: Measured<SatelliteScene | null>;
  consumption: { estimatedDailyLoadKwh: Measured<number> };
  /** What the owner has entered: battery, solar system, electric vehicle, appliances (spec section 8). */
  profiles: ReturnType<typeof profilesFromSnapshot>;
  tariff: Measured<TwinTariff>;
  energyAutonomyScore: Measured<number>;
  warnings: string[];
  sources: SourceRecord[];
  assumptions: Assumption[];
  unavailable: Gap[];
}

const CONFIDENCE_MEANING =
  "Share of the inputs a complete Energy Twin needs that are available (weighted). It measures how complete the data is, not the probability that an estimate is right.";
const TWIN = "avishkar-twin";

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };
const settle = <T>(p: Promise<T>): Promise<Settled<T>> => p.then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error }));
const why = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function userGeometry(p: PropertyDto): { kind: GeometryKind; areaM2: number } | null {
  const items = [...p.geometry.items].sort((a, b) => (a.kind === b.kind ? b.areaM2 - a.areaM2 : a.kind === "USER_POLYGON" ? -1 : 1));
  return items[0] ? { kind: items[0].kind, areaM2: items[0].areaM2 } : null;
}

async function storeFootprint(db: Db, propertyId: string, fp: Footprint): Promise<void> {
  const geojson = JSON.stringify({ type: "Polygon", coordinates: [fp.ring] });
  await db.$executeRaw`
    INSERT INTO property_geometry (id, property_id, kind, geom, area_m2, source, source_ref, created_at)
    VALUES (gen_random_uuid(), ${propertyId}::uuid, 'BUILDING_FOOTPRINT'::"GeometryKind",
            ST_SetSRID(ST_GeomFromGeoJSON(${geojson}::text), 4326),
            ST_Area(ST_SetSRID(ST_GeomFromGeoJSON(${geojson}::text), 4326)::geography),
            'overpass-osm', ${fp.sourceRef}, now())`;
}

export async function storeScenes(db: Db, provider: string, scenes: SatelliteScene[], now: Date): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const s of scenes) {
    const data = {
      satellite: s.satellite,
      sensor: s.sensor,
      acquiredAt: new Date(s.acquiredAt),
      processedAt: s.processedAt ? new Date(s.processedAt) : null,
      cloudPercent: s.cloudPercent,
      footprint: s.footprint as never,
      source: s.source,
      processingStatus: s.processingStatus,
      thumbnailUrl: s.thumbnailUrl,
      fetchedAt: now,
    };
    const row = await db.satelliteObservation.upsert({ where: { provider_sceneId: { provider, sceneId: s.id } }, create: { provider, sceneId: s.id, ...data }, update: data });
    ids.set(s.id, row.id);
  }
  return ids;
}

/**
 * Build a new Energy Twin snapshot for a property from every real source we can reach (spec sections 7, 8, 10, 11).
 * A source that fails is recorded as failed and its part of the twin is left empty; nothing is invented.
 */
export async function analyzeProperty(deps: TwinDeps, userId: string, propertyId: string, ctx: { requestId?: string } = {}): Promise<TwinDto> {
  const { db, providers } = deps;
  const now = deps.now();
  let prop = await getProperty(db, userId, propertyId, deps.policy);
  const { latitude, longitude } = prop;
  const c = { requestId: ctx.requestId, now: deps.now };

  const [solar, weather, footprint, sat] = await Promise.all([
    settle(providers.solarResource.climatology(latitude, longitude, c)),
    settle(providers.weather.forecast(latitude, longitude, { days: 2 }, c)),
    prop.geometry.items.length ? Promise.resolve(null) : settle(providers.footprints.find(latitude, longitude, { radiusM: 30 }, c)),
    settle(providers.satellite.latest(latitude, longitude, { limit: 5 }, c)),
  ]);

  const sources: SourceRecord[] = [];
  const gaps: Gap[] = [];
  const warnings = [...prop.warnings];
  const at = now.toISOString();
  const rec = (provider: string, dataType: string, status: string, ok: boolean, note: string) => sources.push({ provider, dataType, status, ok, at, note });

  // --- solar resource
  let ghi: number | null = null;
  let clearSky: number | null = null;
  let kt: number | null = null;
  let elevationM: number | null = null;
  if (solar.ok && solar.value.value) {
    const a = solar.value.value.annual;
    ghi = a.ghiKwhM2Day;
    clearSky = a.clearSkyKwhM2Day;
    kt = a.clearnessIndex;
    elevationM = solar.value.value.elevationM;
    rec("nasa-power", "solar_resource_climatology", solar.value.provenance.status, true, `Annual average ${ghi?.toFixed(2)} kWh/m2/day, ${solar.value.value.period}.`);
  } else {
    const reason = solar.ok ? "no value returned" : why(solar.error);
    rec("nasa-power", "solar_resource_climatology", "UNAVAILABLE", false, reason);
    gaps.push({ what: "Solar resource", reason });
  }

  // --- weather and the next 24 hours
  let nextDay: { kwhPerM2: number; hours: number } | null = null;
  if (weather.ok) {
    const pts = weather.value.hourly.global_horizontal_irradiance?.value ?? [];
    nextDay = nextDayIrradiation(pts, now);
    rec("open-meteo", "weather_forecast", weather.value.stale ? "UPDATED" : "FORECAST", true, weather.value.stale ? `Stale copy fetched ${weather.value.fetchedAt}.` : `Hourly forecast fetched ${weather.value.fetchedAt}.`);
    if (!nextDay) gaps.push({ what: "Irradiation forecast for the next 24 hours", reason: "The forecast does not cover a full 24 hours; nothing is extrapolated." });
  } else {
    const reason = why(weather.error);
    rec("open-meteo", "weather_forecast", "UNAVAILABLE", false, reason);
    gaps.push({ what: "Weather and 24-hour irradiation forecast", reason });
  }

  // --- building outline
  if (footprint) {
    if (footprint.ok && footprint.value.value) {
      try {
        await storeFootprint(db, propertyId, footprint.value.value);
        rec("overpass", "building_footprint", "REFERENCE", true, `${footprint.value.value.sourceRef}, ${Math.round(footprint.value.value.areaM2)} m2${footprint.value.value.containsPoint ? "" : `, ${Math.round(footprint.value.value.distanceM)} m from the point`}.`);
        const levels = Number(footprint.value.value.tags.levels);
        if (Number.isFinite(levels) && levels > 3) warnings.push(`OpenStreetMap lists ${levels} levels: the roof is probably shared by several households, so the usable area for one of them is smaller.`);
        prop = await getProperty(db, userId, propertyId, deps.policy);
      } catch (e) {
        rec("overpass", "building_footprint", "UNAVAILABLE", false, `Outline found but rejected: ${why(e)}`);
        gaps.push({ what: "Building outline", reason: "An outline was found in OpenStreetMap but is not a valid shape." });
      }
    } else {
      const reason = footprint.ok ? (footprint.value.provenance.notes[0] ?? "No building outline found.") : why(footprint.error);
      rec("overpass", "building_footprint", "UNAVAILABLE", false, reason);
      gaps.push({ what: "Building outline", reason });
    }
  } else {
    rec("user-or-stored", "property_geometry", "REFERENCE", true, "An outline was already stored for this property.");
  }
  const geo = userGeometry(prop);
  if (!geo && !gaps.some((g) => g.what === "Building outline")) gaps.push({ what: "Building outline", reason: "No outline is stored. Draw the roof on the map to get a capacity estimate." });

  // --- satellite
  let sceneId: string | null = null;
  if (sat.ok && sat.value.value?.length) {
    const ids = await storeScenes(db, "earth-search", sat.value.value, now);
    sceneId = ids.get(sat.value.value[0]!.id) ?? null;
    rec("earth-search", "satellite_scenes", sat.value.provenance.status, true, `Latest Sentinel-2 scene acquired ${sat.value.value[0]!.acquiredAt}, ${sat.value.value[0]!.cloudPercent ?? "unknown"}% cloud.`);
  } else {
    const reason = sat.ok ? "no scene found" : why(sat.error);
    rec("earth-search", "satellite_scenes", "UNAVAILABLE", false, reason);
    gaps.push({ what: "Satellite scene", reason });
  }

  // --- the owner's own meter data (as the Energy DNA built from it) and what they have entered about the property
  const [dna, assets] = await Promise.all([latestDna(db, propertyId), summariseAssets(db, propertyId, now)]);
  const snapshot: AssetSnapshot = {
    ...assets,
    load: dna ? { dnaId: dna.id, meanDailyKwh: dna.meanDailyKwh, completeDays: dna.completeDays, from: dna.fromTs.toISOString(), to: dna.toTs.toISOString() } : null,
  };
  if (dna) rec("avishkar-energy-dna", "mean_daily_load", "ESTIMATED", true, `${dna.meanDailyKwh} kWh a day over ${dna.completeDays} complete days of your meter readings.`);
  else gaps.push({ what: "Electricity consumption", reason: "No meter data has been imported for this property; AVISHKAR does not guess a household's load. Import a meter file on the Meter data tab." });
  const kinds = [assets.battery && "battery", assets.solar && "solar system", assets.ev && "electric vehicle", assets.appliances && "appliances"].filter(Boolean);
  if (kinds.length) rec("user", "assets", "REFERENCE", true, `Entered by the owner: ${kinds.join(", ")}.`);

  // --- the tariff the owner chose, copied into this version so later edits to the plan do not rewrite history
  let tariff: TariffPlanDto | null = null;
  if (prop.tariffPlanId) {
    try {
      tariff = toTariffDto(await getTariffRow(db, userId, prop.tariffPlanId), now);
      rec("avishkar-tariffs", "tariff_plan", "REFERENCE", true, `${tariff.name}: ${tariff.validity.message}`);
    } catch (e) {
      rec("avishkar-tariffs", "tariff_plan", "UNAVAILABLE", false, why(e));
    }
  }
  if (!tariff) gaps.push({ what: "Electricity tariff", reason: "Tariff data unavailable for this property: choose your state, distribution company and consumer category, or enter your rates." });

  // --- estimates
  const pv = estimatePv({ roofAreaM2: geo?.areaM2 ?? null, ghiKwhM2Day: ghi });
  const kwhPerKwp = nextDay ? nextDay.kwhPerM2 * ASSUMPTIONS.performanceRatio.value : null;
  const comp = completeness({
    location: true,
    solarResource: ghi !== null,
    weather: weather.ok,
    geometry: geo !== null,
    satellite: sceneId !== null,
    loadProfile: dna !== null,
    tariff: tariff !== null,
  });

  // --- persist a new version
  const used: Assumption[] = pv.capacityKw !== null ? Object.values(ASSUMPTIONS) : [ASSUMPTIONS.performanceRatio];
  const data = {
    propertyId,
    reason: "analyze",
    dataQuality: comp.quality,
    confidence: comp.confidence,
    confidenceBasis: comp.basis as never,
    latitude,
    longitude,
    elevationM,
    geometryKind: geo?.kind ?? null,
    roofAreaM2: geo?.areaM2 ?? null,
    usableRoofAreaM2: pv.usableAreaM2,
    solarCapacityKwEstimate: pv.capacityKw,
    ghiKwhM2Day: ghi,
    clearSkyKwhM2Day: clearSky,
    clearnessIndex: kt,
    yieldKwhPerKwpDay: pv.yieldKwhPerKwpDay,
    estimatedDailyGenerationKwh: pv.dailyGenerationKwh,
    forecastNext24hGhiKwhM2: nextDay?.kwhPerM2 ?? null,
    forecastNext24hKwhPerKwp: kwhPerKwp,
    satelliteObservationId: sceneId,
    tariffPlanId: tariff?.id ?? null,
    tariffSnapshot: tariff ? (tariff as unknown as Prisma.InputJsonValue) : undefined,
    meanDailyLoadKwh: dna?.meanDailyKwh ?? null,
    energyDnaId: dna?.id ?? null,
    assetsSnapshot: snapshot as unknown as Prisma.InputJsonValue,
    sources: sources as never,
    assumptions: used as never,
    unavailable: gaps as never,
  };
  let row: EnergyTwin | undefined;
  for (let attempt = 0; attempt < 3 && !row; attempt++) {
    const last = await db.energyTwin.findFirst({ where: { propertyId }, orderBy: { version: "desc" }, select: { version: true } });
    try {
      row = await db.energyTwin.create({ data: { ...data, version: (last?.version ?? 0) + 1, createdAt: now } });
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002" || attempt === 2) throw e; // two analyses raced for the same version number
    }
  }
  const scene = sceneId ? await db.satelliteObservation.findUnique({ where: { id: sceneId } }) : null;
  return toTwinDto(row!, scene, warnings);
}

export async function getLatestTwin(deps: TwinDeps, userId: string, propertyId: string): Promise<TwinDto> {
  await getProperty(deps.db, userId, propertyId, deps.policy); // ownership
  const row = await deps.db.energyTwin.findFirst({ where: { propertyId }, orderBy: { version: "desc" } });
  if (!row) throw new AppError("NOT_FOUND", "No Energy Twin yet for this property. Run an analysis first.");
  const scene = row.satelliteObservationId ? await deps.db.satelliteObservation.findUnique({ where: { id: row.satelliteObservationId } }) : null;
  return toTwinDto(row, scene, []);
}

export async function listTwinVersions(deps: TwinDeps, userId: string, propertyId: string) {
  await getProperty(deps.db, userId, propertyId, deps.policy);
  const rows = await deps.db.energyTwin.findMany({ where: { propertyId }, orderBy: { version: "desc" }, select: { id: true, version: true, createdAt: true, reason: true, dataQuality: true, confidence: true } });
  return rows.map((r) => ({ id: r.id, version: r.version, createdAt: r.createdAt.toISOString(), reason: r.reason, dataQuality: r.dataQuality, confidence: r.confidence }));
}

function sceneFromRow(s: SatelliteObservation): SatelliteScene {
  return {
    id: s.sceneId,
    satellite: s.satellite,
    sensor: s.sensor,
    acquiredAt: s.acquiredAt.toISOString(),
    processedAt: s.processedAt?.toISOString() ?? null,
    cloudPercent: s.cloudPercent,
    footprint: s.footprint as SatelliteScene["footprint"],
    source: s.source,
    processingStatus: s.processingStatus,
    thumbnailUrl: s.thumbnailUrl,
  };
}

/** Daily consumption from the owner's meter readings, or UNAVAILABLE with the reason when none had been imported. */
function loadOf(row: EnergyTwin, snap: AssetSnapshot | null, base: (provider: string, source: string, dataType: string) => Parameters<typeof unavailable>[1]): Measured<number> {
  const load = snap?.load;
  if (row.meanDailyLoadKwh === null || !load) {
    return unavailable<number>("No meter data had been imported when this twin was built; AVISHKAR does not guess a household's load. Import a meter file to get one.", { ...base(TWIN, "AVISHKAR Energy Twin", "daily_load"), unit: "kWh/day" });
  }
  return estimated(row.meanDailyLoadKwh, {
    ...base("avishkar-energy-dna", "Your imported meter readings", "daily_load"),
    unit: "kWh/day",
    basis: `the mean of ${load.completeDays} complete days of your meter readings, ${load.from.slice(0, 10)} to ${load.to.slice(0, 10)}`,
  });
}

/** The tariff a twin was built with, read back from its snapshot; UNAVAILABLE (with the usual reason) when none was chosen. */
function tariffOf(snap: TariffPlanDto | null, planId: string | null, fallback: Parameters<typeof unavailable>[1]): Measured<TwinTariff> {
  if (!snap) return unavailable<TwinTariff>("Tariff data unavailable: choose your state, distribution company and consumer category, or enter your rates.", fallback);
  const rates = snap.slabs ? snap.slabs.map((s) => s.rate) : snap.hourlyRates;
  return {
    value: {
      planId,
      name: snap.name,
      state: snap.state,
      discom: snap.discom,
      category: snap.category,
      consumerType: snap.consumerType,
      rateRangeInrPerKwh: { min: Math.min(...rates), max: Math.max(...rates) },
      timeOfDay: new Set(snap.hourlyRates).size > 1,
      hasSlabs: snap.slabs !== null,
      fixedCharge: snap.fixedCharge,
      exportRateInrPerKwh: snap.export.rate,
      exportRateBasis: snap.export.basis,
      validity: snap.validity,
      source: snap.source,
    },
    unit: "INR/kWh",
    provenance: snap.provenance,
  };
}

/** Rebuild the labelled view of a stored snapshot. Provenance is derived from where each number came from. */
export function toTwinDto(row: EnergyTwin, scene: SatelliteObservation | null, warnings: string[]): TwinDto {
  const where = { latitude: row.latitude, longitude: row.longitude };
  const t = row.createdAt;
  const base = (provider: string, source: string, dataType: string) => ({ provider, source, dataType, location: where, now: t });
  const num = (v: number | null, reason: string, dataType: string, mk: (v: number) => Measured<number>): Measured<number> =>
    v === null ? unavailable<number>(reason, base(TWIN, "AVISHKAR Energy Twin", dataType)) : mk(v);
  const resource = (v: number | null, dataType: string, unit: string) =>
    num(v, "Solar resource was not available when this twin was built.", dataType, (x) => reference(x, { ...base("nasa-power", "NASA POWER climatology", dataType), unit }));
  const est = (v: number | null, dataType: string, unit: string, basis: string, reason: string) =>
    num(v, reason, dataType, (x) => estimated(x, { ...base(TWIN, "AVISHKAR estimate", dataType), unit, basis }));
  const noRoof = "No roof or plot outline is stored for this property, so no capacity is estimated.";
  const roofBasis = `${ASSUMPTIONS.usableRoofFraction.value * 100}% of the roof usable, ${1 / ASSUMPTIONS.kwpPerM2Usable.value} m2 per kWp, performance ratio ${ASSUMPTIONS.performanceRatio.value}`;
  const roofProvider = row.geometryKind === "BUILDING_FOOTPRINT" ? ["overpass", "OpenStreetMap building outline"] : ["user", "Outline drawn by the property owner"];
  const fcReason = "The weather forecast was not available or did not cover 24 hours when this twin was built.";
  const validFor = new Date(t.getTime() + 24 * 3_600_000);
  const snap = (row.assetsSnapshot as unknown as AssetSnapshot | null) ?? null;

  return {
    id: row.id,
    propertyId: row.propertyId,
    version: row.version,
    createdAt: t.toISOString(),
    reason: row.reason,
    dataQuality: row.dataQuality,
    confidence: row.confidence,
    confidenceMeaning: CONFIDENCE_MEANING,
    confidenceBasis: row.confidenceBasis as TwinDto["confidenceBasis"],
    location: { latitude: row.latitude, longitude: row.longitude, elevationM: row.elevationM },
    geometry: {
      kind: row.geometryKind,
      roofAreaM2: num(row.roofAreaM2, noRoof, "roof_area", (x) => reference(x, { ...base(roofProvider[0]!, roofProvider[1]!, "roof_area"), unit: "m2" })),
    },
    solar: {
      annualGhiKwhM2Day: resource(row.ghiKwhM2Day, "annual_ghi", "kWh/m2/day"),
      clearSkyKwhM2Day: resource(row.clearSkyKwhM2Day, "annual_clear_sky_ghi", "kWh/m2/day"),
      clearnessIndex: resource(row.clearnessIndex, "clearness_index", "ratio"),
      usableRoofAreaM2: est(row.usableRoofAreaM2, "usable_roof_area", "m2", roofBasis, noRoof),
      capacityKwEstimate: est(row.solarCapacityKwEstimate, "solar_capacity", "kWp", roofBasis, noRoof),
      yieldKwhPerKwpDay: est(row.yieldKwhPerKwpDay, "yield_per_kwp", "kWh/kWp/day", `annual average irradiation x performance ratio ${ASSUMPTIONS.performanceRatio.value}`, "Solar resource was not available."),
      estimatedDailyGenerationKwh: est(row.estimatedDailyGenerationKwh, "daily_generation", "kWh/day", `capacity estimate x yield per kWp (${roofBasis})`, noRoof),
      forecastNext24hGhiKwhM2: num(row.forecastNext24hGhiKwhM2, fcReason, "forecast_ghi_24h", (x) => forecast(x, { ...base("open-meteo", "Open-Meteo hourly forecast", "forecast_ghi_24h"), unit: "kWh/m2", validFor })),
      forecastNext24hKwhPerKwp: num(row.forecastNext24hKwhPerKwp, fcReason, "forecast_yield_24h", (x) => forecast(x, { ...base("open-meteo", "Open-Meteo hourly forecast", "forecast_yield_24h"), unit: "kWh/kWp", validFor })),
    },
    satellite: scene
      ? reference<SatelliteScene | null>(sceneFromRow(scene), { ...base("earth-search", scene.source, "latest_satellite_scene"), notes: ["A scene is the latest image, not a view of the present."] })
      : unavailable<SatelliteScene | null>("No satellite scene was available when this twin was built.", base("earth-search", "Earth Search STAC", "latest_satellite_scene")),
    consumption: { estimatedDailyLoadKwh: loadOf(row, snap, base) },
    profiles: profilesFromSnapshot(snap, t),
    tariff: tariffOf(row.tariffSnapshot as unknown as TariffPlanDto | null, row.tariffPlanId, base(TWIN, "AVISHKAR Energy Twin", "tariff")),
    energyAutonomyScore: unavailable<number>("The autonomy score needs a consumption profile and a battery or solar system definition.", base(TWIN, "AVISHKAR Energy Twin", "autonomy_score")),
    warnings,
    sources: row.sources as unknown as SourceRecord[],
    assumptions: row.assumptions as unknown as Assumption[],
    unavailable: row.unavailable as unknown as Gap[],
  };
}
