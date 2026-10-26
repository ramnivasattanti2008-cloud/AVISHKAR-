import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROPERTY_ID, fakeApi, json, property } from "@/test/fixtures";
import { energyHealth, energyWaste } from "@/test/insight-fixtures";
import type { EnergyHealth, EnergyWaste } from "@/lib/types";
import { HealthView } from "./HealthView";

const auth = vi.hoisted(() => ({ user: { id: "u1", email: "me@example.com", role: "USER", displayName: null } as { id: string; email: string; role: string; displayName: string | null } | null }));
vi.mock("../AuthProvider", () => ({ useAuth: () => ({ user: auth.user, loading: false, login: vi.fn(), register: vi.fn(), logout: vi.fn() }) }));

const base = `/api/properties/${PROPERTY_ID}`;

function world(h: EnergyHealth = energyHealth(), w: EnergyWaste = energyWaste()) {
  const api = fakeApi([
    ["GET", base, () => json(property())],
    ["GET", `${base}/twin`, () => json({ error: { code: "NOT_FOUND", message: "none" } }, 404)],
    ["GET", `${base}/health`, () => json(h)],
    ["GET", `${base}/waste`, () => json(w)],
  ]);
  vi.stubGlobal("fetch", api.fetch);
}

beforeEach(() => {
  auth.user = { id: "u1", email: "me@example.com", role: "USER", displayName: null };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("HealthView", () => {
  it("shows each metric with its value, its label, which way is better and how it is worked out, and no overall score", async () => {
    world();
    render(<HealthView id={PROPERTY_ID} />);
    const items = await screen.findAllByRole("listitem", { name: /^(Efficiency|Solar utilisation|Peak management|Storage utilisation|Resilience|Grid dependence|Flexibility)$/ });
    expect(items.map((i) => i.getAttribute("aria-label"))).toEqual(["Efficiency", "Solar utilisation", "Peak management", "Storage utilisation", "Resilience", "Grid dependence", "Flexibility"]);
    const grid = within(items[5]!);
    expect(grid.getByText("44.3")).toBeInTheDocument();
    expect(grid.getByText("lower is better")).toBeInTheDocument();
    expect(grid.getByText("SIMULATED")).toBeInTheDocument();
    expect(grid.getByText("how it is worked out")).toBeInTheDocument();
    const res = within(items[4]!);
    expect(res.getByText("9.5")).toBeInTheDocument();
    expect(res.getByText("h")).toBeInTheDocument(); // hours, not a percentage
    expect(screen.getByText(/not added into one number/)).toBeInTheDocument();
    expect(screen.queryByText(/\/ 100/)).not.toBeInTheDocument();
  });

  it("prints no number for a metric that does not exist, and says why", async () => {
    world();
    render(<HealthView id={PROPERTY_ID} />);
    const storage = within(await screen.findByRole("listitem", { name: "Storage utilisation" }));
    expect(storage.getByText("UNAVAILABLE")).toBeInTheDocument();
    expect(storage.getByText("There is no battery in this plan.", { selector: "p" })).toBeInTheDocument();
    expect(storage.queryByText("%")).not.toBeInTheDocument();
  });

  it("says the figures describe a simulated day from a plan, and that a plan more than a day old is old", async () => {
    world(energyHealth({ basedOn: { planId: "p", madeAt: "2026-10-06T09:00:00.000Z", stale: true, note: "This plan is more than a day old: make a new one to see today." } }));
    render(<HealthView id={PROPERTY_ID} />);
    const note = await screen.findByRole("note");
    expect(note).toHaveTextContent("a simulated day on forecasts, not a measurement");
    expect(note).toHaveTextContent("more than a day old");
  });

  it("lists each waste finding with what was found, an honest 'cannot tell' where the data cannot say, and the avoidable cost where it exists", async () => {
    world();
    render(<HealthView id={PROPERTY_ID} />);
    const curtail = within(await screen.findByRole("listitem", { name: "Solar thrown away" }));
    expect(curtail.getByText("Found")).toBeInTheDocument();
    expect(curtail.getByText(/0\.8 kWh/, { selector: "p.num" })).toBeInTheDocument();
    expect(curtail.getByText(/₹2\.40/, { selector: "p.num" })).toBeInTheDocument();
    expect(within(screen.getByRole("listitem", { name: "Surplus sold to the grid" })).getByText("None found")).toBeInTheDocument();
    const battery = within(screen.getByRole("listitem", { name: "Battery opportunity lost" }));
    expect(battery.getByText("Cannot tell")).toBeInTheDocument();
    expect(battery.queryByText(/kWh/, { selector: "p.num" })).not.toBeInTheDocument(); // no figure where there is none
    const day = within(screen.getByRole("listitem", { name: "Avoidable cost, per day" }));
    expect(day.getByText("₹40.40")).toBeInTheDocument();
    const month = within(screen.getByRole("listitem", { name: "Potential avoidable cost in an average month" }));
    expect(month.getByText("UNAVAILABLE")).toBeInTheDocument();
    expect(month.getByText(/No what-if run has worked out a year/, { selector: "p" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Run a what-if" })).toHaveAttribute("href", `/property/${PROPERTY_ID}/what-if`);
  });

  it("says there is no plan, with a link to make one, and shows nothing else", async () => {
    const next = [{ label: "Make a plan", href: `/property/${PROPERTY_ID}/plan`, why: "none yet" }];
    world(energyHealth({ basedOn: null, metrics: [], next }), energyWaste({ basedOn: null, findings: [], next }));
    render(<HealthView id={PROPERTY_ID} />);
    expect(await screen.findByText(/There is no plan yet/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Make a plan" })[0]).toHaveAttribute("href", `/property/${PROPERTY_ID}/plan`);
    expect(screen.queryByRole("heading", { name: "Energy health" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Energy waste" })).not.toBeInTheDocument();
  });

  it("asks a visitor who is not signed in to sign in", async () => {
    auth.user = null;
    world();
    render(<HealthView id={PROPERTY_ID} />);
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/login?next=/property/${PROPERTY_ID}/health`);
  });
});
