import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROPERTY_ID, cloudFront, fakeApi, json } from "@/test/fixtures";
import { CloudFrontPanel } from "./CloudFrontPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function world(handler = () => json(cloudFront())) {
  const api = fakeApi([["POST", `/api/properties/${PROPERTY_ID}/cloud-front`, handler]]);
  vi.stubGlobal("fetch", api.fetch);
  return api;
}

describe("CloudFrontPanel", () => {
  it("says the front is a scenario you set, and starts with the example values in the boxes", () => {
    world();
    render(<CloudFrontPanel id={PROPERTY_ID} />);
    expect(screen.getByText(/The front is a\s+scenario you set: AVISHKAR has no cloud nowcast/)).toBeInTheDocument();
    expect(screen.getByLabelText("Arrives in, minutes")).toHaveValue("38");
    expect(screen.getByLabelText("Takes this much sun, %")).toHaveValue("22");
    expect(screen.getByLabelText("Takes this long to pass, hours")).toHaveValue("3");
    expect(screen.queryByRole("region", { name: "Cloud front result" })).not.toBeInTheDocument();
  });

  it("shows the situation, the advice, and with against without, every figure the planner's, with its label", async () => {
    const api = world();
    render(<CloudFrontPanel id={PROPERTY_ID} />);
    await userEvent.click(screen.getByRole("button", { name: "Run the scenario" }));
    const res = await screen.findByRole("region", { name: "Cloud front result" });
    expect(api.called("POST", `/api/properties/${PROPERTY_ID}/cloud-front`)[0]!.body).toEqual({ arrivalMinutes: 38, reductionPercent: 22, durationHours: 3 });
    expect(within(res).getByText("SIMULATED")).toBeInTheDocument();
    expect(within(res).getByText("CLOUD FRONT SCENARIO")).toBeInTheDocument();
    expect(within(res).getByText("5.4 kW")).toBeInTheDocument();
    expect(within(res).getByText("in 38 min")).toBeInTheDocument();
    expect(within(res).getByText("22%")).toBeInTheDocument();
    expect(within(res).getByText(/takes 0\.55 kWh, 17\.2% of the day's sun/)).toBeInTheDocument();
    expect(within(res).getByText("42%")).toBeInTheDocument();
    expect(within(res).getByText("assumed: enter the real charge to change it")).toBeInTheDocument();
    expect(within(res).getByText("HIGH")).toBeInTheDocument();
    expect(within(res).getByRole("status")).toHaveTextContent("Charge the battery now: knowing the front is coming");

    const table = within(res).getByRole("table", { name: /Grid energy and cost without and with AVISHKAR/ });
    const rows = within(table).getAllByRole("row");
    expect(within(rows[1]!).getByText("Without AVISHKAR")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("21.5 kWh")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("22.2 kWh")).toBeInTheDocument();
    expect(within(rows[3]!).getByText("0.7 kWh more")).toBeInTheDocument(); // the plan buys more cheap energy, and the page says why
    expect(within(rows[3]!).getByText(/saved/)).toHaveTextContent("₹20.25 saved");
    expect(within(res).getByText(/The plan buys more from the grid because it buys cheap energy to store/)).toBeInTheDocument();
    expect(within(res).getByText(/On the forecast sky, with no front, the same day would cost/)).toHaveTextContent("₹139.05 with the plan and ₹156.40 with no control. The front adds ₹1.20 to the plan's bill and ₹4.10 to the no-control bill.");
    expect(within(res).queryByText(/The plan can lose more to a front than no control does/)).not.toBeInTheDocument();
    expect(within(res).getByRole("img", { name: /Solar with and without the front, and what is bought and stored, in kW/ })).toBeInTheDocument();
    expect(within(res).getByText("2 assumptions")).toBeInTheDocument();
  });

  it("sends the numbers that were typed", async () => {
    const api = world();
    render(<CloudFrontPanel id={PROPERTY_ID} />);
    const arrival = screen.getByLabelText("Arrives in, minutes");
    await userEvent.clear(arrival);
    await userEvent.type(arrival, "90");
    const reduction = screen.getByLabelText("Takes this much sun, %");
    await userEvent.clear(reduction);
    await userEvent.type(reduction, "60");
    await userEvent.click(screen.getByRole("button", { name: "Run the scenario" }));
    await screen.findByRole("region", { name: "Cloud front result" });
    expect(api.called("POST", `/api/properties/${PROPERTY_ID}/cloud-front`)[0]!.body).toEqual({ arrivalMinutes: 90, reductionPercent: 60, durationHours: 3 });
  });

  it("does not call the server for a front that is not one, and says why", async () => {
    const api = world();
    render(<CloudFrontPanel id={PROPERTY_ID} />);
    const reduction = screen.getByLabelText("Takes this much sun, %");
    await userEvent.clear(reduction);
    await userEvent.type(reduction, "0");
    await userEvent.click(screen.getByRole("button", { name: "Run the scenario" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The front must take between 1 and 95 percent of the sun.");
    await userEvent.clear(reduction);
    await userEvent.type(reduction, "22");
    const arrival = screen.getByLabelText("Arrives in, minutes");
    await userEvent.clear(arrival);
    await userEvent.type(arrival, "abc");
    await userEvent.click(screen.getByRole("button", { name: "Run the scenario" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The front must arrive between 1 and 720 minutes from now.");
    expect(api.called("POST", `/api/properties/${PROPERTY_ID}/cloud-front`)).toHaveLength(0);
  });

  it("says what a property lacks when it has no solar, and shows no result", async () => {
    world(() => json({ error: { code: "PLAN_INPUTS_MISSING", message: "A cloud front needs sun to take away: this property has no solar system.", details: { missing: [{ what: "solar", why: "Add a solar system on the Assets tab." }] } } }, 422));
    render(<CloudFrontPanel id={PROPERTY_ID} />);
    await userEvent.click(screen.getByRole("button", { name: "Run the scenario" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A cloud front needs sun to take away: this property has no solar system. Add a solar system on the Assets tab.");
    expect(screen.queryByRole("region", { name: "Cloud front result" })).not.toBeInTheDocument();
  });

  it("shows a missing sun-now figure as a dash, a home with no battery as no battery, and DEMO when the server labels it so", async () => {
    const base = cloudFront();
    const v = base.result.value!;
    world(() =>
      json(
        cloudFront({
          result: {
            value: { ...v, solarNowKw: null, batteryNowPercent: null, batteryNowBasis: null, eveningDemand: null, advice: { code: "NO_BATTERY", text: "There is no battery to charge.", extraChargeKwh: 0, extraHeldKwh: 0 }, difference: { importKwh: 3.2, savingsInr: 4 } },
            provenance: { ...base.result.provenance, status: "DEMO" },
          },
        }),
      ),
    );
    render(<CloudFrontPanel id={PROPERTY_ID} />);
    await userEvent.click(screen.getByRole("button", { name: "Run the scenario" }));
    const res = await screen.findByRole("region", { name: "Cloud front result" });
    expect(within(res).getByText("DEMO")).toBeInTheDocument();
    expect(within(res).getByText("the forecast does not cover this hour")).toBeInTheDocument();
    expect(within(res).getByText("no battery")).toBeInTheDocument();
    expect(within(res).getByText("3.2 kWh less")).toBeInTheDocument();
    expect(within(res).queryByText(/The plan buys more from the grid/)).not.toBeInTheDocument();
    expect(within(res).getByText("There is no battery to charge.")).toBeInTheDocument();
  });
});
