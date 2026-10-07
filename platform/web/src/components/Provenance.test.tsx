import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Measured, Provenance } from "@/lib/types";
import { Measure, ProvenanceDetails, StatusBadge } from "./Provenance";

const prov = (over: Partial<Provenance> = {}): Provenance => ({
  status: "ESTIMATED",
  source: "AVISHKAR estimate",
  provider: "avishkar",
  dataType: "capacity",
  generatedAt: "2026-10-07T12:00:00.000Z",
  processingVersion: "twin-1",
  notes: [],
  ...over,
});

const measured = (value: number | null, over: Partial<Provenance> = {}, unit = "kWp"): Measured<number> => ({ value, unit, provenance: prov(over) });

describe("StatusBadge", () => {
  it("shows the label and explains it to screen readers", () => {
    render(<StatusBadge status="FORECAST" />);
    const badge = screen.getByText("FORECAST");
    expect(badge).toHaveAttribute("data-tone", "forecast");
    expect(badge).toHaveAttribute("aria-label", expect.stringContaining("prediction"));
  });
});

describe("Measure", () => {
  it("shows a value with its unit and its status", () => {
    render(<Measure label="Estimated capacity" m={measured(5.2)} digits={1} />);
    expect(screen.getByText("Estimated capacity")).toBeInTheDocument();
    expect(screen.getByText("5.2")).toBeInTheDocument();
    expect(screen.getByText("kWp")).toBeInTheDocument();
    expect(screen.getByText("ESTIMATED")).toBeInTheDocument();
  });

  it("shows a dash and the reason, never a number, when the value is unavailable", () => {
    render(<Measure label="Electricity tariff" m={measured(null, { status: "UNAVAILABLE", notes: ["Tariff data unavailable: choose your state."] }, "INR/kWh")} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    // The reason is shown in the open, and repeated in the collapsed source details.
    const reasons = screen.getAllByText("Tariff data unavailable: choose your state.");
    expect(reasons.some((r) => !r.closest("details"))).toBe(true);
    expect(screen.getByText("UNAVAILABLE")).toBeInTheDocument();
    expect(screen.queryByText("INR/kWh")).not.toBeInTheDocument();
  });

  it("does not show a stray number when the status says UNAVAILABLE even if a value arrived", () => {
    render(<Measure label="Cloud cover" m={measured(40, { status: "UNAVAILABLE", notes: ["Provider down."] }, "%")} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("40")).not.toBeInTheDocument();
  });

  it("keeps LIVE and UPDATED distinct so stale data is never presented as live", () => {
    const { rerender } = render(<Measure label="Air temperature" m={measured(27.2, { status: "LIVE" }, "°C")} digits={1} />);
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    rerender(<Measure label="Air temperature" m={measured(27.2, { status: "UPDATED", ageSeconds: 7200 }, "°C")} digits={1} />);
    expect(screen.getByText("UPDATED")).toBeInTheDocument();
    expect(screen.queryByText("LIVE")).not.toBeInTheDocument();
  });
});

describe("ProvenanceDetails", () => {
  it("lists provider, source, time, age, fetch time, confidence, version and notes", () => {
    render(
      <ProvenanceDetails
        p={prov({ provider: "open-meteo", source: "Open-Meteo forecast API", observedAt: "2026-10-07T11:45:00.000Z", ageSeconds: 900, confidence: 0.7, modelVersion: "gfs-1", notes: ["Grid point 899 m from the property."] })}
      />,
    );
    const list = screen.getByText("Provider").closest("dl")!;
    const text = list.textContent!;
    expect(text).toContain("open-meteo");
    expect(text).toContain("Open-Meteo forecast API");
    expect(text).toContain("Observed");
    expect(text).toContain("15 min");
    expect(text).toContain("70%");
    expect(text).toContain("twin-1, model gfs-1");
    expect(within(list.parentElement!).getByText("Grid point 899 m from the property.")).toBeInTheDocument();
  });

  it("omits what it does not know instead of inventing it", () => {
    render(<ProvenanceDetails p={prov()} />);
    expect(screen.queryByText("Age")).not.toBeInTheDocument();
    expect(screen.queryByText("Confidence")).not.toBeInTheDocument();
    expect(screen.queryByText("Time")).not.toBeInTheDocument();
  });
});
