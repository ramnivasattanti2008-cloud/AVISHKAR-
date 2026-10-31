import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi, json, property } from "@/test/fixtures";
import { PropertyComparisonView } from "./PropertyComparisonView";

type U = { id: string; email: string; role: string; displayName: string | null } | null;
const auth = vi.hoisted(() => ({ user: null as U }));
vi.mock("../AuthProvider", () => ({ useAuth: () => ({ user: auth.user, loading: false }) }));

const propA = property({ id: "prop-a", name: "Pune Commercial Rooftop", isDemo: false });
const propB = property({ id: "prop-b", name: "Bengaluru Villa", isDemo: true });

const mockTwinA = {
  id: "t-a",
  solar: {
    usableRoofAreaM2: { value: 120, unit: "m2" },
    capacityKwEstimate: { value: 12.0, unit: "kWp" },
    estimatedDailyGenerationKwh: { value: 48.5, unit: "kWh/day" },
  },
  profiles: {
    solar: { value: { existingKwp: 10, plannedKwp: 0 } },
    battery: { value: { count: 1, totalCapacityKwh: 15, totalUsableKwh: 13, maxChargeKw: 5, maxDischargeKw: 5 } },
    ev: { value: null },
    appliances: { value: null },
  },
  tariff: { value: { name: "MSEDCL LT-II", discom: "MSEDCL", exportRateBasis: "REGULATOR_ORDER" } },
};

const mockTwinB = {
  id: "t-b",
  solar: {
    usableRoofAreaM2: { value: 45, unit: "m2" },
    capacityKwEstimate: { value: 4.5, unit: "kWp" },
    estimatedDailyGenerationKwh: { value: 18.2, unit: "kWh/day" },
  },
  profiles: {
    solar: { value: null },
    battery: { value: null },
    ev: { value: { count: 1, totalBatteryKwh: 40, maxChargerKw: 7.4 } },
    appliances: { value: null },
  },
  tariff: { value: { name: "BESCOM LT-2", discom: "BESCOM", exportRateBasis: "REGULATOR_ORDER" } },
};

function world() {
  const api = fakeApi([
    ["GET", "/api/properties", () => json({ properties: [propA, propB] })],
    ["GET", "/api/properties/prop-a/twin", () => json(mockTwinA)],
    ["GET", "/api/properties/prop-b/twin", () => json(mockTwinB)],
  ]);
  vi.stubGlobal("fetch", api.fetch);
  return api;
}

beforeEach(() => {
  auth.user = { id: "u1", email: "user@example.com", role: "USER", displayName: null };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PropertyComparisonView", () => {
  it("renders the comparison matrix with selected properties side-by-side", async () => {
    world();
    render(<PropertyComparisonView />);
    expect(await screen.findByText("Property Comparison Matrix")).toBeDefined();
    expect(await screen.findByText("Pune Commercial Rooftop")).toBeDefined();
    expect(await screen.findByText("Bengaluru Villa")).toBeDefined();
    expect(screen.getByRole("table", { name: "Property comparison table" })).toBeDefined();
    expect(screen.getByText("120 m² usable")).toBeDefined();
    expect(screen.getByText("10.0 kWp installed")).toBeDefined();
    expect(screen.getByText("15.0 kWh (1 unit)")).toBeDefined();
  });

  it("toggles properties in and out of the comparison matrix", async () => {
    world();
    render(<PropertyComparisonView />);
    const propBtn = await screen.findByRole("button", { name: /Bengaluru Villa/ });
    expect(propBtn).toBeDefined();
    fireEvent.click(propBtn); // Deselect
    expect(propBtn.getAttribute("aria-pressed")).toBe("false");
  });
});
