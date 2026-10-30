/**
 * Turning the allocation engine into a feature: build its inputs either from what the request supplies or from the
 * owner's own properties, run it, price the result, and say where every input came from.
 *
 * Nothing here invents a number. A property's solar comes from its own entered system and the sun recorded at its place;
 * its demand comes from the pattern worked out from its own imported meter readings; its export limit comes from the
 * inverter the owner entered. Where a real figure does not exist — nobody has told AVISHKAR a property's sanctioned load —
 * the input says so in its `basis` and the stated default is shown as the assumption it is, rather than being passed off
 * as the property's own.
 */
import { DEFAULTS, param } from "../assets/defaults.js";
import { toBatteryDto } from "../assets/service.js";
import { latestDna } from "../energy/service.js";
import { requireEngine } from "../engine/index.js";
import { AppError } from "../errors.js";
import type { ForecastDeps } from "../forecast/service.js";
import { priceSeries } from "../plan/service.js";
import { simulated } from "../provenance/index.js";
import { loadModel } from "../scenarios/service.js";
import { getTariff } from "../tariff/service.js";
import { type AllocationResult, type CommunityLimits, type MemberInput, allocateInterval } from "./allocate.js";
import type { AllocateRequest } from "./schemas.js";

/**
 * The import limit used when nobody has stated a property's sanctioned load. It is deliberately high enough not to bind,
 * so an allocation is never quietly capped by a number the owner never gave. Every input built this way says so.
 */
const UNSTATED_IMPORT_LIMIT_KW = 100_000;
/** The same for a property with no solar inverter: there is nothing to push out, so the limit is whatever it sends. */
const UNSTATED_EXPORT_LIMIT_KW = 100_000;

const round = (v: number, d = 4): number => Math.round(v * 10 ** d) / 10 ** d;
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

export interface InputBasis {
  id: string;
  name: string;
  basis: string[];
}

/** A member's prices for the interval, when its tariff is known. Used only for the with-and-without comparison. */
interface MemberPrice {
  id: string;
  importInr: number;
  exportInr: number;
}

/**
 * What the interval costs each member on its own, and what it costs with the allocation. Without sharing, a member sells
 * its whole surplus (within its export limit) and buys its whole deficit. With sharing, it buys and sells only what the
 * allocation left over; the shared energy itself is valued at the midpoint between the buyer's import price and the
 * seller's export price, which is the only defensible figure when no one has agreed a price — and is stated as such.
 */
function compare(result: AllocationResult, prices: MemberPrice[], stepHours: number) {
  const byId = new Map(prices.map((p) => [p.id, p]));
  if (result.members.some((m) => !byId.has(m.id))) return null;

  let without = 0;
  let withSharing = 0;
  for (const m of result.members) {
    const p = byId.get(m.id)!;
    // On its own: everything it offered is sold as far as its meter allows, and everything it asked for is bought.
    const soldAlone = Math.min(m.offeredKw, m.offeredKw > 0 ? m.offeredKw : 0);
    without += (m.requestedKw * p.importInr - soldAlone * p.exportInr) * stepHours;
    // With the allocation: what it still bought and sold at its own prices.
    withSharing += (m.gridImportKw * p.importInr - m.gridExportKw * p.exportInr) * stepHours;
  }
  // The shared energy, valued at the midpoint of each pair's buy and sell price.
  let sharedValue = 0;
  for (const t of result.transfers) {
    const seller = byId.get(t.fromId)!;
    const buyer = byId.get(t.toId)!;
    const price = (buyer.importInr + seller.exportInr) / 2;
    // The buyer pays for what it received; the seller is paid for it. Between them that is a transfer, not a cost to the
    // community, so it nets to zero here and is reported only so a page can show who would owe whom.
    sharedValue += t.deliveredKw * price * stepHours;
  }
  return {
    withoutSharingInr: round(without, 2),
    withSharingInr: round(withSharing, 2),
    savingInr: round(without - withSharing, 2),
    basis:
      sharedValue > 0
        ? `Each property's own tariff, for this one interval. Shared energy would be worth about INR ${round(sharedValue, 2)} at the midpoint between the buyer's import price and the seller's export price: an assumption, because no price has been agreed and no such arrangement exists.`
        : "Each property's own tariff, for this one interval. No energy was shared, so no price for sharing was needed.",
  };
}

/** Applies the caller's "what if" changes on top of a member built from real data. */
function applyOverride(m: MemberInput, over: NonNullable<AllocateRequest["overrides"]>[string] | undefined, basis: string[]): MemberInput {
  if (!over) return m;
  const out = { ...m };
  for (const key of ["generationKw", "demandKw", "criticalKw", "exportLimitKw", "importLimitKw", "lineLossFraction"] as const) {
    const v = over[key];
    if (v !== undefined) {
      out[key] = v;
      basis.push(`${key}: you changed this to ${v}, so it is your figure and not the property's.`);
    }
  }
  if (over.battery !== undefined) {
    out.battery = over.battery === null ? null : { ...(m.battery ?? { usableKwh: 0, socKwh: 0, reserveKwh: 0, maxChargeKw: 0, maxDischargeKw: 0, roundTripEfficiency: DEFAULTS.battery.oneWayEfficiency.value ** 2 }), ...over.battery };
    basis.push("battery: you changed this, so it is your figure and not the property's.");
  }
  return out;
}

/**
 * Builds a member for each of the owner's named properties, at one hour of a typical day. Refuses rather than guesses:
 * a property with no imported readings has no demand pattern, and is reported as an error naming what is missing.
 */
async function fromProperties(deps: ForecastDeps, userId: string, req: AllocateRequest, ctx: { requestId?: string }) {
  const { db, now } = deps;
  const at = now();
  const local = new Date(at.getTime() + 330 * 60_000);
  const month = req.month ?? local.getUTCMonth() + 1;
  const hour = req.hour ?? local.getUTCHours();
  const dayType = req.dayType ?? ((local.getUTCDay() + 6) % 7 >= 5 ? "weekend" : "weekday");

  const props = await db.property.findMany({ where: { id: { in: req.propertyIds! }, ownerId: userId, deletedAt: null } });
  const missing = req.propertyIds!.filter((id) => !props.some((p) => p.id === id));
  if (missing.length > 0) throw new AppError("NOT_FOUND", `No property of yours with id ${missing.join(", ")}.`);

  const members: MemberInput[] = [];
  const inputs: InputBasis[] = [];
  const prices: MemberPrice[] = [];

  for (const p of props) {
    const basis: string[] = [];
    const [dna, systems, batteries, appliances] = await Promise.all([
      latestDna(db, p.id),
      db.solarSystem.findMany({ where: { propertyId: p.id, status: "EXISTING" } }),
      db.battery.findMany({ where: { propertyId: p.id, status: "EXISTING" } }),
      db.appliance.findMany({ where: { propertyId: p.id, priority: "CRITICAL" } }),
    ]);
    if (!dna) {
      throw new AppError(
        "PLAN_INPUTS_MISSING",
        `${p.name} has no imported meter readings, so its demand for an hour of a typical day is not known. Import its meter data first, or describe the members in the request instead.`,
      );
    }
    const load = loadModel(dna);
    const pattern = (dayType === "weekend" ? load.weekend : load.weekday).map((v) => v * load.monthFactor[month - 1]!);
    const demandKw = pattern[hour]!;
    basis.push(`demand ${round(demandKw, 2)} kW: this property's own average ${dayType} pattern for hour ${hour} of month ${month}, worked out from its imported meter readings (mean ${round(load.meanDailyKwh, 1)} kWh a day).`);

    let generationKw = 0;
    if (systems.length === 0) {
      basis.push("generation 0 kW: no solar system is recorded as existing on this property.");
    } else {
      const engine = requireEngine(deps.engine);
      const res = await deps.providers.solarResource.climatology(p.latitude, p.longitude, { requestId: ctx.requestId, now });
      const clim = res.value?.months.find((m) => m.month === month);
      if (!res.value || !clim || clim.ghiKwhM2Day === null) {
        throw new AppError("PROVIDER_UNAVAILABLE", `The solar resource for ${p.name} could not be read, so its generation is not known. Try again, or describe the members in the request instead.`);
      }
      const days = await Promise.all(
        systems.map((s) =>
          engine
            .solarTypicalDays(
              {
                location: { latitude: p.latitude, longitude: p.longitude, altitudeM: res.value?.elevationM ?? 0 },
                system: { capacityKwp: s.capacityKwp, tiltDeg: s.tiltDeg, azimuthDeg: s.azimuthDeg, lossFraction: param(s.lossFraction, DEFAULTS.solar.lossFraction).value as number, inverterKw: s.inverterKw },
                months: [{ month, ghiKwhM2Day: clim.ghiKwhM2Day as number, airTempC: clim.airTempC }],
                timezoneOffsetMinutes: 330,
              },
              { requestId: ctx.requestId },
            )
            .then((r) => r.days[0]!.pvKw[hour]!),
        ),
      );
      generationKw = sum(days);
      basis.push(
        `generation ${round(generationKw, 2)} kW: this property's own ${systems.length === 1 ? "system" : `${systems.length} systems`} (${round(sum(systems.map((s) => s.capacityKwp)), 2)} kWp) modelled by pvlib at its own place, for the mean day of month ${month} as recorded by ${res.value.months.length > 0 ? "NASA POWER" : "the solar resource provider"}.`,
      );
    }

    const bats = batteries.map((b) => toBatteryDto(b));
    const usableKwh = sum(bats.map((b) => b.usableKwh));
    let battery: MemberInput["battery"] = null;
    if (usableKwh > 0) {
      const socFraction = bats.map((b) => b.entered.currentSoc).find((v) => v !== null && v !== undefined);
      const reserveKwh = sum(
        bats.map((b, i) => {
          const r = batteries[i]!.reserveSoc;
          return r === null ? 0 : b.capacityKwh * r;
        }),
      );
      const oneWay = DEFAULTS.battery.oneWayEfficiency.value as number;
      battery = {
        usableKwh: round(usableKwh, 3),
        socKwh: round(socFraction != null ? usableKwh * socFraction : reserveKwh, 3),
        reserveKwh: round(Math.min(reserveKwh, usableKwh), 3),
        maxChargeKw: round(sum(bats.map((b) => b.maxChargeKw)), 3),
        maxDischargeKw: round(sum(bats.map((b) => b.maxDischargeKw)), 3),
        roundTripEfficiency: round(oneWay * oneWay, 4),
      };
      basis.push(
        `battery ${battery.usableKwh} kWh usable, ${battery.maxChargeKw} kW in and ${battery.maxDischargeKw} kW out: the batteries the owner entered for this property. ` +
          (socFraction != null
            ? `Charge level from the ${round(socFraction * 100)}% state of charge entered for it.`
            : "No state of charge has been entered for it, so it starts at its reserve floor: the allocation cannot assume stored energy nobody has reported.") +
          ` Round-trip efficiency ${battery.roundTripEfficiency} is the documented default, not a measurement.`,
      );
    } else {
      basis.push("battery: none recorded as existing on this property.");
    }

    const inverterKw = sum(systems.map((s) => s.inverterKw ?? 0));
    const exportLimitKw = inverterKw > 0 ? inverterKw : UNSTATED_EXPORT_LIMIT_KW;
    basis.push(
      inverterKw > 0
        ? `export limit ${round(inverterKw, 2)} kW: the inverter rating entered for this property. What the distribution company permits may be lower and is not recorded here.`
        : "export limit: not known. No inverter rating has been entered, so no export limit was applied; this is not a statement that there is none.",
    );
    basis.push("import limit: not known. AVISHKAR does not hold this property's sanctioned load, so no import limit was applied. Enter one in the request to see what it would do.");

    const criticalKw = sum(appliances.map((a) => (a.ratedPowerW * a.quantity) / 1000));
    if (criticalKw > 0) basis.push(`critical demand ${round(criticalKw, 2)} kW: the appliances marked critical on this property, at their rated power.`);

    const member: MemberInput = {
      id: p.id,
      name: p.name,
      generationKw: round(generationKw, 4),
      demandKw: round(demandKw, 4),
      criticalKw: round(Math.min(criticalKw, demandKw), 4),
      battery,
      exportLimitKw,
      importLimitKw: UNSTATED_IMPORT_LIMIT_KW,
      lineLossFraction: 0,
    };
    basis.push("line loss 0: the distance from this property to any shared node is not known, so no line loss was applied. Set one in the request to see its effect.");

    const withOverride = applyOverride(member, req.overrides?.[p.id], basis);
    members.push(withOverride);
    inputs.push({ id: p.id, name: p.name, basis });

    // Prices for the comparison, where the property has a tariff.
    try {
      const tariff = p.tariffPlanId ? await getTariff(db, userId, p.tariffPlanId, at) : null;
      if (tariff) {
        const startMs = Date.UTC(2026, month - 1, 15, hour, 0) - 330 * 60_000;
        const series = priceSeries(tariff, startMs, 1, dna.meanDailyKwh * 30);
        prices.push({ id: p.id, importInr: series.importPrice[0]!, exportInr: series.exportPrice[0]! });
      }
    } catch {
      // A tariff that cannot be priced for this hour simply leaves the comparison out; it is never guessed.
    }
  }

  return { members, inputs, prices, month, hour, dayType };
}

export async function allocateCommunity(deps: ForecastDeps, userId: string, req: AllocateRequest, ctx: { requestId?: string } = {}) {
  const at = deps.now();
  const limits: CommunityLimits = req.limits;

  let members: MemberInput[];
  let inputs: InputBasis[];
  let prices: MemberPrice[] = [];
  let context: string;
  const source: "YOUR_PROPERTIES" | "MEMBERS_GIVEN" = req.propertyIds && req.propertyIds.length > 0 ? "YOUR_PROPERTIES" : "MEMBERS_GIVEN";

  if (source === "YOUR_PROPERTIES") {
    const built = await fromProperties(deps, userId, req, ctx);
    members = built.members;
    inputs = built.inputs;
    prices = built.prices;
    context = `Hour ${built.hour} of a typical ${built.dayType} in month ${built.month}, built from your own properties.`;
  } else {
    members = req.members!;
    inputs = members.map((m) => ({
      id: m.id,
      name: m.name,
      basis: [
        `Every figure for ${m.name} was supplied in the request: ${m.generationKw} kW generated, ${m.demandKw} kW used, export limit ${m.exportLimitKw} kW, import limit ${m.importLimitKw} kW, line loss ${m.lineLossFraction}.`,
        m.battery ? `Battery ${m.battery.usableKwh} kWh usable, ${m.battery.socKwh} kWh stored, reserve ${m.battery.reserveKwh} kWh, round-trip efficiency ${m.battery.roundTripEfficiency}: also supplied.` : "No battery was supplied for it.",
      ],
    }));
    context = "Every figure was supplied in the request. Nothing here was measured.";
  }

  let result: AllocationResult;
  try {
    result = allocateInterval(members, limits);
  } catch (e) {
    throw new AppError("VALIDATION_FAILED", e instanceof Error ? e.message : "The members could not describe a real set of properties.");
  }

  const comparison = prices.length > 0 ? compare(result, prices, limits.stepHours) : null;

  return {
    label: "COMMUNITY ALLOCATION SIMULATION" as const,
    source,
    result: simulated(
      { ...result, comparison },
      {
        provider: "avishkar-community-allocation",
        source: "AVISHKAR community allocation engine",
        dataType: "community_allocation",
        now: at,
        notes: [
          "A calculation over one interval, not a measurement and not a record of electricity that moved.",
          context,
          `Allocation rule ${limits.rule}, battery policy ${limits.batteryPolicy}, interval ${limits.stepHours} h.`,
        ],
      },
    ),
    inputs,
    notes: [
      "AVISHKAR does not move electricity between properties. Whether a surplus may be sent to a neighbour depends on the law, the distribution licensee's rules, the metering arrangement and the wiring where those properties are. This models the energy; it makes no claim that the arrangement exists or is permitted.",
      "The order of steps is a stated convention, not something an optimiser discovered: own generation, then own battery, then the shared node, then the grid. The same kW is never allocated twice, and the response carries the energy-balance check that proves it.",
      "Pair-by-pair transfers are an accounting convention: the shared node pools everything, so nothing in the arithmetic says which kW of one property's surplus reached which neighbour. Each sender is divided over the receivers in the proportion they were served.",
      ...(result.check.balanced ? [] : ["The energy-balance check FAILED for this result. Treat the figures as unreliable and report this."]),
    ],
  };
}
