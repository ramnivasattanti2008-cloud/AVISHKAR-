import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bill, fakeApi, json, tariffPlan } from "@/test/fixtures";
import { BillEstimator } from "./BillEstimator";

afterEach(() => vi.unstubAllGlobals());

const PLAN = tariffPlan();
const billRoute = (path = `/api/tariffs/${PLAN.id}/bill`) => ["POST", path, () => json(bill())] as ["POST", string, () => Response];

describe("BillEstimator", () => {
  it("cannot estimate until a usage is typed, and posts exactly what was typed", async () => {
    const api = fakeApi([billRoute()]);
    vi.stubGlobal("fetch", api.fetch);
    render(<BillEstimator plan={PLAN} />);
    const go = screen.getByRole("button", { name: "Estimate" });
    expect(go).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Energy used in a month/), "300");
    expect(go).toBeEnabled();
    await userEvent.click(go);
    expect(api.called("POST", `/api/tariffs/${PLAN.id}/bill`)).toHaveLength(1);
    expect(api.calls[0]!.body).toEqual({ monthlyKwh: 300 }); // an even spread sends no shape: the API says it assumed one
  });

  it("shows the estimate labelled ESTIMATED, with its line items and what it assumed", async () => {
    vi.stubGlobal("fetch", fakeApi([billRoute()]).fetch);
    render(<BillEstimator plan={PLAN} />);
    await userEvent.type(screen.getByLabelText(/Energy used in a month/), "300");
    await userEvent.click(screen.getByRole("button", { name: "Estimate" }));
    expect(await screen.findByText("Estimated bill for the month")).toBeInTheDocument();
    expect(screen.getByText("2884.38")).toBeInTheDocument();
    expect(screen.getAllByText("ESTIMATED").length).toBe(3);
    expect(screen.getByText("Energy at the usage-weighted time-of-day rate")).toBeInTheDocument();
    expect(screen.getByText(/spread evenly over the 24 hours/)).toBeInTheDocument();
    expect(screen.getByText(/taxes and surcharges are not included/)).toBeInTheDocument();
    expect(screen.getByText(/₹9.61 for each kWh on average/)).toBeInTheDocument();
  });

  it("sends a usage shape only when the person picks one, and says it is an assumption", async () => {
    const api = fakeApi([billRoute()]);
    vi.stubGlobal("fetch", api.fetch);
    render(<BillEstimator plan={PLAN} />);
    expect(screen.getByText(/an assumption you choose/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Energy used in a month/), "300");
    await userEvent.selectOptions(screen.getByLabelText(/When the energy is used/), "daytime");
    await userEvent.click(screen.getByRole("button", { name: "Estimate" }));
    const body = api.calls[0]!.body as { monthlyKwh: number; hourShare: number[] };
    expect(body.hourShare).toHaveLength(24);
    expect(body.hourShare.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(body.hourShare.slice(8, 18).reduce((a, b) => a + b, 0)).toBeCloseTo(0.7, 12);
  });

  it("does not offer a usage shape for a flat tariff, which has no time-of-day effect", () => {
    render(<BillEstimator plan={tariffPlan({ hourlyRates: Array(24).fill(8), touBlocks: [{ startHour: 0, endHour: 24, rate: 8 }] })} />);
    expect(screen.queryByLabelText(/When the energy is used/)).not.toBeInTheDocument();
  });

  it("asks for the sanctioned load only when the fixed charge is per kW, and sends it", async () => {
    const perKw = tariffPlan({ id: "33333333-3333-4333-8333-333333333333", fixedCharge: { amountInr: 110, basis: "PER_KW_MONTH" } });
    const api = fakeApi([billRoute(`/api/tariffs/${perKw.id}/bill`)]);
    vi.stubGlobal("fetch", api.fetch);
    const { rerender } = render(<BillEstimator plan={PLAN} />);
    expect(screen.queryByLabelText(/Sanctioned load/)).not.toBeInTheDocument();
    rerender(<BillEstimator plan={perKw} />);
    await userEvent.type(screen.getByLabelText(/Energy used in a month/), "200");
    await userEvent.type(screen.getByLabelText(/Sanctioned load/), "3");
    await userEvent.click(screen.getByRole("button", { name: "Estimate" }));
    expect(api.calls[0]!.body).toMatchObject({ monthlyKwh: 200, sanctionedLoadKw: 3 });
  });

  it("shows the server's plain-language error instead of a number", async () => {
    vi.stubGlobal("fetch", fakeApi([["POST", `/api/tariffs/${PLAN.id}/bill`, () => json({ error: { code: "VALIDATION_FAILED", message: "Monthly consumption must be zero or more." } }, 400)]]).fetch);
    render(<BillEstimator plan={PLAN} />);
    await userEvent.type(screen.getByLabelText(/Energy used in a month/), "5");
    await userEvent.click(screen.getByRole("button", { name: "Estimate" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Monthly consumption must be zero or more.");
    expect(screen.queryByText("Estimated bill for the month")).not.toBeInTheDocument();
  });

  it("hides a result when the plan changes, so a figure is never shown against the wrong tariff", async () => {
    vi.stubGlobal("fetch", fakeApi([billRoute()]).fetch);
    const { rerender } = render(<BillEstimator plan={PLAN} />);
    await userEvent.type(screen.getByLabelText(/Energy used in a month/), "300");
    await userEvent.click(screen.getByRole("button", { name: "Estimate" }));
    expect(await screen.findByText("2884.38")).toBeInTheDocument();
    rerender(<BillEstimator plan={tariffPlan({ id: "44444444-4444-4444-8444-444444444444", name: "Another plan" })} />);
    expect(screen.queryByText("2884.38")).not.toBeInTheDocument();
    expect(screen.getByText(/Using Another plan/)).toBeInTheDocument();
  });

  it("rejects text and negative numbers before calling the API", async () => {
    const api = fakeApi([billRoute()]);
    vi.stubGlobal("fetch", api.fetch);
    render(<BillEstimator plan={PLAN} />);
    const input = screen.getByLabelText(/Energy used in a month/);
    await userEvent.type(input, "abc");
    expect(screen.getByRole("button", { name: "Estimate" })).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, "-4");
    expect(screen.getByRole("button", { name: "Estimate" })).toBeDisabled();
    expect(api.calls).toHaveLength(0);
  });
});
