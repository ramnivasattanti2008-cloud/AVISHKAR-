import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { appliance, battery, ev, solarSystem } from "@/test/fixtures";
import { ApplianceCard, BatteryCard, EvCard, SolarCard } from "./AssetCards";

const actions = <button type="button">Change</button>;

describe("BatteryCard", () => {
  it("labels every default as a default, so it cannot pass for the owner's figure", () => {
    render(<BatteryCard b={battery()} actions={actions} />);
    const card = screen.getByRole("article", { name: "Garage battery" });
    expect(within(card).getAllByText("DEFAULT").length).toBe(5); // charge, discharge, min, max, wear
    expect(within(card).queryByText("ENTERED")).not.toBeInTheDocument();
    expect(within(card).getByText("worked out by the planner")).toBeInTheDocument();
    expect(within(card).getByText("PLANNER")).toBeInTheDocument();
    expect(card).toHaveTextContent("10 kWh, 9 kWh usable");
    expect(card).toHaveTextContent("94.9%");
  });

  it("labels what the owner entered as entered", () => {
    const b = battery({
      entered: { ...battery().entered, chargeEfficiency: 0.96, reserveSoc: 0.3 },
      effective: { ...battery().effective, chargeEfficiency: { value: 0.96, basis: "USER_ENTERED", note: "Entered by you." }, reserveSoc: { value: 0.3, basis: "USER_ENTERED", note: "Entered by you." } },
    });
    render(<BatteryCard b={b} actions={actions} />);
    expect(screen.getAllByText("ENTERED")).toHaveLength(2);
    expect(screen.getAllByText("DEFAULT")).toHaveLength(4);
    expect(screen.queryByText("PLANNER")).not.toBeInTheDocument();
    expect(screen.getByText("30%")).toBeInTheDocument();
  });

  it("marks a planned battery as planned and shows the charge when known", () => {
    render(<BatteryCard b={battery({ status: "PLANNED", entered: { ...battery().entered, currentSoc: 0.6 } })} actions={actions} />);
    expect(screen.getByText("PLANNED")).toBeInTheDocument();
    expect(screen.getByText("Charge now")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
  });

  it("shows the actions it is given", () => {
    render(<BatteryCard b={battery()} actions={actions} />);
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
  });
});

describe("SolarCard", () => {
  it("shows orientation and a defaulted loss figure as a default", () => {
    render(<SolarCard s={solarSystem({ inverterKw: 3, installedOn: "2024-05-01" })} actions={actions} />);
    expect(screen.getByText("tilt 15°, facing 180° from north")).toBeInTheDocument();
    expect(screen.getByText("14%")).toBeInTheDocument();
    expect(screen.getByText("DEFAULT")).toBeInTheDocument();
    expect(screen.getByText("3 kW")).toBeInTheDocument();
    expect(screen.getByText("2024-05-01")).toBeInTheDocument();
  });
});

describe("EvCard", () => {
  it("shows when and how much it needs, and the charger efficiency as a default", () => {
    render(<EvCard e={ev()} actions={actions} />);
    expect(screen.getByText("80% by 07:30 on Mon, Tue, Wed, Thu, Fri")).toBeInTheDocument();
    expect(screen.getByText("DEFAULT")).toBeInTheDocument();
    expect(screen.getByText("40 kWh battery, 7.4 kW charger")).toBeInTheDocument();
  });
});

describe("ApplianceCard", () => {
  it("shows the priority, and that a rating is a ceiling", () => {
    render(<ApplianceCard a={appliance()} actions={actions} />);
    expect(screen.getByText("CRITICAL")).toBeInTheDocument();
    expect(screen.getByText(/a rating, not what it draws/)).toBeInTheDocument();
  });

  it("shows the quantity and the total, and the window of a flexible one", () => {
    render(
      <ApplianceCard
        a={appliance({ name: "Washer", kind: "washing machine", priority: "FLEXIBLE", quantity: 2, ratedPowerW: 500, totalRatedKw: 1, flexibility: { earliestStart: "22:00", latestFinish: "06:00", durationMin: 120, interruptible: true, windowMinutes: 480 } })}
        actions={actions}
      />,
    );
    expect(screen.getByRole("article", { name: "Washer (×2)" })).toBeInTheDocument();
    expect(screen.getByText(/1 kW in total/)).toBeInTheDocument();
    expect(screen.getByText("22:00 to 06:00 for 120 min, can be paused")).toBeInTheDocument();
  });
});
