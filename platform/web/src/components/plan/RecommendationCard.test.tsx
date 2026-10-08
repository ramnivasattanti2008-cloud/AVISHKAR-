import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { plan } from "@/test/fixtures";
import { RecommendationCard } from "./RecommendationCard";

afterEach(cleanup);

describe("RecommendationCard", () => {
  it("shows the move, why, the data used, the expected benefit and how steady it is, under the plan's own label", () => {
    render(<RecommendationCard plan={plan()} />);
    const sec = screen.getByRole("region", { name: "What to do next" });
    expect(within(sec).getByText("Use the battery from 16:00: 2 kWh before 19:00.")).toBeInTheDocument();
    expect(within(sec).getByText("SIMULATED")).toBeInTheDocument();
    expect(within(sec).getByText("discharged at 18:00 to avoid importing at INR 10.00 per kWh")).toBeInTheDocument();
    expect(within(sec).getByText(/Tariff: Test ToD/)).toBeInTheDocument();
    expect(within(sec).getByText("Battery: 9 kWh usable, starting at 1 kWh (assumed)")).toBeInTheDocument();
    expect(within(sec).getByText("₹11.70")).toBeInTheDocument();
    expect(within(sec).getByText(/not this move alone/)).toBeInTheDocument();
    expect(within(sec).getByText("3 of 4 forecasts agree")).toBeInTheDocument();
    expect(within(sec).getByText(/Less steady: the planner gives the same advice/)).toBeInTheDocument();
    expect(within(sec).getByText("1 assumptions")).toBeInTheDocument();
  });

  it("lists every forecast tried, what the battery does in each, and which agree", async () => {
    render(<RecommendationCard plan={plan()} />);
    await userEvent.click(screen.getByText("The forecasts tried"));
    const table = screen.getByRole("table", { name: "The battery in the next three hours under each forecast tried" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(5);
    expect(within(rows[1]!).getByText("The forecast as it is (central estimate)")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("leaves it, leaves it, uses it")).toBeInTheDocument();
    expect(within(rows[3]!).getByText("More sun than forecast (90th percentile)")).toBeInTheDocument();
    expect(within(rows[3]!).getByText("charges, leaves it, uses it")).toBeInTheDocument();
    expect(within(rows[3]!).getByText("1.2 / 0.8 kWh")).toBeInTheDocument();
    expect(within(rows[3]!).getByText("no")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("yes")).toBeInTheDocument();
  });

  it("says plainly when it was not assessed, shows no table and no made-up percentage", () => {
    const base = plan();
    const r = base.recommendation!;
    render(
      <RecommendationCard
        plan={{ ...base, recommendation: { ...r, kind: "NO_BATTERY_MOVE", headline: "There is no battery, so there is nothing to store or release.", why: [], confidence: { assessed: false, agreeing: 0, total: 0, statement: "Not assessed: there is no battery, so the advice has no battery move to test against the forecast bands.", scenarios: [] } } }}
      />,
    );
    expect(screen.getByText("not assessed")).toBeInTheDocument();
    expect(screen.getByText(/Not assessed: there is no battery/)).toBeInTheDocument();
    expect(screen.queryByText("The forecasts tried")).not.toBeInTheDocument();
    expect(screen.getByText(/no single price or flow behind this/)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("shows nothing for a plan made before recommendations existed", () => {
    const { recommendation: _gone, ...old } = plan();
    const { container } = render(<RecommendationCard plan={old as ReturnType<typeof plan>} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("calls a unanimous result steady, in the live colour", () => {
    const base = plan();
    const r = base.recommendation!;
    render(<RecommendationCard plan={{ ...base, recommendation: { ...r, confidence: { ...r.confidence, agreeing: 4, total: 4 } } }} />);
    expect(screen.getByText("4 of 4 forecasts agree")).toHaveAttribute("data-tone", "live");
  });
});
