import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROPERTY_ID, fakeApi, json, plan, planSummary, property } from "@/test/fixtures";
import { PlanView } from "./PlanView";

const auth = vi.hoisted(() => ({ user: { id: "u1", email: "me@example.com", role: "USER", displayName: null } as { id: string; email: string; role: string; displayName: string | null } | null }));
vi.mock("../AuthProvider", () => ({ useAuth: () => ({ user: auth.user, loading: false, login: vi.fn(), register: vi.fn(), logout: vi.fn() }) }));

const NO_TWIN = { error: { code: "NOT_FOUND", message: "No Energy Twin yet." } };
const NO_PLAN = { error: { code: "NOT_FOUND", message: "No plan has been made for this property yet." } };

function world(over: { latest?: Response | (() => Response); post?: (body: unknown) => Response; plans?: unknown[] } = {}) {
  const api = fakeApi([
    ["GET", `/api/properties/${PROPERTY_ID}`, () => json(property())],
    ["GET", `/api/properties/${PROPERTY_ID}/twin`, () => json(NO_TWIN, 404)],
    ["GET", `/api/properties/${PROPERTY_ID}/plan`, () => (typeof over.latest === "function" ? over.latest() : (over.latest ?? json(NO_PLAN, 404)).clone())],
    ["GET", `/api/properties/${PROPERTY_ID}/plans`, () => json({ plans: over.plans ?? [] })],
    ["GET", /\/plans\/[0-9a-f-]{36}$/, () => json(plan({ id: "66666666-6666-4666-8666-666666666666", mode: "GREEN" }))],
    ["POST", `/api/properties/${PROPERTY_ID}/plan`, ({ body }) => (over.post ? over.post(body) : json(plan(), 201))],
  ]);
  vi.stubGlobal("fetch", api.fetch);
  return api;
}

beforeEach(() => {
  auth.user = { id: "u1", email: "me@example.com", role: "USER", displayName: null };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PlanView", () => {
  it("explains what a plan is, and what it needs, when none has been made", async () => {
    world();
    render(<PlanView id={PROPERTY_ID} />);
    expect(await screen.findByText(/No plan yet\. A plan chooses when to charge/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make a plan" })).toBeEnabled();
    expect(screen.queryByRole("region", { name: "Plan outcome" })).not.toBeInTheDocument();
  });

  it("shows the latest plan: cost with and without it, the saving, what it is labelled, and the charts", async () => {
    world({ latest: json(plan()) });
    render(<PlanView id={PROPERTY_ID} />);
    const outcome = await screen.findByRole("region", { name: "Plan outcome" });
    expect(within(outcome).getByText("₹41.20")).toBeInTheDocument();
    expect(within(outcome).getByText("₹52.90")).toBeInTheDocument();
    expect(within(outcome).getByText("₹11.70")).toBeInTheDocument();
    expect(within(outcome).getByText("SIMULATED")).toBeInTheDocument();
    expect(within(outcome).getByText(/outcomes the plan expects from forecasts: the real day will differ/)).toBeInTheDocument();
    expect(within(outcome).getByText("21.5 kWh")).toBeInTheDocument();
    expect(within(outcome).getByText("100%")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Where the power comes from, in kW/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Battery charge, in kWh/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Price per kWh/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Plan" })).toHaveAttribute("aria-current", "page");
  });

  it("lists what it does with the reason for each, ten at first, the washer's time, and every assumption", async () => {
    world({ latest: json(plan()) });
    render(<PlanView id={PROPERTY_ID} />);
    const does = await screen.findByRole("region", { name: "What the plan does" });
    expect(within(does).getByText(/Washer/)).toBeInTheDocument();
    expect(within(does).getAllByRole("listitem").filter((li) => li.closest("ol"))).toHaveLength(10);
    expect(within(does).getAllByText("Charge the battery").length).toBeGreaterThan(0);
    expect(within(does).getAllByText(/avoids buying later at INR 10/).length).toBeGreaterThan(0);
    await userEvent.click(within(does).getByRole("button", { name: "Show all 12" }));
    expect(within(does).getAllByRole("listitem").filter((li) => li.closest("ol"))).toHaveLength(12);
    await userEvent.click(within(does).getByRole("button", { name: "Show fewer" }));
    expect(within(does).getAllByRole("listitem").filter((li) => li.closest("ol"))).toHaveLength(10);

    const based = screen.getByRole("region", { name: "What the plan is based on" });
    expect(within(based).getByText("2 assumptions the plan makes")).toBeInTheDocument();
    expect(within(based).getByText(/battery's charge now is not known/)).toBeInTheDocument();
    expect(within(based).getByText(/export credit ₹3 per kWh \(entered by you\)/)).toBeInTheDocument();
  });

  it("says plainly when the plan found nothing to change", async () => {
    world({ latest: json(plan({ decisions: [], appliances: [] })) });
    render(<PlanView id={PROPERTY_ID} />);
    expect(await screen.findByText(/Nothing to change: with this tariff and equipment the plan matches the day/)).toBeInTheDocument();
  });

  it("warns when part of the load or the car's charge could not be met", async () => {
    const p = plan();
    p.result.value!.unservedKwh = 1.5;
    p.result.value!.evShortfallKwh = 4;
    world({ latest: json(p) });
    render(<PlanView id={PROPERTY_ID} />);
    expect(await screen.findByText(/1\.5 kWh of load cannot be supplied/)).toBeInTheDocument();
    expect(screen.getByText(/falls 4 kWh short of its target/)).toBeInTheDocument();
  });

  it("makes a plan in the chosen mode, with the charge entered, and shows it", async () => {
    let sent: unknown;
    world({ post: (b) => ((sent = b), json(plan({ mode: "SAVE_MONEY" }), 201)) });
    render(<PlanView id={PROPERTY_ID} />);
    await screen.findByText(/No plan yet/);
    await userEvent.selectOptions(screen.getByLabelText("What to favour"), "SAVE_MONEY");
    await userEvent.selectOptions(screen.getByLabelText("How far ahead"), "48");
    await userEvent.type(screen.getByLabelText(/Battery charge now/), "80");
    expect(screen.getByText(/lowest possible bill, whatever else/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Make a plan" }));
    expect(await screen.findByRole("region", { name: "Plan outcome" })).toBeInTheDocument();
    expect(sent).toEqual({ mode: "SAVE_MONEY", hours: 48, startSocPercent: 80 });
    expect(screen.getByRole("button", { name: "Make a new plan" })).toBeInTheDocument();
  });

  it("sends no battery charge when none is given", async () => {
    let sent: unknown;
    world({ post: (b) => ((sent = b), json(plan(), 201)) });
    render(<PlanView id={PROPERTY_ID} />);
    await screen.findByText(/No plan yet/);
    await userEvent.click(screen.getByRole("button", { name: "Make a plan" }));
    await screen.findByRole("region", { name: "Plan outcome" });
    expect(sent).toEqual({ mode: "BALANCED", hours: 24, startSocPercent: null });
  });

  it("does not call the server for a battery charge that cannot be right", async () => {
    const api = world();
    render(<PlanView id={PROPERTY_ID} />);
    await screen.findByText(/No plan yet/);
    await userEvent.type(screen.getByLabelText(/Battery charge now/), "140");
    await userEvent.click(screen.getByRole("button", { name: "Make a plan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("between 0 and 100 percent");
    expect(api.called("POST", `/api/properties/${PROPERTY_ID}/plan`)).toHaveLength(0);
  });

  it("names what is missing, with a link to each, when the server cannot make a plan yet", async () => {
    world({
      post: () =>
        json({ error: { code: "PLAN_INPUTS_MISSING", message: "A plan cannot be made yet: Choose the tariff you pay. Import at least a week of meter readings.", details: { missing: [{ what: "tariff", why: "Choose the tariff you pay." }, { what: "load", why: "Import meter readings." }] } } }, 422),
    });
    render(<PlanView id={PROPERTY_ID} />);
    await screen.findByText(/No plan yet/);
    await userEvent.click(screen.getByRole("button", { name: "Make a plan" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("A plan cannot be made yet");
    expect(within(alert).getByRole("link", { name: "Choose a tariff" })).toHaveAttribute("href", `/property/${PROPERTY_ID}/tariff`);
    expect(within(alert).getByRole("link", { name: "Import meter data" })).toHaveAttribute("href", `/property/${PROPERTY_ID}/meter-data`);
    expect(screen.queryByRole("region", { name: "Plan outcome" })).not.toBeInTheDocument();
  });

  it("shows a plan that failed its own check as a failure with the problems, never as a plan", async () => {
    world({ post: () => json({ error: { code: "PLAN_INVALID", message: "SIMULATION INVALID: the plan failed the planner's independent check, so it is not shown as a plan.", details: { problems: ["energy balance broken in step 4"] } } }, 502) });
    render(<PlanView id={PROPERTY_ID} />);
    await screen.findByText(/No plan yet/);
    await userEvent.click(screen.getByRole("button", { name: "Make a plan" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("SIMULATION INVALID");
    expect(alert).toHaveTextContent("energy balance broken in step 4");
    expect(screen.queryByRole("region", { name: "Plan outcome" })).not.toBeInTheDocument();
  });

  it("keeps the earlier plan on screen when a new one fails", async () => {
    world({ latest: json(plan()), post: () => json({ error: { code: "ENGINE_UNAVAILABLE", message: "The planning engine is not answering, so plans and model forecasts are unavailable right now." } }, 503) });
    render(<PlanView id={PROPERTY_ID} />);
    await screen.findByRole("region", { name: "Plan outcome" });
    await userEvent.click(screen.getByRole("button", { name: "Make a new plan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("planning engine is not answering");
    expect(screen.getByRole("region", { name: "Plan outcome" })).toBeInTheDocument();
  });

  it("lists earlier plans and opens one", async () => {
    world({ latest: json(plan()), plans: [planSummary(), planSummary({ id: "66666666-6666-4666-8666-666666666666", mode: "GREEN", savingsInr: 3.2 })] });
    render(<PlanView id={PROPERTY_ID} />);
    const hist = await screen.findByRole("region", { name: "Earlier plans" });
    expect(within(hist).getAllByRole("listitem")).toHaveLength(2);
    expect(within(hist).getByText("Showing")).toBeInTheDocument();
    await userEvent.click(within(hist).getAllByRole("button", { name: /Open the plan made/ })[1]!);
    await waitFor(() => expect(screen.getByRole("heading", { name: /Green plan for the 24 hours/ })).toBeInTheDocument());
  });

  it("asks you to sign in when you are not", async () => {
    auth.user = null;
    world();
    render(<PlanView id={PROPERTY_ID} />);
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/login?next=/property/${PROPERTY_ID}/plan`);
  });
});
