import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Plan } from "@/lib/types";
import { EnergyFlowDiagram } from "./EnergyFlowDiagram";

const fakePlan = {
  startsAt: "2026-10-26T00:00:00Z",
  stepHours: 1,
  schedule: {
    pvUsedKw: [0, 0, 0, 1.5, 3.2, 4.0, 2.5, 0.8, 0],
    pvCurtailedKw: [0, 0, 0, 0, 0.2, 0.5, 0, 0, 0],
    gridImportKw: [1.2, 1.1, 0.9, 0, 0, 0, 0, 0.5, 1.8],
    gridExportKw: [0, 0, 0, 0.5, 1.2, 2.0, 0.5, 0, 0],
    batteryChargeKw: [0, 0, 0, 0.5, 1.0, 1.0, 0.5, 0, 0],
    batteryDischargeKw: [0.5, 0.5, 0.4, 0, 0, 0, 0, 0.5, 0.8],
    batterySocKwh: [5.0, 4.5, 4.1, 4.6, 5.6, 6.6, 7.1, 6.6, 5.8],
    evChargeKw: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    applianceKw: {},
    servedLoadKw: [1.7, 1.6, 1.3, 1.0, 1.0, 1.0, 1.5, 1.8, 2.6],
    unservedKw: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  inputs: {
    battery: {
      capacityKwh: 10,
    },
  },
};

describe("EnergyFlowDiagram", () => {
  it("renders the interactive energy flow diagram with key elements", () => {
    render(<EnergyFlowDiagram plan={fakePlan as unknown as Plan} />);
    expect(screen.getByRole("region", { name: "Interactive Energy Flow Simulator" })).toBeDefined();
    expect(screen.getByText(/Solar Array/i)).toBeDefined();
    expect(screen.getByText(/Smart Storage/i)).toBeDefined();
    expect(screen.getByText(/Utility Grid/i)).toBeDefined();
    expect(screen.getByText(/Domestic Demand Sinks/i)).toBeDefined();
  });

  it("allows scrubbing to different hours on the timeline", () => {
    render(<EnergyFlowDiagram plan={fakePlan as unknown as Plan} />);
    const slider = screen.getByLabelText("Timeline scrubber");
    expect(slider).toBeDefined();

    // Move to step 4 (peak solar hour)
    fireEvent.change(slider, { target: { value: "4" } });
    expect(screen.getByText("Hour Step (5/9)")).toBeDefined();
    expect(screen.getByText("3.4")).toBeDefined(); // 3.2 used + 0.2 curtailed
  });

  it("toggles simulation playback", () => {
    render(<EnergyFlowDiagram plan={fakePlan as unknown as Plan} />);
    const playBtn = screen.getByRole("button", { name: "Start simulation playback" });
    fireEvent.click(playBtn);
    expect(screen.getByRole("button", { name: "Pause simulation playback" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Pause simulation playback" }));
    expect(screen.getByRole("button", { name: "Start simulation playback" })).toBeDefined();
  });
});
