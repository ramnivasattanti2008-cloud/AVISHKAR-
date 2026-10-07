import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { tariffPlan } from "@/test/fixtures";
import { RateBars } from "./RateBars";
import { TariffCard } from "./TariffCard";

describe("TariffCard", () => {
  it("raises an alert when the plan's published period has ended, and says what to do", () => {
    render(<TariffCard plan={tariffPlan()} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("2026-03-31");
    expect(alert).toHaveTextContent("check your latest bill");
    expect(alert).toHaveAttribute("data-validity", "EXPIRED");
  });

  it("does not alarm for a plan that is within its period", () => {
    render(<TariffCard plan={tariffPlan({ validity: { status: "WITHIN", message: "Valid to 2027-03-31." } })} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Valid to 2027-03-31.")).toBeInTheDocument();
  });

  it("still warns about an open-ended or undated plan: a newer order may exist", () => {
    const { rerender } = render(<TariffCard plan={tariffPlan({ validity: { status: "OPEN_ENDED", message: "In force from 2025-10-01; the source states no end date." } })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("no end date");
    rerender(<TariffCard plan={tariffPlan({ validity: { status: "UNKNOWN", message: "The source does not say when this tariff applies." } })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("does not say");
  });

  it("shows the rate range, the fixed charge and where the export credit came from", () => {
    render(<TariffCard plan={tariffPlan()} />);
    expect(screen.getByText("₹6.52 to ₹9.49 per kWh, by time of day")).toBeInTheDocument();
    expect(screen.getByText("₹520 per connection per month")).toBeInTheDocument();
    expect(screen.getByText("₹3.50 per kWh, an assumption: the source states none")).toBeInTheDocument();
    expect(screen.getByText("Not recorded for this plan")).toBeInTheDocument(); // metering mode
    expect(screen.getByText("Maharashtra · MSEDCL · LT II (0-20 kW) · Commercial")).toBeInTheDocument();
  });

  it("labels the data status and whether the plan is the catalogue's or the person's own", () => {
    const { rerender } = render(<TariffCard plan={tariffPlan()} />);
    expect(screen.getByText("CATALOGUE")).toBeInTheDocument();
    expect(screen.getByText("REFERENCE")).toBeInTheDocument();
    rerender(<TariffCard plan={tariffPlan({ origin: "USER" })} />);
    expect(screen.getByText("YOURS")).toBeInTheDocument();
  });

  it("lists slabs with their limits", () => {
    const slabbed = tariffPlan({ hourlyRates: Array(24).fill(7), slabs: [{ upToKwhPerMonth: 100, rate: 3 }, { upToKwhPerMonth: 300, rate: 5 }, { upToKwhPerMonth: null, rate: 7 }] });
    render(<TariffCard plan={slabbed} />);
    expect(screen.getByText("Up to 100 kWh: ₹3")).toBeInTheDocument();
    expect(screen.getByText("Up to 300 kWh: ₹5")).toBeInTheDocument();
    expect(screen.getByText("Above 300 kWh: ₹7")).toBeInTheDocument();
    expect(screen.getByText("₹3 to ₹7 per kWh, by monthly usage")).toBeInTheDocument();
  });

  it("keeps the source text one click away and shows the caller's actions", () => {
    render(<TariffCard plan={tariffPlan()} actions={<button type="button">Use for this property</button>} />);
    expect(screen.getByText(/MERC MYT order/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use for this property" })).toBeInTheDocument();
  });

  it("omits the chart in the compact form used in lists", () => {
    const { rerender } = render(<TariffCard plan={tariffPlan()} />);
    expect(screen.getByRole("img")).toBeInTheDocument();
    rerender(<TariffCard plan={tariffPlan()} compact />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("RateBars", () => {
  it("describes a varying tariff by its range and a flat one as flat", () => {
    const { rerender } = render(<RateBars rates={tariffPlan().hourlyRates} />);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Rate by hour of the day, from ₹6.52 to ₹9.49 per kWh");
    rerender(<RateBars rates={Array(24).fill(8.1)} />);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Flat rate of ₹8.10 per kWh all day");
  });

  it("draws 24 bars, each titled with its hour and price", () => {
    const { container } = render(<RateBars rates={tariffPlan().hourlyRates} />);
    const bars = container.querySelectorAll("[title]");
    expect(bars).toHaveLength(24);
    expect(bars[12]).toHaveAttribute("title", "12:00 to 13:00: ₹6.52 per kWh");
    expect(bars[23]).toHaveAttribute("title", "23:00 to 00:00: ₹9.49 per kWh");
  });
});
