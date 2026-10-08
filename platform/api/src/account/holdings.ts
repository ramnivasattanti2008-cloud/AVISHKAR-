import type { Db } from "../db.js";
import { toApplianceDto, toBatteryDto, toEvDto, toSolarDto } from "../assets/service.js";
import { toImportDto } from "../energy/service.js";
import { toTariffDto } from "../tariff/service.js";

/** A record as the API shows it elsewhere. The shapes are those of the pages they come from, so the export does not repeat their schemas. */
type Rec = Record<string, unknown>;

export interface PropertyHoldings {
  propertyId: string;
  name: string;
  tariffPlanId: string | null;
  equipment: { batteries: Rec[]; solarSystems: Rec[]; evs: Rec[]; appliances: Rec[] };
  /** The files imported (name, rows accepted and refused, range): not the readings themselves, which are the owner's own file. */
  meterImports: Rec[];
  meterReadings: { count: number; first: string | null; last: string | null };
  control: { mode: string; maxChargeKw: number | null; maxDischargeKw: number | null; minSocPercent: number | null; automateUntil: string | null } | null;
  /** Counts of what AVISHKAR worked out and stored for this property. Each is in the property's report. */
  stored: { energyTwinVersions: number; forecasts: number; plans: number; whatIfs: number; controlProposals: number; roofOutlines: number };
}

export interface Holdings {
  /** Tariffs this person entered. Curated plans are shared reference data and are not theirs. */
  ownTariffs: Rec[];
  properties: PropertyHoldings[];
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);
// the DTO helpers return typed objects; the export carries them as plain records
const rec = (o: object): Rec => JSON.parse(JSON.stringify(o)) as Rec;

/** Everything a person has entered or had stored under their account, beyond the properties themselves (spec section 50). */
export async function accountHoldings(db: Db, userId: string, propertyIds: { id: string; name: string; tariffPlanId: string | null }[], now: Date): Promise<Holdings> {
  const ownTariffs = await db.tariffPlan.findMany({ where: { ownerId: userId }, orderBy: { createdAt: "asc" } });
  const properties: PropertyHoldings[] = [];
  for (const p of propertyIds) {
    const where = { propertyId: p.id };
    const [batteries, solar, evs, appliances, imports, readings, control, twins, forecasts, plans, whatIfs, proposals, outlines] = await Promise.all([
      db.battery.findMany({ where, orderBy: { createdAt: "asc" } }),
      db.solarSystem.findMany({ where, orderBy: { createdAt: "asc" } }),
      db.ev.findMany({ where, orderBy: { createdAt: "asc" } }),
      db.appliance.findMany({ where, orderBy: { createdAt: "asc" } }),
      db.energyImport.findMany({ where, orderBy: { uploadedAt: "asc" } }),
      db.energyObservation.aggregate({ where, _count: { _all: true }, _min: { ts: true }, _max: { ts: true } }),
      db.controlSetting.findUnique({ where: { propertyId: p.id } }),
      db.energyTwin.count({ where }),
      db.forecastRun.count({ where }),
      db.optimizationRun.count({ where }),
      db.scenario.count({ where }),
      db.controlProposal.count({ where }),
      db.propertyGeometry.count({ where }),
    ]);
    properties.push({
      propertyId: p.id,
      name: p.name,
      tariffPlanId: p.tariffPlanId,
      equipment: {
        batteries: batteries.map((b) => rec(toBatteryDto(b))),
        solarSystems: solar.map((s) => rec(toSolarDto(s))),
        evs: evs.map((e) => rec(toEvDto(e))),
        appliances: appliances.map((a) => rec(toApplianceDto(a))),
      },
      meterImports: imports.map((i) => rec(toImportDto(i))),
      meterReadings: { count: readings._count._all, first: iso(readings._min.ts), last: iso(readings._max.ts) },
      control: control
        ? { mode: control.mode, maxChargeKw: control.maxChargeKw, maxDischargeKw: control.maxDischargeKw, minSocPercent: control.minSocPercent, automateUntil: iso(control.automateUntil) }
        : null,
      stored: { energyTwinVersions: twins, forecasts, plans, whatIfs, controlProposals: proposals, roofOutlines: outlines },
    });
  }
  return { ownTariffs: ownTariffs.map((t) => rec(toTariffDto(t, now))), properties };
}
