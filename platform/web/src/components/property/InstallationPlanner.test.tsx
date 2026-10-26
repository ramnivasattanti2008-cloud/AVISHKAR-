import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Twin } from "@/lib/types";
import { property } from "@/test/fixtures";
import { calculatePmSuryaGharSubsidy, InstallationPlanner } from "./InstallationPlanner";

type U = { id: string; email: string; role: string; displayName: string | null } | null;
const auth = vi.hoisted(() => ({ user: null as U }));
vi.mock("../AuthProvider", () => ({ useAuth: () => ({ user: auth.user, loading: false }) }));

const propData = vi.hoisted(() => ({
  property: null as ReturnType<typeof property> | null,
  twin: null as unknown as Twin | null,
  loading: false,
  error: null as string | null,
  notFound: false,
}));
vi.mock("./usePropertyData", () => ({
  usePropertyData: () => propData,
}));

beforeEach(() => {
  auth.user = { id: "u1", email: "user@example.com", role: "USER", displayName: null };
  propData.property = property();
  propData.twin = { id: "tw1", solar: { usableRoofAreaM2: { value: 50, unit: "m2" } } } as unknown as Twin;
  propData.loading = false;
  propData.error = null;
  propData.notFound = false;
});

afterEach(() => {
  cleanup();
});

describe("calculatePmSuryaGharSubsidy", () => {
  it("calculates correct subsidy across tiers", () => {
    expect(calculatePmSuryaGharSubsidy(0, true)).toBe(0);
    expect(calculatePmSuryaGharSubsidy(1, true)).toBe(30000);
    expect(calculatePmSuryaGharSubsidy(2, true)).toBe(60000);
    expect(calculatePmSuryaGharSubsidy(3, true)).toBe(78000);
    expect(calculatePmSuryaGharSubsidy(5, true)).toBe(78000); // capped at 78,000 for residential
    expect(calculatePmSuryaGharSubsidy(3, false)).toBe(0); // non-residential
  });
});

describe("InstallationPlanner", () => {
  it("renders the equipment sizing controls and investment projections", () => {
    render(<InstallationPlanner id="p1" />);
    expect(screen.getByText("Installation Sizing & Investment Planner")).toBeDefined();
    expect(screen.getByText("Solar Array Capacity")).toBeDefined();
    expect(screen.getByText("Battery Storage (LFP)")).toBeDefined();
    expect(screen.getByText("Gross Capital Investment")).toBeDefined();
    expect(screen.getByText("PM Surya Ghar Subsidy")).toBeDefined();
    expect(screen.getByText("Net Capital Outlay")).toBeDefined();
    expect(screen.getByText(/25-Year Lifecycle Returns/i)).toBeDefined();
  });

  it("recomputes financial and sizing metrics when sliders are adjusted", () => {
    render(<InstallationPlanner id="p1" />);
    const solarSlider = screen.getByLabelText("Solar Array Capacity");
    fireEvent.change(solarSlider, { target: { value: "5" } });
    expect(screen.getByText("5 kWp")).toBeDefined();

    const batterySlider = screen.getByLabelText("Battery Storage (LFP)");
    fireEvent.change(batterySlider, { target: { value: "10" } });
    expect(screen.getByText("10 kWh")).toBeDefined();
  });
});
