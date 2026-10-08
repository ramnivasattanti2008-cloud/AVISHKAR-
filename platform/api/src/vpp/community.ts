/**
 * The community view (spec section 47): the owner's own properties together, for a typical day of this month. Where each has a
 * surplus of solar and where a deficit, how much storage and shiftable load each holds, and how much of one's surplus could
 * meet another's deficit in the same hour. It is a simulation over the owner's own entered and imported data, and it only ever
 * shows properties the signed-in account owns: no one's data is shown to anyone else. It says "community energy simulation" and
 * nothing about trading: whether electricity may be shared between properties depends on the law where they are.
 */
import { DEFAULTS, param } from "../assets/defaults.js";
import { toBatteryDto } from "../assets/service.js";
import { latestDna } from "../energy/service.js";
import { requireEngine } from "../engine/index.js";
import type { ForecastDeps } from "../forecast/service.js";
import { simulated } from "../provenance/index.js";
import { loadModel } from "../scenarios/service.js";

const round = (v: number, d = 1): number => Math.round(v * 10 ** d) / 10 ** d;
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

export interface CommunityMember {
  propertyId: string;
  name: string;
  latitude: number;
  longitude: number;
  status: "SURPLUS" | "DEFICIT" | "BALANCED" | "NO_DATA";
  /** Why a property has no figures, when it has none. */
  reason: string | null;
  loadKwhPerDay: number | null;
  solarKwhPerDay: number;
  surplusKwhPerDay: number | null;
  deficitKwhPerDay: number | null;
  solarKwp: number;
  batteryUsableKwh: number;
  shiftableKw: number;
  vehicleChargerKw: number;
}

export async function communityView(deps: ForecastDeps, userId: string, ctx: { requestId?: string } = {}) {
  const { db, now } = deps;
  const at = now();
  const local = new Date(at.getTime() + 330 * 60_000);
  const month = local.getUTCMonth() + 1;
  const dayType: "weekday" | "weekend" = (local.getUTCDay() + 6) % 7 >= 5 ? "weekend" : "weekday";
  const props = await db.property.findMany({ where: { ownerId: userId, deletedAt: null, isDemo: false }, orderBy: { createdAt: "asc" }, take: 100 });

  const members: CommunityMember[] = [];
  const poolLoad = new Array<number>(24).fill(0);
  const poolPv = new Array<number>(24).fill(0);
  const poolSurplus = new Array<number>(24).fill(0);
  const poolDeficit = new Array<number>(24).fill(0);
  const profiles = new Map<string, Promise<number[]>>();

  for (const p of props) {
    const [dna, systems, batteries, appliances, evs] = await Promise.all([
      latestDna(db, p.id),
      db.solarSystem.findMany({ where: { propertyId: p.id, status: "EXISTING" } }),
      db.battery.findMany({ where: { propertyId: p.id, status: "EXISTING" } }),
      db.appliance.findMany({ where: { propertyId: p.id, priority: "FLEXIBLE" } }),
      db.ev.findMany({ where: { propertyId: p.id } }),
    ]);
    const usable = sum(batteries.map((b) => toBatteryDto(b).usableKwh));
    const base = { propertyId: p.id, name: p.name, latitude: p.latitude, longitude: p.longitude, solarKwp: round(sum(systems.map((s) => s.capacityKwp)), 2), batteryUsableKwh: round(usable, 2), shiftableKw: round(sum(appliances.map((a) => (a.ratedPowerW * a.quantity) / 1000)), 2), vehicleChargerKw: round(sum(evs.map((e) => e.chargerKw)), 1) };
    if (!dna) {
      members.push({ ...base, status: "NO_DATA", reason: "No meter readings have been imported for this property, so its daily pattern is not known.", loadKwhPerDay: null, solarKwhPerDay: 0, surplusKwhPerDay: null, deficitKwhPerDay: null });
      continue;
    }
    const load = loadModel(dna);
    const pattern = (dayType === "weekend" ? load.weekend : load.weekday).map((v) => v * load.monthFactor[month - 1]!);

    let pv = new Array<number>(24).fill(0);
    if (systems.length > 0) {
      const engine = requireEngine(deps.engine);
      const res = await deps.providers.solarResource.climatology(p.latitude, p.longitude, { requestId: ctx.requestId, now });
      const clim = res.value?.months.find((m) => m.month === month);
      if (!res.value || !clim || clim.ghiKwhM2Day === null) {
        members.push({ ...base, status: "NO_DATA", reason: "The solar resource for this place could not be read, so its solar output is not known.", loadKwhPerDay: round(sum(pattern), 1), solarKwhPerDay: 0, surplusKwhPerDay: null, deficitKwhPerDay: null });
        continue;
      }
      const each = await Promise.all(
        systems.map((s) => {
          const key = JSON.stringify([p.latitude, p.longitude, month, s.capacityKwp, s.tiltDeg, s.azimuthDeg, s.lossFraction, s.inverterKw]);
          let prof = profiles.get(key);
          if (!prof) {
            prof = engine
              .solarTypicalDays(
                {
                  location: { latitude: p.latitude, longitude: p.longitude, altitudeM: res.value?.elevationM ?? 0 },
                  system: { capacityKwp: s.capacityKwp, tiltDeg: s.tiltDeg, azimuthDeg: s.azimuthDeg, lossFraction: param(s.lossFraction, DEFAULTS.solar.lossFraction).value as number, inverterKw: s.inverterKw },
                  months: [{ month, ghiKwhM2Day: clim.ghiKwhM2Day as number, airTempC: clim.airTempC }],
                  timezoneOffsetMinutes: 330,
                },
                { requestId: ctx.requestId },
              )
              .then((r) => r.days[0]!.pvKw);
            profiles.set(key, prof);
          }
          return prof;
        }),
      );
      pv = pv.map((_, h) => sum(each.map((e) => e[h]!)));
    }
    const surplus = pv.map((v, h) => Math.max(0, v - pattern[h]!));
    const deficit = pv.map((v, h) => Math.max(0, pattern[h]! - v));
    for (let h = 0; h < 24; h++) {
      poolLoad[h]! += pattern[h]!;
      poolPv[h]! += pv[h]!;
      poolSurplus[h]! += surplus[h]!;
      poolDeficit[h]! += deficit[h]!;
    }
    const s = sum(surplus);
    const d = sum(deficit);
    members.push({ ...base, status: s > d * 1.05 ? "SURPLUS" : d > s * 1.05 ? "DEFICIT" : "BALANCED", reason: null, loadKwhPerDay: round(sum(pattern), 1), solarKwhPerDay: round(sum(pv), 1), surplusKwhPerDay: round(s, 1), deficitKwhPerDay: round(d, 1) });
  }

  const withData = members.filter((m) => m.status !== "NO_DATA");
  // the energy that one property's surplus could meet in another's deficit in the same hour: what pooling would add
  const shareable = sum(poolSurplus.map((s, h) => Math.min(s, poolDeficit[h]!)));
  const individualSurplus = sum(withData.map((m) => m.surplusKwhPerDay ?? 0));
  const src = { provider: "avishkar-community", source: "AVISHKAR community energy simulation over your own properties", dataType: "community_simulation", now: at };
  return {
    label: "COMMUNITY ENERGY SIMULATION" as const,
    month,
    dayType,
    members,
    totals: simulated(
      withData.length === 0
        ? null
        : {
            properties: withData.length,
            loadKwhPerDay: round(sum(poolLoad), 1),
            solarKwhPerDay: round(sum(poolPv), 1),
            surplusKwhPerDay: round(individualSurplus, 1),
            deficitKwhPerDay: round(sum(withData.map((m) => m.deficitKwhPerDay ?? 0)), 1),
            shareableKwhPerDay: round(shareable, 1),
            storageUsableKwh: round(sum(withData.map((m) => m.batteryUsableKwh)), 1),
            shiftableKw: round(sum(withData.map((m) => m.shiftableKw)), 1),
            vehicleChargerKw: round(sum(withData.map((m) => m.vehicleChargerKw)), 1),
          },
      { ...src, notes: ["A typical day over your own properties, not a measurement."] },
    ),
    hourly: { hours: Array.from({ length: 24 }, (_, h) => h), loadKw: poolLoad.map((v) => round(v, 2)), solarKw: poolPv.map((v) => round(v, 2)), shareableKw: poolSurplus.map((s, h) => round(Math.min(s, poolDeficit[h]!), 2)) },
    notes: [
      "This is a simulation over properties you own. AVISHKAR does not move electricity between properties and says nothing about whether that is allowed: sharing or selling electricity between properties depends on the law and the utility where they are.",
      `A typical ${dayType} of the month ${month}: each property's own average pattern and its own solar (NASA POWER's mean day for its place). Properties without readings are listed and left out of the totals.`,
      "Only properties your account owns appear here. Nothing about anyone else's is shown.",
    ],
  };
}
