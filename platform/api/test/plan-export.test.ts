import { describe, expect, it } from "vitest";
import { csvField, planCsv } from "../src/plan/export.js";
import type { PlanDto } from "../src/plan/schemas.js";

const two = (a: number, b: number) => [a, b];
const plan = {
  id: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-10-07T10:10:00.000Z",
  mode: "SAVE_MONEY",
  horizon: { start: "2026-10-07T10:30:00.000Z", stepHours: 1, steps: 2 },
  schedule: {
    times: ["2026-10-07T10:30:00.000Z", "2026-10-07T11:30:00.000Z"],
    loadKw: two(1, 2),
    pvForecastKw: two(3, 0),
    pvUsedKw: two(3, 0),
    pvCurtailedKw: two(0, 0),
    gridImportKw: two(0, 1.5),
    gridExportKw: two(0.5, 0),
    batteryChargeKw: two(1.5, 0),
    batteryDischargeKw: two(0, 0.5),
    batterySocKwh: two(6.5, 6),
    evChargeKw: two(0, 0),
    applianceKw: { a1: two(0, 0.25) },
    importPrice: two(6, 10),
    exportPrice: two(3, 3),
  },
  appliances: [{ id: "a1", name: '=HYPERLINK("x"), pump', startTime: null, runHours: 1, energyKwh: 0.25 }],
  inputs: { tariff: { name: "Test ToD" } },
  result: { value: { netCostInr: 13.5, baselineNetCostInr: 20, savingsInr: 6.5 }, provenance: { status: "SIMULATED", modelVersion: "engine-1.0" } },
} as unknown as PlanDto;

describe("csvField", () => {
  it("quotes commas and quotes, and defuses spreadsheet formulas", () => {
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("=1+1")).toBe("'=1+1");
    expect(csvField("-2")).toBe("'-2");
    expect(csvField(-2)).toBe("-2");
    expect(csvField(Number.NaN)).toBe("");
  });
});

describe("planCsv", () => {
  const lines = planCsv(plan).trimEnd().split("\r\n");

  it("says what the file is before the data", () => {
    expect(lines[0]).toContain(plan.id);
    expect(lines[1]).toMatch(/^# SIMULATED/);
    expect(lines.filter((l) => l.startsWith("#")).join(" ")).toContain("saving 6.50 INR");
  });

  it("has one row per step with the numbers as shown, appliances by name", () => {
    const data = lines.filter((l) => !l.startsWith("#"));
    expect(data).toHaveLength(3);
    expect(data[0]).toBe(
      'time,load_kw,pv_forecast_kw,pv_used_kw,pv_curtailed_kw,grid_import_kw,grid_export_kw,battery_charge_kw,battery_discharge_kw,battery_soc_kwh,ev_charge_kw,"appliance_kw: =HYPERLINK(""x""), pump",import_price_inr_per_kwh,export_price_inr_per_kwh',
    );
    expect(data[2]).toBe("2026-10-07T11:30:00.000Z,2,0,0,0,1.5,0,0,0.5,6,0,0.25,10,3");
  });
});
