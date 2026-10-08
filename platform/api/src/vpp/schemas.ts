import { z } from "zod";
import { measured } from "../schemas.js";

export const VppSchema = z
  .object({
    label: z.literal("VIRTUAL POWER PLANT SIMULATION"),
    request: z.record(z.string(), z.unknown()),
    month: z.number(),
    dayType: z.enum(["weekday", "weekend"]),
    archetype: z.object({ propertyId: z.uuid(), name: z.string(), tariff: z.string() }),
    fleet: z.object({ homes: z.number(), withSolar: z.number(), withBattery: z.number(), withVehicle: z.number(), solarKwp: z.number(), batteryKwh: z.number(), evChargerKw: z.number(), shiftableKwhPerDay: z.number() }),
    result: measured(
      z.object({
        solarKwhPerDay: z.number(),
        loadKwhPerDay: z.number(),
        peakImportBeforeKw: z.number(),
        peakImportBeforeHour: z.number(),
        peakImportAfterKw: z.number(),
        peakImportAfterHour: z.number(),
        peakReductionPercent: z.number().nullable(),
        peakExportBeforeKw: z.number(),
        peakExportAfterKw: z.number(),
        importKwhBefore: z.number(),
        importKwhAfter: z.number(),
        solarUsedLocallyBefore: z.number().nullable(),
        solarUsedLocallyAfter: z.number().nullable(),
        solarCurtailedKwhAfter: z.number(),
        selfSufficiencyBefore: z.number().nullable(),
        selfSufficiencyAfter: z.number().nullable(),
        costBeforeInr: z.number(),
        costAfterInr: z.number(),
        savingsInr: z.number(),
        batteryCycles: z.number(),
      }),
    ),
    hourly: z.object({ hours: z.array(z.number()), loadKw: z.array(z.number()), solarKw: z.array(z.number()), importBeforeKw: z.array(z.number()), importAfterKw: z.array(z.number()), batteryKwh: z.array(z.number()) }),
    assumptions: z.array(z.string()),
    notes: z.array(z.string()),
  })
  .meta({ id: "VppSimulation" });

export const CommunitySchema = z
  .object({
    label: z.literal("COMMUNITY ENERGY SIMULATION"),
    month: z.number(),
    dayType: z.enum(["weekday", "weekend"]),
    members: z.array(
      z.object({
        propertyId: z.uuid(),
        name: z.string(),
        latitude: z.number(),
        longitude: z.number(),
        status: z.enum(["SURPLUS", "DEFICIT", "BALANCED", "NO_DATA"]),
        reason: z.string().nullable(),
        loadKwhPerDay: z.number().nullable(),
        solarKwhPerDay: z.number(),
        surplusKwhPerDay: z.number().nullable(),
        deficitKwhPerDay: z.number().nullable(),
        solarKwp: z.number(),
        batteryUsableKwh: z.number(),
        shiftableKw: z.number(),
        vehicleChargerKw: z.number(),
      }),
    ),
    totals: measured(
      z.object({ properties: z.number(), loadKwhPerDay: z.number(), solarKwhPerDay: z.number(), surplusKwhPerDay: z.number(), deficitKwhPerDay: z.number(), shareableKwhPerDay: z.number(), storageUsableKwh: z.number(), shiftableKw: z.number(), vehicleChargerKw: z.number() }),
    ),
    hourly: z.object({ hours: z.array(z.number()), loadKw: z.array(z.number()), solarKw: z.array(z.number()), shareableKw: z.array(z.number()) }),
    notes: z.array(z.string()),
  })
  .meta({ id: "CommunitySimulation" });
