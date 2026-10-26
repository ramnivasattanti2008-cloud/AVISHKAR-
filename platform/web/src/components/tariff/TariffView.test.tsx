import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Property, TariffPlan, Twin } from "@/lib/types";
import { PROPERTY_ID, fakeApi, json, property, tariffPlan } from "@/test/fixtures";
import { TariffView } from "./TariffView";

const auth = vi.hoisted(() => ({ user: { id: "u1", email: "me@example.com", role: "USER", displayName: null } as { id: string; email: string; role: string; displayName: string | null } | null }));
vi.mock("../AuthProvider", () => ({ useAuth: () => ({ user: auth.user, loading: false, login: vi.fn(), register: vi.fn(), logout: vi.fn() }) }));

const CATALOGUE = tariffPlan();
const MINE = tariffPlan({ id: "55555555-5555-4555-8555-555555555555", origin: "USER", name: "My home bill", state: "KA", discom: "BESCOM", consumerType: "RESIDENTIAL", validity: { status: "WITHIN", message: "Valid to 2027-03-31." } });
const NO_TWIN = { error: { code: "NOT_FOUND", message: "No Energy Twin yet for this property. Run an analysis first." } };

interface World {
  property: Property;
  twin: unknown | null;
  plans: TariffPlan[];
}

function world(over: Partial<World> = {}) {
  const w: World = { property: property(), twin: null, plans: [CATALOGUE, MINE], ...over };
  const api = fakeApi([
    ["GET", `/api/properties/${PROPERTY_ID}`, () => json(w.property)],
    ["GET", `/api/properties/${PROPERTY_ID}/twin`, () => (w.twin ? json(w.twin) : json(NO_TWIN, 404))],
    ["GET", "/api/tariffs", () => json({ tariffs: w.plans })],
    ["GET", /^\/api\/tariffs\/[0-9a-f-]{36}$/, ({ url }) => {
      const p = w.plans.find((x) => url.pathname.endsWith(x.id));
      return p ? json(p) : json({ error: { code: "NOT_FOUND", message: "No such tariff." } }, 404);
    }],
    ["PUT", `/api/properties/${PROPERTY_ID}/tariff`, ({ body }) => {
      w.property = property({ tariffPlanId: (body as { tariffPlanId: string }).tariffPlanId });
      return json(w.property);
    }],
    ["DELETE", `/api/properties/${PROPERTY_ID}/tariff`, () => {
      w.property = property({ tariffPlanId: null });
      return json(w.property);
    }],
    ["DELETE", /^\/api\/tariffs\/[0-9a-f-]{36}$/, ({ url }) => {
      w.plans = w.plans.filter((p) => !url.pathname.endsWith(p.id));
      return new Response(null, { status: 204 });
    }],
    ["POST", `/api/properties/${PROPERTY_ID}/analyze`, () => json(w.twin ?? {})],
  ]);
  vi.stubGlobal("fetch", api.fetch);
  return { w, api };
}

const twinWith = (planId: string | null) =>
  ({
    id: "t1",
    propertyId: PROPERTY_ID,
    version: 1,
    tariff: { value: planId ? { planId } : null, provenance: {} },
    solar: { capacityKwEstimate: { value: 3.46, provenance: {} } },
  }) as unknown as Twin;

beforeEach(() => {
  auth.user = { id: "u1", email: "me@example.com", role: "USER", displayName: null };
});
afterEach(() => vi.unstubAllGlobals());

describe("TariffView", () => {
  it("says no tariff is assumed and lists the catalogue and the person's own plans", async () => {
    world();
    render(<TariffView id={PROPERTY_ID} />);
    expect(await screen.findByText("No tariff chosen yet")).toBeInTheDocument();
    expect(screen.getByText(/does not assume a tariff for you/)).toBeInTheDocument();
    expect(await screen.findByText("My home bill")).toBeInTheDocument();
    expect(screen.getByText("MSEDCL LT II 0-20 kW FY2025-26 (with ToD)")).toBeInTheDocument();
    expect(screen.getByText("CATALOGUE")).toBeInTheDocument();
    expect(screen.getByText("YOURS")).toBeInTheDocument();
    expect(screen.queryByText("Estimate a monthly bill")).not.toBeInTheDocument(); // nothing to price yet
  });

  it("chooses a plan for the property, shows it with its bill estimator, and says the twin needs a new analysis", async () => {
    const { api } = world();
    render(<TariffView id={PROPERTY_ID} />);
    const buttons = await screen.findAllByRole("button", { name: "Use for this property" });
    await userEvent.click(buttons[0]!);
    expect(await screen.findByText(/is now the tariff of this property. Analyze again to record it in the Energy Twin./)).toBeInTheDocument();
    expect(api.called("PUT", `/api/properties/${PROPERTY_ID}/tariff`)[0]!.body).toEqual({ tariffPlanId: CATALOGUE.id });
    expect(await screen.findByRole("heading", { name: "Tariff of this property" })).toBeInTheDocument();
    expect(await screen.findByText("Estimate a monthly bill")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chosen for this property" })).toBeDisabled();
  });

  it("removes the tariff from the property again", async () => {
    const { api } = world({ property: property({ tariffPlanId: CATALOGUE.id }) });
    render(<TariffView id={PROPERTY_ID} />);
    await userEvent.click(await screen.findByRole("button", { name: "Remove from this property" }));
    expect(await screen.findByText("The tariff was removed from this property.")).toBeInTheDocument();
    expect(api.called("DELETE", `/api/properties/${PROPERTY_ID}/tariff`)).toHaveLength(1);
    expect(await screen.findByText("No tariff chosen yet")).toBeInTheDocument();
  });

  it("tells the person when the Energy Twin was built with a different tariff, and re-analyzes on request", async () => {
    const { api, w } = world({ property: property({ tariffPlanId: CATALOGUE.id }), twin: twinWith(null) });
    render(<TariffView id={PROPERTY_ID} />);
    expect(await screen.findByText(/built with a different tariff \(or none\)/)).toBeInTheDocument();
    w.twin = twinWith(CATALOGUE.id);
    await userEvent.click(screen.getByRole("button", { name: "Analyze again" }));
    await waitFor(() => expect(api.called("POST", `/api/properties/${PROPERTY_ID}/analyze`)).toHaveLength(1));
    expect(await screen.findByText("A new Energy Twin version was built with this tariff.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/built with a different tariff/)).not.toBeInTheDocument());
  });

  it("does not nag when the twin already uses the chosen tariff", async () => {
    world({ property: property({ tariffPlanId: CATALOGUE.id }), twin: twinWith(CATALOGUE.id) });
    render(<TariffView id={PROPERTY_ID} />);
    await screen.findByRole("heading", { name: "Tariff of this property" });
    expect(screen.queryByText(/built with a different tariff/)).not.toBeInTheDocument();
  });

  it("offers the roof-area capacity estimate as the starting size for the subsidy rules", async () => {
    world({ twin: twinWith(null) });
    render(<TariffView id={PROPERTY_ID} />);
    expect(await screen.findByLabelText("System size (kWp)")).toHaveValue("3.5");
  });

  it("filters the catalogue by state through the API", async () => {
    const { api } = world();
    render(<TariffView id={PROPERTY_ID} />);
    await screen.findByText("My home bill");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "State" }), "MH");
    await waitFor(() => expect(api.calls.some((c) => c.path === "/api/tariffs" && c.search.includes("state=MH"))).toBe(true));
  });

  it("deletes one of the person's own plans, and only those", async () => {
    const { api } = world();
    render(<TariffView id={PROPERTY_ID} />);
    await screen.findByText("My home bill");
    const deletes = screen.getAllByRole("button", { name: "Delete" });
    expect(deletes).toHaveLength(1); // the catalogue plan has none
    await userEvent.click(deletes[0]!);
    expect(await screen.findByText("My home bill was deleted.")).toBeInTheDocument();
    expect(api.called("DELETE", `/api/tariffs/${MINE.id}`)).toHaveLength(1);
    await waitFor(() => expect(screen.queryByText("YOURS")).not.toBeInTheDocument());
  });

  it("asks a signed-out visitor to sign in", async () => {
    auth.user = null;
    world();
    render(<TariffView id={PROPERTY_ID} />);
    expect(await screen.findByText("Property not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/login?next=/property/${PROPERTY_ID}/tariff`);
  });

  it("says a property that is not the person's does not exist", async () => {
    vi.stubGlobal("fetch", fakeApi([["GET", `/api/properties/${PROPERTY_ID}`, () => json({ error: { code: "NOT_FOUND", message: "No such property." } }, 404)]]).fetch);
    render(<TariffView id={PROPERTY_ID} />);
    expect(await screen.findByText("Property not found")).toBeInTheDocument();
    expect(screen.getByText(/does not exist or is not yours/)).toBeInTheDocument();
  });
});
