/**
 * Loads the demo world into the signed-in owner's account, and takes it out again (spec sections 74 and 93). Each owner gets
 * their own copy, so nobody shares an account or a password, and the demo properties are flagged `isDemo` in the database:
 * every value computed from them is relabelled DEMO on the way out (`relabel.ts`), and the community view leaves them out.
 */
import { createBattery, createAppliance, createEv, createSolarSystem } from "../assets/service.js";
import type { Db } from "../db.js";
import { importMeterData } from "../energy/service.js";
import { AppError } from "../errors.js";
import { createTariff } from "../tariff/service.js";
import { DEMO_LABEL, DEMO_SITES, DEMO_TARIFF_SOURCE, type DemoSite, demoMeterCsv } from "./world.js";

export interface DemoSiteDto {
  key: string;
  name: string;
  city: string;
  latitude: number;
  longitude: number;
  story: string;
  propertyId: string | null;
  tariff: string | null;
}

export interface DemoWorldDto {
  label: typeof DEMO_LABEL;
  loaded: boolean;
  sites: DemoSiteDto[];
  notes: string[];
}

const NOTES = [
  "DEMO DATA: the meter readings, the equipment and the Bengaluru tariff are invented. The places are real, so the weather, the sun and the building outlines fetched for them are real.",
  "The Pune, Jaipur and Mathura tariffs are the sourced catalogue plans; two of them have passed their end date and say so.",
  "The readings are generated: the same site and date always give the same readings. They are hourly, for 120 days ending yesterday.",
  "Demo properties are never added up with your own: the community view leaves them out, and every value computed from them is labelled DEMO.",
];

async function demoProperties(db: Db, userId: string) {
  return db.property.findMany({ where: { ownerId: userId, isDemo: true, deletedAt: null }, include: { tariffPlan: { select: { name: true } } } });
}

export async function demoWorld(db: Db, userId: string): Promise<DemoWorldDto> {
  const rows = await demoProperties(db, userId);
  const byName = new Map(rows.map((r) => [r.name, r]));
  const sites = DEMO_SITES.map((s) => {
    const p = byName.get(s.name);
    return { key: s.key, name: s.name, city: s.city, latitude: s.latitude, longitude: s.longitude, story: s.story, propertyId: p?.id ?? null, tariff: p?.tariffPlan?.name ?? null };
  });
  return { label: DEMO_LABEL, loaded: sites.every((s) => s.propertyId !== null), sites, notes: NOTES };
}

/** The invented tariff for a site with no sourced plan: one per owner, reused. The export credit is marked an assumption. */
async function demoTariffId(db: Db, userId: string, now: Date): Promise<string> {
  const existing = await db.tariffPlan.findFirst({ where: { ownerId: userId, source: DEMO_TARIFF_SOURCE, deletedAt: null }, select: { id: true } });
  if (existing) return existing.id;
  const plan = await createTariff(
    db,
    userId,
    {
      name: "DEMO time-of-day tariff (invented)",
      state: "KA",
      consumerType: "RESIDENTIAL",
      touBlocks: [
        { startHour: 22, endHour: 6, rate: 6.1 },
        { startHour: 6, endHour: 18, rate: 7.0 },
        { startHour: 18, endHour: 22, rate: 8.6 },
      ],
      exportRate: 3.5,
      source: DEMO_TARIFF_SOURCE,
      notes: "DEMO DATA. The rates and the export credit are invented for the demo world.",
    },
    now,
  );
  await db.tariffPlan.update({ where: { id: plan.id }, data: { exportRateBasis: "ASSUMPTION" } });
  return plan.id;
}

async function tariffFor(db: Db, userId: string, site: DemoSite, now: Date): Promise<{ id: string; note: string | null }> {
  if (site.tariffSeedKey) {
    const curated = await db.tariffPlan.findFirst({ where: { seedKey: site.tariffSeedKey, ownerId: null, deletedAt: null }, select: { id: true } });
    if (curated) return { id: curated.id, note: null };
    return { id: await demoTariffId(db, userId, now), note: `${site.name}: the catalogue plan ${site.tariffSeedKey} is not loaded on this server (run db:seed), so the invented demo tariff is used instead.` };
  }
  return { id: await demoTariffId(db, userId, now), note: null };
}

async function createSite(db: Db, userId: string, site: DemoSite, now: Date): Promise<string> {
  const tariff = await tariffFor(db, userId, site, now);
  const p = await db.property.create({
    data: {
      ownerId: userId,
      name: site.name,
      latitude: site.latitude,
      longitude: site.longitude,
      address: site.address,
      positionSource: "manual",
      isDemo: true,
      tariffPlanId: tariff.id,
    },
  });
  try {
    if (site.solar) await createSolarSystem(db, userId, p.id, { ...site.solar, status: "EXISTING" });
    if (site.battery) await createBattery(db, userId, p.id, { ...site.battery, status: "EXISTING" }, now);
    if (site.ev) await createEv(db, userId, p.id, site.ev, now);
    for (const a of site.appliances) await createAppliance(db, userId, p.id, { ...a, quantity: 1, interruptible: false });
    const file = demoMeterCsv(site, now.getTime());
    await importMeterData(db, userId, p.id, { csv: file.csv, filename: `avishkar-demo-${site.key}.csv`, unit: "kWh" }, now);
  } catch (e) {
    // a half-built demo property would look like a real one with missing data: take it out and report the failure
    await db.property.delete({ where: { id: p.id } });
    throw e;
  }
  return p.id;
}

/** Adds whichever demo properties the owner does not have yet. Loading twice changes nothing. */
export async function loadDemoWorld(db: Db, userId: string, now: Date): Promise<{ created: number; world: DemoWorldDto }> {
  const have = new Set((await demoProperties(db, userId)).map((r) => r.name));
  const missing = DEMO_SITES.filter((s) => !have.has(s.name));
  const own = await db.property.count({ where: { ownerId: userId, deletedAt: null } });
  if (own + missing.length > 200) throw new AppError("VALIDATION_FAILED", "Your account has too many properties to add the demo world. Delete some first.");
  for (const site of missing) await createSite(db, userId, site, now);
  return { created: missing.length, world: await demoWorld(db, userId) };
}

/** Deletes the owner's demo properties (and everything under them) and the invented tariff unless a real property uses it. */
export async function removeDemoWorld(db: Db, userId: string): Promise<number> {
  const { count } = await db.property.deleteMany({ where: { ownerId: userId, isDemo: true } });
  const plan = await db.tariffPlan.findFirst({ where: { ownerId: userId, source: DEMO_TARIFF_SOURCE }, select: { id: true } });
  if (plan && (await db.property.count({ where: { tariffPlanId: plan.id, deletedAt: null } })) === 0) await db.tariffPlan.delete({ where: { id: plan.id } });
  return count;
}
