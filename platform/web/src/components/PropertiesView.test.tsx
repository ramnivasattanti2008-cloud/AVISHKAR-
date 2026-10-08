import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoWorld, fakeApi, json, property } from "@/test/fixtures";
import type { DemoWorld } from "@/lib/types";
import { PropertyTabs } from "./property/PropertyTabs";
import { PropertiesView } from "./PropertiesView";

const auth = vi.hoisted(() => ({ user: { id: "u1", email: "me@example.com", role: "USER", displayName: null } as { id: string; email: string; role: string; displayName: string | null } | null }));
vi.mock("./AuthProvider", () => ({ useAuth: () => ({ user: auth.user, loading: false, login: vi.fn(), register: vi.fn(), logout: vi.fn() }) }));

const loadedWorld = (): DemoWorld =>
  demoWorld({
    loaded: true,
    sites: demoWorld().sites.map((s, i) => ({ ...s, propertyId: `d000000${i}-0000-4000-8000-000000000000`, tariff: i === 0 ? "DEMO time-of-day tariff (invented)" : "Catalogue plan" })),
  });
const demoProperty = (i: number, name: string) => property({ id: `d000000${i}-0000-4000-8000-000000000000`, name, isDemo: true, address: "Pune (demo property)" });

function world(state: { properties: ReturnType<typeof property>[]; demo: DemoWorld }) {
  const api = fakeApi([
    ["GET", "/api/properties", () => json({ properties: state.properties })],
    ["GET", "/api/demo/world", () => json(state.demo)],
    [
      "POST",
      "/api/demo/world",
      () => {
        state.demo = loadedWorld();
        state.properties = [demoProperty(0, "Demo home, Bengaluru"), demoProperty(1, "Demo shop, Pune")];
        return json({ created: 4, world: state.demo });
      },
    ],
    [
      "DELETE",
      "/api/demo/world",
      () => {
        state.demo = demoWorld();
        state.properties = state.properties.filter((p) => !p.isDemo);
        return json({ removed: 4 });
      },
    ],
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

describe("PropertiesView and the demo world", () => {
  it("lists your own properties apart from the demo ones, and marks the demo ones DEMO", async () => {
    world({ properties: [property({ name: "My home" }), demoProperty(1, "Demo shop, Pune")], demo: loadedWorld() });
    render(<PropertiesView />);
    const own = await screen.findByRole("list", { name: "Your own properties" });
    expect(within(own).getByText("My home")).toBeInTheDocument();
    expect(within(own).queryByText("DEMO")).not.toBeInTheDocument();
    const demo = screen.getByRole("list", { name: "Demo properties" });
    expect(within(demo).getByText("Demo shop, Pune")).toBeInTheDocument();
    expect(within(demo).getByText("DEMO")).toBeInTheDocument();
    expect(within(demo).getByRole("link", { name: /Demo shop, Pune/ })).toHaveAttribute("href", "/property/d0000001-0000-4000-8000-000000000000");
    expect(screen.getByText(/nothing here is added up with them/)).toBeInTheDocument();
  });

  it("offers the demo world to an account with no properties, in four stories, before anything is loaded", async () => {
    world({ properties: [], demo: demoWorld() });
    render(<PropertiesView />);
    expect(await screen.findByText(/No properties of your own yet/)).toHaveTextContent("or try the demo world below");
    const panel = screen.getByRole("region", { name: /Demo world/ });
    expect(within(panel).getByText("DEMO DATA")).toBeInTheDocument();
    expect(within(panel).getAllByText("Not loaded.")).toHaveLength(4);
    expect(within(panel).getByText("Demo clinic, Jaipur story.")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Add the demo properties" })).toBeEnabled();
    expect(within(panel).queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
  });

  it("adds the demo world and shows the properties it made, then says what was added", async () => {
    const api = world({ properties: [], demo: demoWorld() });
    render(<PropertiesView />);
    await userEvent.click(await screen.findByRole("button", { name: "Add the demo properties" }));
    expect(await screen.findByRole("status")).toHaveTextContent("4 demo properties were added");
    expect(api.called("POST", "/api/demo/world")).toHaveLength(1);
    expect(await screen.findByRole("list", { name: "Demo properties" })).toBeInTheDocument();
    expect(screen.getAllByText("In your account", { exact: false }).length).toBe(4);
    expect(screen.queryByRole("button", { name: "Add the demo properties" })).not.toBeInTheDocument();
  });

  it("asks before removing, and says your own properties were not touched", async () => {
    const api = world({ properties: [property({ name: "My home" }), demoProperty(1, "Demo shop, Pune")], demo: loadedWorld() });
    render(<PropertiesView />);
    await userEvent.click(await screen.findByRole("button", { name: "Remove the demo properties" }));
    expect(api.called("DELETE", "/api/demo/world")).toHaveLength(0); // nothing is deleted by the first click
    expect(screen.getByText("This deletes the demo properties and everything computed from them.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Keep them" }));
    expect(screen.queryByText("This deletes the demo properties and everything computed from them.")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove the demo properties" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, remove them" }));
    expect(await screen.findByRole("status")).toHaveTextContent("4 demo properties were removed, with everything computed from them. Your own properties were not touched.");
    expect(api.called("DELETE", "/api/demo/world")).toHaveLength(1);
    expect(screen.queryByRole("list", { name: "Demo properties" })).not.toBeInTheDocument();
    expect(screen.getByText("My home")).toBeInTheDocument();
  });

  it("asks you to sign in when you are not", async () => {
    auth.user = null;
    world({ properties: [], demo: demoWorld() });
    render(<PropertiesView />);
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=/properties");
  });
});

describe("PropertyTabs", () => {
  it("carries the DEMO DATA banner on a demo property and nothing extra on a real one", () => {
    const { rerender } = render(<PropertyTabs id="x" current="/plan" demo />);
    expect(screen.getByRole("note")).toHaveTextContent("DEMO DATA. An invented property in a real place");
    expect(screen.getByRole("link", { name: "Plan" })).toHaveAttribute("aria-current", "page");
    rerender(<PropertyTabs id="x" current="/plan" />);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});
