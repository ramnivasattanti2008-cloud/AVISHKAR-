import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROPERTY_ID, fakeApi, json, provenance } from "@/test/fixtures";
import type { EnergyAllocation } from "@/lib/types";
import { AllocationPanel } from "./AllocationPanel";

const base = `/api/properties/${PROPERTY_ID}`;

const RULE = [
  "The sun serves what the property is using now.",
  "What is left of the sun charges the battery.",
  "What is still left is sold.",
  "Demand the sun did not cover is taken from the battery, and only then bought from the grid.",
  "Charging the sun did not cover was bought from the grid.",
  "The battery is a queue: energy goes in labelled with where it came from, and comes out first in, first out.",
];

function allocation(over: Partial<EnergyAllocation> = {}): EnergyAllocation {
  return {
    label: "WHERE EVERY kWh WENT",
    propertyId: PROPERTY_ID,
    madeAt: "2026-10-20T10:00:00.000Z",
    basedOn: { planId: "44444444-4444-4444-8444-444444444444", madeAt: "2026-10-20T09:00:00.000Z", stale: false, note: "Read from this plan; nothing was recomputed." },
    rule: RULE,
    hours: [],
    totals: {
      value: {
        solar: { madeKwh: 14.1, toDemandKwh: 6.4, toBatteryKwh: 5.2, soldKwh: 2.5, thrownAwayKwh: 0 },
        demand: { kwh: 12.7, servedKwh: 12.7, fromSolarKwh: 6.4, fromBatteryKwh: 4.7, fromGridKwh: 1.6 },
        battery: { inKwh: 5.2, outKwh: 4.7, lostKwh: 0.3, levelChangeKwh: 0.2, outFromSolarKwh: 4.5, outFromGridKwh: 0.2 },
        grid: { boughtKwh: 1.6, forDemandKwh: 1.6, forBatteryKwh: 0, soldKwh: 2.5 },
        money: { boughtForDemandInr: 12, boughtForBatteryInr: 0, soldInr: 8.75, batteryDisplacedInr: 44.65, storedSolarDisplacedInr: 42.75 },
      },
      unit: "kWh",
      provenance: provenance({ status: "SIMULATED", provider: "avishkar-allocation", dataType: "energy_allocation", notes: ["A simulated day: the plan made 2026-10-20T09:00:00.000Z.", "The split between sources and destinations follows the stated order; the optimiser does not record which kWh went where."] }),
    },
    check: { balanced: true, maxHourErrorKwh: 0, note: "Every kWh of each hour is put in exactly one place, by the order this ledger states. The optimiser does not record which kWh went where, so this is an accounting convention, not a measurement." },
    next: [],
    ...over,
  };
}

const world = (a: EnergyAllocation = allocation()) => vi.stubGlobal("fetch", fakeApi([["GET", `${base}/allocation`, () => json(a)]]).fetch);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AllocationPanel", () => {
  it("shows where the sun went, with the four destinations adding up to what was made", async () => {
    world();
    render(<AllocationPanel id={PROPERTY_ID} />);
    const sec = await screen.findByRole("region", { name: "Where every kWh went" });
    const sun = within(sec).getByRole("table", { name: "Where the solar energy of the plan went" });
    expect(within(sun).getByText("6.4 kWh")).toBeInTheDocument(); // used as made
    expect(within(sun).getByText("5.2 kWh")).toBeInTheDocument(); // stored
    expect(within(sun).getByText("2.5 kWh")).toBeInTheDocument(); // sold
    expect(within(sun).getByText("14.1 kWh")).toBeInTheDocument(); // made in all
    expect(within(sun).getByText(/earned ₹8.75/)).toBeInTheDocument();
  });

  it("shows what met the demand, with what the battery's energy was worth at the hours it was used", async () => {
    world();
    render(<AllocationPanel id={PROPERTY_ID} />);
    const used = await screen.findByRole("table", { name: "What met the demand of the plan" });
    expect(within(used).getByText("4.7 kWh")).toBeInTheDocument();
    expect(within(used).getByText(/worth ₹44.65 at the hours it was used/)).toBeInTheDocument();
    expect(within(used).getByText(/cost ₹12/)).toBeInTheDocument();
    expect(within(used).getByText("12.7 kWh")).toBeInTheDocument();
  });

  it("says what the battery lost, and does not call the stored sun the plan's saving", async () => {
    world();
    render(<AllocationPanel id={PROPERTY_ID} />);
    expect(await screen.findByText("0.3 kWh")).toBeInTheDocument();
    expect(screen.getByText(/in and out again is never free/)).toBeInTheDocument();
    expect(screen.getByText(/4.5 kWh of it stored sun/)).toBeInTheDocument();
    expect(screen.getByText(/That is not the plan's saving, which is measured against the same day with no control/)).toBeInTheDocument();
  });

  it("states the order it attributes by, and that it is a convention rather than a measurement", async () => {
    const user = userEvent.setup();
    world();
    render(<AllocationPanel id={PROPERTY_ID} />);
    await user.click(await screen.findByText("how this is worked out"));
    const steps = within(screen.getByRole("list", { name: "The order the energy is attributed in" })).getAllByRole("listitem");
    expect(steps).toHaveLength(RULE.length);
    expect(steps[0]).toHaveTextContent("The sun serves what the property is using now.");
    expect(screen.getByText(/accounting convention, not a measurement/)).toBeInTheDocument();
    expect(screen.getByText("Checked: every kWh of every hour is in exactly one place.")).toBeInTheDocument();
  });

  it("says plainly when the books do not close, instead of showing the figures as if they did", async () => {
    const user = userEvent.setup();
    world(allocation({ check: { balanced: false, maxHourErrorKwh: 0.42, note: "x" } }));
    render(<AllocationPanel id={PROPERTY_ID} />);
    await user.click(await screen.findByText("how this is worked out"));
    expect(screen.getByText(/The books do not close: one hour is out by 0.42 kWh/)).toBeInTheDocument();
  });

  it("shows no figures at all, and the reason, before there is a plan", async () => {
    world(
      allocation({
        basedOn: null,
        totals: { value: null, unit: "kWh", provenance: provenance({ status: "UNAVAILABLE", provider: "avishkar-allocation", dataType: "energy_allocation", notes: ["No plan has been made yet, and the ledger is read from the latest plan."] }) },
      }),
    );
    render(<AllocationPanel id={PROPERTY_ID} />);
    expect(await screen.findByText("No plan has been made yet, and the ledger is read from the latest plan.")).toBeInTheDocument();
    expect(screen.getByText("UNAVAILABLE")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText(/kWh$/)).not.toBeInTheDocument();
  });

  it("shows nothing of a battery that is not there", async () => {
    const a = allocation();
    a.totals.value!.battery = null;
    world(a);
    render(<AllocationPanel id={PROPERTY_ID} />);
    expect(await screen.findByRole("region", { name: "Where every kWh went" })).toBeInTheDocument();
    expect(screen.queryByText("The battery")).not.toBeInTheDocument();
    expect(screen.queryByText(/in and out again is never free/)).not.toBeInTheDocument();
  });
});
