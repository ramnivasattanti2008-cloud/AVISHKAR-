import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROPERTY_ID, fakeApi, json, provenance } from "@/test/fixtures";
import type { PlanRobustness } from "@/lib/types";
import { RobustnessPanel } from "./RobustnessPanel";

const base = `/api/properties/${PROPERTY_ID}`;

const outcome = (netCostInr: number, vsExpectedInr: number, importKwh = 6) => ({ netCostInr, importKwh, exportKwh: 2, vsExpectedInr });

function robustness(over: Partial<PlanRobustness> = {}): PlanRobustness {
  const scenarios: PlanRobustness["scenarios"] = [
    { key: "lowSun", label: "Less sun than expected", built: "The lower end of the solar forecast's own band.", state: "RUN", reason: null, result: outcome(41.2, 15.5) },
    { key: "highDemand", label: "More demand than expected", built: "The upper end of the load forecast's own band.", state: "RUN", reason: null, result: outcome(33.1, 7.4) },
    { key: "both", label: "Less sun and more demand together", built: "Both ends at once.", state: "RUN", reason: null, result: outcome(49.8, 24.1) },
    { key: "moreSun", label: "More sun than expected", built: "The upper end of the solar forecast's own band.", state: "UNAVAILABLE", reason: "The solar forecast has no calibrated band for this place yet.", result: null },
  ];
  return {
    label: "IF THE DAY TURNS OUT DIFFERENTLY",
    propertyId: PROPERTY_ID,
    madeAt: "2026-10-20T10:00:00.000Z",
    basedOn: { planId: "44444444-4444-4444-8444-444444444444", madeAt: "2026-10-20T09:00:00.000Z", stale: false, note: "The plan as it stands; nothing was recomputed." },
    scenarios,
    result: {
      value: {
        expected: outcome(25.7, 0, 5.8),
        scenarios,
        worst: { key: "both", label: "Less sun and more demand together", netCostInr: 49.8, vsExpectedInr: 24.1 },
        statement: "Of the days tried, the dearest costs INR 24.10 more than the day the plan was made for (less sun and more demand together).",
        whyNothingFails: "No day here can defeat the plan: its battery moves are carried out whatever the weather, and the grid makes up whatever the sun does not cover. What a worse day changes is the bill, not whether the plan can be followed.",
      },
      unit: "INR",
      provenance: provenance({ status: "SIMULATED", provider: "avishkar-robustness", dataType: "plan_robustness", notes: ["The ends of a band are where 1 hour in 10 falls beyond. No probability is attached."] }),
    },
    next: [],
    ...over,
  };
}

const world = (r: PlanRobustness = robustness()) => vi.stubGlobal("fetch", fakeApi([["GET", `${base}/robustness`, () => json(r)]]).fetch);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RobustnessPanel", () => {
  it("shows the day the plan was made for beside each worse day, and what each then costs", async () => {
    world();
    render(<RobustnessPanel id={PROPERTY_ID} />);
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(6); // the header, the day it was made for, and four scenarios
    expect(within(rows[1]!).getByText("₹25.70")).toBeInTheDocument();
    const low = within(rows.find((r) => within(r).queryByText("Less sun than expected"))!);
    expect(low.getByText("₹41.20")).toBeInTheDocument();
    expect(low.getByText("+₹15.50")).toBeInTheDocument();
  });

  it("says what it found in a sentence, and never claims a likelihood", async () => {
    world();
    render(<RobustnessPanel id={PROPERTY_ID} />);
    await screen.findByRole("table"); // the loading line is a status too, so wait until the answer is in
    expect(screen.getByRole("status")).toHaveTextContent("the dearest costs INR 24.10 more");
    expect(screen.getByText(/not from guesses, and none of them carries a probability/)).toBeInTheDocument();
  });

  it("explains that no day can defeat the plan, so a reader does not take a missing failure for luck", async () => {
    world();
    render(<RobustnessPanel id={PROPERTY_ID} />);
    expect(await screen.findByText(/the grid makes up whatever the sun does not cover/)).toBeInTheDocument();
  });

  it("gives a day that cannot be tried its reason, and no figures", async () => {
    world();
    render(<RobustnessPanel id={PROPERTY_ID} />);
    const row = (await screen.findAllByRole("row")).find((r) => within(r).queryByText("More sun than expected"))!;
    expect(within(row).getByText("Cannot be tried")).toBeInTheDocument();
    expect(within(row).getByText(/no calibrated band for this place yet/)).toBeInTheDocument();
    expect(within(row).queryByText(/₹/)).not.toBeInTheDocument();
  });

  it("shows nothing but the reason before there is a plan", async () => {
    world(
      robustness({
        basedOn: null,
        scenarios: [],
        result: { value: null, unit: "INR", provenance: provenance({ status: "UNAVAILABLE", provider: "avishkar-robustness", dataType: "plan_robustness", notes: ["No plan has been made yet, and this follows the plan that was chosen."] }) },
      }),
    );
    render(<RobustnessPanel id={PROPERTY_ID} />);
    expect(await screen.findByText("No plan has been made yet, and this follows the plan that was chosen.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
