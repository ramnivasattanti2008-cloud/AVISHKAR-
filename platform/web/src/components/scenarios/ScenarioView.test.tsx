import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROPERTY_ID, fakeApi, json, opportunities, property, scenario, scenarioSummary, tariffPlan } from "@/test/fixtures";
import { ScenarioView } from "./ScenarioView";

const auth = vi.hoisted(() => ({ user: { id: "u1", email: "me@example.com", role: "USER", displayName: null } as { id: string; email: string; role: string; displayName: string | null } | null }));
vi.mock("../AuthProvider", () => ({ useAuth: () => ({ user: auth.user, loading: false, login: vi.fn(), register: vi.fn(), logout: vi.fn() }) }));

const NO_TWIN = { error: { code: "NOT_FOUND", message: "No Energy Twin yet." } };

function world(over: { post?: (body: unknown) => Response; history?: unknown[]; opps?: () => Response } = {}) {
  const api = fakeApi([
    ["GET", `/api/properties/${PROPERTY_ID}`, () => json(property())],
    ["GET", `/api/properties/${PROPERTY_ID}/twin`, () => json(NO_TWIN, 404)],
    ["GET", "/api/tariffs", () => json({ tariffs: [tariffPlan({ id: "55555555-5555-4555-8555-555555555555", name: "Flat 7", state: null })] })],
    ["GET", `/api/properties/${PROPERTY_ID}/scenarios`, () => json({ scenarios: over.history ?? [] })],
    ["GET", /\/scenarios\/[0-9a-f-]{36}$/, () => json(scenario({ id: "99999999-9999-4999-8999-999999999999", name: "An older one" }))],
    ["DELETE", /\/scenarios\/[0-9a-f-]{36}$/, () => new Response(null, { status: 204 })],
    ["POST", `/api/properties/${PROPERTY_ID}/opportunities`, () => (over.opps ? over.opps() : json(opportunities()))],
    ["POST", `/api/properties/${PROPERTY_ID}/scenarios`, ({ body }) => (over.post ? over.post(body) : json(scenario(), 201))],
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

const form = () => screen.getByRole("form", { name: "Describe the change" });
const type = async (label: RegExp | string, value: string) => userEvent.type(within(form()).getByLabelText(label), value);

describe("ScenarioView", () => {
  it("asks for a change before it calls the server, and for numbers where numbers belong", async () => {
    const api = world();
    render(<ScenarioView id={PROPERTY_ID} />);
    await screen.findByRole("form", { name: "Describe the change" });
    await userEvent.click(screen.getByRole("button", { name: "Estimate a year" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Change something: add solar, add a battery, or choose another tariff.");
    await type(/Capacity to add, kWp/, "five");
    await userEvent.click(screen.getByRole("button", { name: "Estimate a year" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The solar capacity must be a number.");
    expect(api.called("POST", `/api/properties/${PROPERTY_ID}/scenarios`)).toHaveLength(0);
  });

  it("sends only what was filled in, and shows the saving, the money and the subsidy as separate things", async () => {
    let sent: unknown;
    world({ post: (b) => ((sent = b), json(scenario(), 201)) });
    render(<ScenarioView id={PROPERTY_ID} />);
    await screen.findByRole("form", { name: "Describe the change" });
    await type(/Capacity to add, kWp/, "5");
    await type(/Solar, ₹ per kWp/, "50000");
    await userEvent.click(screen.getByRole("button", { name: "Estimate a year" }));

    const diff = await screen.findByRole("region", { name: "Estimated difference over a year" });
    expect(sent).toEqual({ addSolarKwp: 5, costs: { solarInrPerKwp: 50000 } });
    expect(within(diff).getByTestId("headline")).toHaveTextContent("This would save about ₹33,270 a year (57.7% of the planned bill).");
    expect(within(diff).getByText("ESTIMATED")).toBeInTheDocument();
    expect(within(diff).getByText("₹57,670")).toBeInTheDocument();
    expect(within(diff).getByText("₹24,400")).toBeInTheDocument();
    expect(within(diff).getByRole("img", { name: /Monthly electricity cost in rupees, today against the changed setup/ })).toBeInTheDocument();

    const money = screen.getByRole("region", { name: "The money" });
    expect(within(money).getByText("₹2,50,000")).toBeInTheDocument();
    expect(within(money).getByText("your quote, not netted against any subsidy")).toBeInTheDocument();
    expect(within(money).getByText("7.5 years")).toBeInTheDocument();
    expect(within(money).getByText("13.4% a year")).toBeInTheDocument();
    expect(within(money).getByRole("img", { name: /Cumulative position over 20 years/ })).toBeInTheDocument();
    const sub = within(money).getByText(/If you qualify/).closest("p")!;
    expect(sub).toHaveTextContent("₹78,000");
    expect(sub).toHaveTextContent("pay for itself in 5.2 years");
    expect(sub).toHaveTextContent("not a confirmed entitlement");
    expect(within(money).getByTestId("carbon")).toHaveTextContent("No grid emission factor is built in");

    const assumes = screen.getByRole("region", { name: "What the estimate assumes" });
    expect(within(assumes).getAllByRole("listitem")).toHaveLength(2);
  });

  it("will not invent a payback: without a quote it says what is missing and shows no money figures or chart", async () => {
    const s = scenario({ request: { addSolarKwp: 5 } });
    s.investment = { value: null, unit: "INR", provenance: { ...s.investment.provenance, status: "UNAVAILABLE", notes: ["Give the price of solar per kWp from a quote: AVISHKAR has no price list, so it will not guess what the equipment costs."] } };
    s.economics = { value: null, provenance: { ...s.economics.provenance, status: "UNAVAILABLE", notes: [] } };
    s.economicsIfSubsidised = null;
    world({ post: () => json(s, 201) });
    render(<ScenarioView id={PROPERTY_ID} />);
    await screen.findByRole("form", { name: "Describe the change" });
    await type(/Capacity to add, kWp/, "5");
    await userEvent.click(screen.getByRole("button", { name: "Estimate a year" }));
    const money = await screen.findByRole("region", { name: "The money" });
    expect(within(money).getByRole("status")).toHaveTextContent("from a quote: AVISHKAR has no price list");
    expect(within(money).queryByText("Pays for itself in")).not.toBeInTheDocument();
    expect(within(money).queryByRole("img")).not.toBeInTheDocument();
    expect(within(money).getByText("UNAVAILABLE")).toBeInTheDocument();
    // the saving itself is still shown
    expect(screen.getByTestId("headline")).toHaveTextContent("₹33,270");
  });

  it("says plainly when the change costs more", async () => {
    const s = scenario();
    s.comparison.value = { annualSavingsInr: -730, savingsPercent: -1.3, importKwhChange: 0, exportKwhChange: 0, selfSufficiencyChange: null };
    world({ post: () => json(s, 201) });
    render(<ScenarioView id={PROPERTY_ID} />);
    await screen.findByRole("form", { name: "Describe the change" });
    await waitFor(() => expect(within(within(form()).getByLabelText("Tariff")).getAllByRole("option")).toHaveLength(2)); // the catalogue has loaded
    await userEvent.selectOptions(within(form()).getByLabelText("Tariff"), "55555555-5555-4555-8555-555555555555");
    await userEvent.click(screen.getByRole("button", { name: "Estimate a year" }));
    expect(await screen.findByTestId("headline")).toHaveTextContent("This would cost about ₹730 more a year.");
  });

  it("shows carbon only as the figure computed from the factor that was given", async () => {
    const s = scenario();
    s.carbon = { value: { avoidedKgPerYear: 3520 }, provenance: { ...s.carbon.provenance, status: "ESTIMATED", notes: [] } };
    world({ post: () => json(s, 201) });
    render(<ScenarioView id={PROPERTY_ID} />);
    await screen.findByRole("form", { name: "Describe the change" });
    await type(/Capacity to add, kWp/, "5");
    await userEvent.click(screen.getByRole("button", { name: "Estimate a year" }));
    expect(await screen.findByTestId("carbon")).toHaveTextContent("3,520 kg of CO₂ a year avoided, at the emission factor you gave.");
  });

  it("names what is missing, with a link to each, and shows no result", async () => {
    world({ post: () => json({ error: { code: "PLAN_INPUTS_MISSING", message: "A yearly estimate cannot be made yet: Choose the tariff you pay. Import at least a week of meter readings.", details: { missing: [{ what: "tariff", why: "x" }, { what: "load", why: "y" }] } } }, 422) });
    render(<ScenarioView id={PROPERTY_ID} />);
    await screen.findByRole("form", { name: "Describe the change" });
    await type(/Capacity to add, kWp/, "5");
    await userEvent.click(screen.getByRole("button", { name: "Estimate a year" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("A yearly estimate cannot be made yet");
    expect(within(alert).getByRole("link", { name: "Choose a tariff" })).toHaveAttribute("href", `/property/${PROPERTY_ID}/tariff`);
    expect(within(alert).getByRole("link", { name: "Import meter data" })).toHaveAttribute("href", `/property/${PROPERTY_ID}/meter-data`);
    expect(screen.queryByRole("region", { name: "Estimated difference over a year" })).not.toBeInTheDocument();
  });

  it("lists earlier scenarios, opens one and deletes one", async () => {
    const api = world({ history: [scenarioSummary(), scenarioSummary({ id: "99999999-9999-4999-8999-999999999999", name: "An older one", annualSavingsInr: -120 })] });
    render(<ScenarioView id={PROPERTY_ID} />);
    const hist = await screen.findByRole("region", { name: "Earlier scenarios" });
    expect(within(hist).getAllByRole("listitem")).toHaveLength(2);
    expect(within(hist).getByText(/costs ₹120 a year/)).toBeInTheDocument();
    await userEvent.click(within(hist).getByRole("button", { name: "Open An older one" }));
    expect(await screen.findByRole("heading", { name: "An older one" })).toBeInTheDocument();
    await userEvent.click(within(hist).getByRole("button", { name: "Delete An older one" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "DELETE")).toBe(true));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Estimated difference over a year" })).not.toBeInTheDocument());
  });

  it("offers the other tariffs but not the one already in use", async () => {
    world();
    render(<ScenarioView id={PROPERTY_ID} />);
    await screen.findByRole("form", { name: "Describe the change" });
    const select = within(form()).getByLabelText("Tariff");
    await waitFor(() => expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Keep my current tariff", "Flat 7"]));
  });

  it("finds opportunities: money ones with the most they could cost, a data one with where to fix it, and what was tried and dropped", async () => {
    world();
    render(<ScenarioView id={PROPERTY_ID} />);
    await screen.findByRole("form", { name: "Describe the change" });
    await userEvent.click(screen.getByRole("button", { name: "Find opportunities" }));
    const list = await screen.findByRole("list", { name: "Opportunities" });
    const cards = within(list).getAllByRole("listitem");
    expect(cards).toHaveLength(3);
    expect(within(cards[0]!).getByText("Install a 10 kWh battery")).toBeInTheDocument();
    expect(within(cards[0]!).getByText("about ₹10,900 a year")).toBeInTheDocument();
    expect(within(cards[0]!).getByText(/Worth it if a quote is below/)).toHaveTextContent("₹10,300 per kWh (₹1,03,000 in all)");
    expect(within(cards[0]!).getByText("ESTIMATED")).toBeInTheDocument();
    expect(within(cards[2]!).getByRole("link", { name: "Go there" })).toHaveAttribute("href", `/property/${PROPERTY_ID}/assets`);
    expect(within(cards[2]!).queryByText(/a year/)).not.toBeInTheDocument(); // a data suggestion has no money figure
    const dropped = screen.getByText(/Also tried, and not worth listing \(2\)/);
    await userEvent.click(dropped);
    expect(screen.getByText("Switch to Flat 14: costs ₹4,200 a year more")).toBeInTheDocument();
    expect(screen.getByText("Add a 5 kWh battery: saves only ₹60 a year")).toBeInTheDocument();
    expect(screen.getByText(/a few example sizes, not a recommendation/)).toBeInTheDocument();
  });

  it("puts an opportunity's change into the form so the owner's own prices can be added", async () => {
    world();
    render(<ScenarioView id={PROPERTY_ID} />);
    await screen.findByRole("form", { name: "Describe the change" });
    await userEvent.click(screen.getByRole("button", { name: "Find opportunities" }));
    await userEvent.click(await screen.findByRole("button", { name: "Try this in the form: Install 3 kWp of solar" }));
    expect(within(form()).getByLabelText(/Capacity to add, kWp/)).toHaveValue("3");
    expect(within(form()).getByLabelText(/Capacity to add, kWh/)).toHaveValue("");
    await userEvent.click(await screen.findByRole("button", { name: "Try this in the form: Install a 10 kWh battery" }));
    expect(within(form()).getByLabelText(/Capacity to add, kWp/)).toHaveValue("");
    expect(within(form()).getByLabelText(/Capacity to add, kWh/)).toHaveValue("10");
  });

  it("says why when opportunities cannot be found", async () => {
    world({ opps: () => json({ error: { code: "ENGINE_UNAVAILABLE", message: "The planning engine is not answering, so plans and model forecasts are unavailable right now." } }, 503) });
    render(<ScenarioView id={PROPERTY_ID} />);
    await screen.findByRole("form", { name: "Describe the change" });
    await userEvent.click(screen.getByRole("button", { name: "Find opportunities" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("planning engine is not answering");
  });

  it("asks you to sign in when you are not", async () => {
    auth.user = null;
    world();
    render(<ScenarioView id={PROPERTY_ID} />);
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/login?next=/property/${PROPERTY_ID}/what-if`);
  });
});
