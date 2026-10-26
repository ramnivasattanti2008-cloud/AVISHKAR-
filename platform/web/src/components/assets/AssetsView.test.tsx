import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Appliance, Battery } from "@/lib/types";
import { PROPERTY_ID, appliance, battery, fakeApi, json, property } from "@/test/fixtures";
import { AssetsView } from "./AssetsView";

const auth = vi.hoisted(() => ({ user: { id: "u1", email: "me@example.com", role: "USER", displayName: null } as { id: string; email: string; role: string; displayName: string | null } | null }));
vi.mock("../AuthProvider", () => ({ useAuth: () => ({ user: auth.user, loading: false, login: vi.fn(), register: vi.fn(), logout: vi.fn() }) }));

const base = `/api/properties/${PROPERTY_ID}`;
const NO_TWIN = { error: { code: "NOT_FOUND", message: "No Energy Twin yet." } };

function world(init: { batteries?: Battery[]; appliances?: Appliance[] } = {}) {
  const w = { batteries: init.batteries ?? [], appliances: init.appliances ?? [] };
  const api = fakeApi([
    ["GET", base, () => json(property())],
    ["GET", `${base}/twin`, () => json(NO_TWIN, 404)],
    ["GET", `${base}/batteries`, () => json({ batteries: w.batteries })],
    ["GET", `${base}/solar-systems`, () => json({ solarSystems: [] })],
    ["GET", `${base}/evs`, () => json({ evs: [] })],
    ["GET", `${base}/appliances`, () => json({ appliances: w.appliances })],
    ["POST", `${base}/batteries`, ({ body }) => {
      const b = battery({ id: "b2000000-0000-4000-8000-000000000002", name: (body as { name: string }).name });
      w.batteries = [...w.batteries, b];
      return json(b, 201);
    }],
    ["PATCH", /\/batteries\/[0-9a-f-]{36}$/, ({ body }) => {
      w.batteries = w.batteries.map((b) => ({ ...b, name: (body as { name: string }).name }));
      return json(w.batteries[0]);
    }],
    ["DELETE", /\/batteries\/[0-9a-f-]{36}$/, () => {
      w.batteries = [];
      return new Response(null, { status: 204 });
    }],
    ["DELETE", /\/appliances\/[0-9a-f-]{36}$/, () => {
      w.appliances = [];
      return new Response(null, { status: 204 });
    }],
  ]);
  vi.stubGlobal("fetch", api.fetch);
  return { api, w };
}

beforeEach(() => {
  auth.user = { id: "u1", email: "me@example.com", role: "USER", displayName: null };
});
afterEach(() => vi.unstubAllGlobals());

describe("AssetsView", () => {
  it("says what each empty kind means for the plan, rather than a bare 'none'", async () => {
    world();
    render(<AssetsView id={PROPERTY_ID} />);
    expect(await screen.findByText(/Without one the planner can only shift loads, not store solar/)).toBeInTheDocument();
    expect(screen.getByText(/Add an installed one to forecast its output, or a planned one to test/)).toBeInTheDocument();
    expect(screen.getByText(/charging can be placed in the cheapest or sunniest hours/)).toBeInTheDocument();
    expect(screen.getByText(/mark the critical ones \(fridge, medical equipment, router\)/)).toBeInTheDocument();
    expect(screen.getByText(/AVISHKAR does not check it against the equipment/)).toBeInTheDocument();
  });

  it("lists what exists, with defaults labelled", async () => {
    world({ batteries: [battery()], appliances: [appliance()] });
    render(<AssetsView id={PROPERTY_ID} />);
    const card = await screen.findByRole("article", { name: "Garage battery" });
    expect(within(card).getAllByText("DEFAULT").length).toBeGreaterThan(0);
    expect(await screen.findByRole("article", { name: "Kitchen fridge" })).toBeInTheDocument();
    expect(screen.queryByText(/Without one the planner can only shift loads/)).not.toBeInTheDocument();
  });

  it("adds a battery, shows it, and tells the person the Energy Twin needs a new analysis", async () => {
    const { api } = world();
    render(<AssetsView id={PROPERTY_ID} />);
    await userEvent.click(await screen.findByRole("button", { name: "Add a battery" }));
    await userEvent.type(screen.getByLabelText("Name"), "Wall battery");
    await userEvent.type(screen.getByLabelText(/Capacity, kWh/), "13.5");
    await userEvent.type(screen.getByLabelText(/Maximum charge power/), "5");
    await userEvent.type(screen.getByLabelText(/Maximum discharge power/), "5");
    await userEvent.click(screen.getByRole("button", { name: "Add battery" }));
    expect(await screen.findByRole("article", { name: "Wall battery" })).toBeInTheDocument();
    expect(screen.getByText(/Saved\. Analyze the property again to bring the Energy Twin up to date\./)).toBeInTheDocument();
    expect(api.called("POST", `${base}/batteries`)[0]!.body).toMatchObject({ name: "Wall battery", capacityKwh: 13.5 });
    expect(screen.queryByRole("form", { name: "Add a battery" })).not.toBeInTheDocument(); // the form closes
  });

  it("changes an asset through a prefilled form", async () => {
    const { api } = world({ batteries: [battery()] });
    render(<AssetsView id={PROPERTY_ID} />);
    await userEvent.click(await screen.findByRole("button", { name: "Change Garage battery" }));
    const name = screen.getByLabelText("Name");
    expect(name).toHaveValue("Garage battery");
    await userEvent.clear(name);
    await userEvent.type(name, "Renamed");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("article", { name: "Renamed" })).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "PATCH" && c.path.startsWith(`${base}/batteries/`))).toBe(true);
  });

  it("deletes an asset and says so", async () => {
    const { api } = world({ batteries: [battery()] });
    render(<AssetsView id={PROPERTY_ID} />);
    await userEvent.click(await screen.findByRole("button", { name: "Delete Garage battery" }));
    expect(await screen.findByText(/Garage battery was deleted/)).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "DELETE" && c.path.startsWith(`${base}/batteries/`))).toBe(true);
    await waitFor(() => expect(screen.queryByRole("article", { name: "Garage battery" })).not.toBeInTheDocument());
  });

  it("cancels an open form without saving", async () => {
    const { api } = world();
    render(<AssetsView id={PROPERTY_ID} />);
    await userEvent.click(await screen.findByRole("button", { name: "Add a battery" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form", { name: "Add a battery" })).not.toBeInTheDocument();
    expect(api.called("POST", `${base}/batteries`)).toHaveLength(0);
  });

  it("asks a signed-out visitor to sign in, and says a property that is not theirs does not exist", async () => {
    auth.user = null;
    world();
    const { unmount } = render(<AssetsView id={PROPERTY_ID} />);
    expect(await screen.findByText("Property not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/login?next=/property/${PROPERTY_ID}/assets`);
    unmount();
    auth.user = { id: "u1", email: "me@example.com", role: "USER", displayName: null };
    vi.stubGlobal("fetch", fakeApi([["GET", base, () => json({ error: { code: "NOT_FOUND", message: "No such property." } }, 404)]]).fetch);
    render(<AssetsView id={PROPERTY_ID} />);
    expect(await screen.findByText(/does not exist or is not yours/)).toBeInTheDocument();
  });
});
