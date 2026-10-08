import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROPERTY_ID, community, fakeApi, json, property, vppSimulation } from "@/test/fixtures";
import { CommunityView } from "./CommunityView";

const auth = vi.hoisted(() => ({ user: { id: "u1", email: "me@example.com", role: "USER", displayName: null } as { id: string; email: string; role: string; displayName: string | null } | null }));
vi.mock("../AuthProvider", () => ({ useAuth: () => ({ user: auth.user, loading: false, login: vi.fn(), register: vi.fn(), logout: vi.fn() }) }));

function world(over: { community?: ReturnType<typeof community>; vpp?: (body: unknown) => Response; properties?: unknown[] } = {}) {
  const api = fakeApi([
    ["GET", "/api/community", () => json(over.community ?? community())],
    ["GET", "/api/properties", () => json({ properties: over.properties ?? [property({ name: "Home" })] })],
    ["POST", "/api/vpp/simulate", ({ body }) => (over.vpp ? over.vpp(body) : json(vppSimulation()))],
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

describe("CommunityView: your properties together", () => {
  it("labels it a simulation, shows each property's day and what pooling would add, and says it moves no electricity", async () => {
    world();
    render(<CommunityView />);
    const sec = await screen.findByRole("region", { name: "Your properties together" });
    expect(await within(sec).findByText("COMMUNITY ENERGY SIMULATION")).toBeInTheDocument();
    expect(within(sec).getByText("SIMULATED")).toBeInTheDocument();
    const table = within(sec).getByRole("table", { name: "Your properties on a typical day" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(4); // the header and three properties
    expect(within(rows[1]!).getByText("Solar surplus")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Buys from the grid")).toBeInTheDocument();
    expect(within(rows[3]!).getByText("No readings")).toBeInTheDocument();
    expect(within(rows[3]!).getAllByText("—").length).toBeGreaterThan(3); // nothing is invented for a property without readings
    expect(within(sec).getByText(/Blank: No meter readings have been imported/)).toBeInTheDocument();
    expect(within(sec).getByText("6.3 kWh")).toBeInTheDocument();
    expect(within(sec).getByText(/a simulation, not a trade/)).toBeInTheDocument();
    expect(within(sec).getByRole("img", { name: /Your properties together, in kW/ })).toBeInTheDocument();
    expect(within(sec).getByText(/does not move electricity between properties/)).toBeInTheDocument();
    expect(screen.getByText(/Simulations only\. AVISHKAR does not move electricity between properties/)).toBeInTheDocument();
  });

  it("says there is nothing to add up, rather than showing zeros, when no property has readings", async () => {
    world({ community: community({ members: [community().members[2]!], totals: { value: null, provenance: community().totals.provenance } }) });
    render(<CommunityView />);
    expect(await screen.findByText(/No property has readings yet, so there is nothing to add up/)).toBeInTheDocument();
    expect(screen.queryByText("Together they use")).not.toBeInTheDocument();
  });

  it("sends a new account to the map when it has no properties", async () => {
    world({ community: community({ members: [], totals: { value: null, provenance: community().totals.provenance } }) });
    render(<CommunityView />);
    expect(await screen.findByRole("link", { name: "Add one on the map" })).toHaveAttribute("href", "/map");
  });

  it("asks you to sign in when you are not", async () => {
    auth.user = null;
    world();
    render(<CommunityView />);
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=/community");
  });
});

describe("CommunityView: the virtual power plant", () => {
  it("is labelled synthetic before anything is run, and offers the four fleet sizes", async () => {
    world();
    render(<CommunityView />);
    const form = await screen.findByRole("form", { name: "Simulate a virtual power plant" });
    expect(screen.getByText(/VIRTUAL POWER PLANT SIMULATION: every home is synthetic/)).toBeInTheDocument();
    const homes = within(form).getByLabelText("Homes");
    expect(within(homes).getAllByRole("option").map((o) => o.textContent)).toEqual(["10", "100", "1,000", "10,000"]);
  });

  it("simulates with the defaults, sending only the pattern and the size, and shows the peak, the bill and the assumptions", async () => {
    const api = world();
    render(<CommunityView />);
    await screen.findByRole("form", { name: "Simulate a virtual power plant" });
    await userEvent.click(screen.getByRole("button", { name: "Simulate" }));
    const res = await screen.findByRole("region", { name: "Simulation result" });
    expect(api.called("POST", "/api/vpp/simulate")[0]!.body).toEqual({ archetypePropertyId: PROPERTY_ID, homes: 100 });
    expect(within(res).getByText("SIMULATED")).toBeInTheDocument();
    expect(within(res).getByText("223.1 kW")).toBeInTheDocument();
    expect(within(res).getByText("was 262.4 kW at 18:00")).toBeInTheDocument();
    expect(within(res).getByText("15%")).toBeInTheDocument();
    expect(within(res).getByText("₹15,050")).toBeInTheDocument();
    expect(within(res).getByText("was ₹16,100; saves ₹1,050")).toBeInTheDocument();
    expect(within(res).getByText(/31 with solar \(93\.4 kWp in all\), 3 with a battery \(15\.2 kWh\), 4 with a vehicle/)).toBeInTheDocument();
    expect(within(res).getByRole("img", { name: /Power drawn from the grid, with and without coordination/ })).toBeInTheDocument();
    expect(within(res).getByText("2 assumptions")).toBeInTheDocument();
    expect(within(res).getByText(/Every home is synthetic/)).toBeInTheDocument();
  });

  it("sends the assumptions that were changed, as numbers, and the fleet size chosen", async () => {
    const api = world();
    render(<CommunityView />);
    const form = await screen.findByRole("form", { name: "Simulate a virtual power plant" });
    await userEvent.selectOptions(within(form).getByLabelText("Homes"), "10000");
    await userEvent.click(within(form).getByText("The assumptions behind the homes"));
    await userEvent.type(within(form).getByLabelText(/Homes with solar, %/), "60");
    await userEvent.type(within(form).getByLabelText(/Seed/), "42");
    await userEvent.click(screen.getByRole("button", { name: "Simulate" }));
    await screen.findByRole("region", { name: "Simulation result" });
    expect(api.called("POST", "/api/vpp/simulate")[0]!.body).toEqual({ archetypePropertyId: PROPERTY_ID, homes: 10000, pvSharePercent: 60, seed: 42 });
  });

  it("does not call the server for a value that is not a number", async () => {
    const api = world();
    render(<CommunityView />);
    const form = await screen.findByRole("form", { name: "Simulate a virtual power plant" });
    await userEvent.click(within(form).getByText("The assumptions behind the homes"));
    await userEvent.type(within(form).getByLabelText(/Mean solar size/), "big");
    await userEvent.click(screen.getByRole("button", { name: "Simulate" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The solar size must be a number.");
    expect(api.called("POST", "/api/vpp/simulate")).toHaveLength(0);
  });

  it("says what the pattern property lacks, with a link to fix it", async () => {
    world({ vpp: () => json({ error: { code: "PLAN_INPUTS_MISSING", message: "A simulation cannot be run yet: Choose a tariff.", details: { missing: [{ what: "tariff", why: "x" }] } } }, 422) });
    render(<CommunityView />);
    await screen.findByRole("form", { name: "Simulate a virtual power plant" });
    await userEvent.click(screen.getByRole("button", { name: "Simulate" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("A simulation cannot be run yet");
    expect(within(alert).getByRole("link", { name: "that property" })).toHaveAttribute("href", `/property/${PROPERTY_ID}/tariff`);
    expect(screen.queryByRole("region", { name: "Simulation result" })).not.toBeInTheDocument();
  });

  it("asks for a property first when there is none", async () => {
    world({ properties: [] });
    render(<CommunityView />);
    expect(await screen.findByText(/Save a property with a tariff and meter readings first/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Simulate" })).not.toBeInTheDocument();
  });
});
