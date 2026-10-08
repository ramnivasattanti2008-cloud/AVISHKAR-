import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi, json, property } from "@/test/fixtures";
import { HomeProperties } from "./HomeProperties";

type U = { id: string; email: string; role: string; displayName: string | null } | null;
const auth = vi.hoisted(() => ({ user: null as U }));
vi.mock("./AuthProvider", () => ({ useAuth: () => ({ user: auth.user, loading: false, login: vi.fn(), register: vi.fn(), logout: vi.fn() }) }));

function world(properties: ReturnType<typeof property>[]) {
  const api = fakeApi([["GET", "/api/properties", () => json({ properties })]]);
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

describe("HomeProperties", () => {
  it("links each of your properties to its Today, and marks a demo one", async () => {
    world([property({ name: "My home" }), property({ id: "d0000001-0000-4000-8000-000000000000", name: "Demo shop", isDemo: true })]);
    render(<HomeProperties />);
    const list = await screen.findByRole("list");
    expect(within(list).getByRole("link", { name: /My home/ })).toHaveAttribute("href", "/property/22222222-2222-4222-8222-222222222222/today");
    expect(within(list).getByRole("link", { name: /Demo shops*DEMO/ })).toHaveAttribute("href", "/property/d0000001-0000-4000-8000-000000000000/today");
  });

  it("shows a visitor nothing, and asks the server nothing", () => {
    auth.user = null;
    const api = world([property()]);
    const { container } = render(<HomeProperties />);
    expect(container).toBeEmptyDOMElement();
    expect(api.calls).toHaveLength(0);
  });

  it("shows nothing, rather than an empty heading, when you have no properties", async () => {
    const api = world([]);
    const { container } = render(<HomeProperties />);
    await vi.waitFor(() => expect(api.calls).toHaveLength(1));
    expect(container).toBeEmptyDOMElement();
  });

  it("offers the rest when there are more than six", async () => {
    world(Array.from({ length: 8 }, (_, i) => property({ id: `a000000${i}-0000-4000-8000-000000000000`, name: `P${i}` })));
    render(<HomeProperties />);
    expect(await screen.findAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByRole("link", { name: "All 8 properties" })).toHaveAttribute("href", "/properties");
  });
});
