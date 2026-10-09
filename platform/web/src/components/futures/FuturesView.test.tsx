import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROPERTY_ID, fakeApi, json, property } from "@/test/fixtures";
import { energyFutures } from "@/test/futures-fixtures";
import type { EnergyFutures } from "@/lib/types";
import { FuturesView } from "./FuturesView";

const auth = vi.hoisted(() => ({ user: { id: "u1", email: "me@example.com", role: "USER", displayName: null } as { id: string; email: string; role: string; displayName: string | null } | null }));
vi.mock("../AuthProvider", () => ({ useAuth: () => ({ user: auth.user, loading: false, login: vi.fn(), register: vi.fn(), logout: vi.fn() }) }));

const base = `/api/properties/${PROPERTY_ID}`;

function world(f: EnergyFutures | Response = energyFutures()) {
  const api = fakeApi([
    ["GET", base, () => json(property())],
    ["GET", `${base}/twin`, () => json({ error: { code: "NOT_FOUND", message: "none" } }, 404)],
    ["POST", `${base}/futures`, () => (f instanceof Response ? f : json(f))],
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

describe("FuturesView", () => {
  it("says the days are not predictions, and runs nothing until asked", async () => {
    const api = world();
    render(<FuturesView id={PROPERTY_ID} />);
    expect(await screen.findByText(/These are not\s+predictions and they carry no probability/, { exact: false })).toBeInTheDocument();
    expect(api.called("POST", `${base}/futures`)).toHaveLength(0);
    expect(screen.queryByRole("heading", { name: "What each day would cost" })).not.toBeInTheDocument();
  });

  it("sends what was set, runs the days, and shows each with what it is built from and what it cost", async () => {
    const user = userEvent.setup();
    const api = world();
    render(<FuturesView id={PROPERTY_ID} />);
    await user.clear(await screen.findByLabelText(/On a rainy day the sun gives/));
    await user.type(screen.getByLabelText(/On a rainy day the sun gives/), "35");
    await user.click(screen.getByRole("button", { name: "Run the futures" }));
    expect(await screen.findByRole("heading", { name: "What each day would cost" })).toBeInTheDocument();
    expect(api.called("POST", `${base}/futures`)[0]?.body).toEqual({ rainSolarPercent: 35, outage: { startHour: 18, hours: 4 }, startSocPercent: null });

    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(6); // the header and five days
    const rain = within(rows[3]!); // after the header, the expected day and the sunny day
    expect(rain.getByText("Rain")).toBeInTheDocument();
    expect(rain.getByText("Your assumption")).toBeInTheDocument();
    expect(rain.getByText("SIMULATED")).toBeInTheDocument();
    expect(rain.getByText("₹58.40")).toBeInTheDocument();
    expect(rain.getByText("+₹17.20")).toBeInTheDocument(); // dearer than the expected day
    expect(within(rows[1]!).getByText("The day expected")).toBeInTheDocument();
  });

  it("does not call an outage day cheaper: it shows no difference, and shows what was switched off and any critical load unserved", async () => {
    const user = userEvent.setup();
    world();
    render(<FuturesView id={PROPERTY_ID} />);
    await user.click(await screen.findByRole("button", { name: "Run the futures" }));
    const outage = within((await screen.findAllByRole("row")).find((r) => within(r).queryByText("Grid outage"))!);
    expect(outage.getByText("6 kWh")).toBeInTheDocument();
    expect(outage.getByText(/critical load unserved: 0\.4 kWh with the plan, 0 kWh with no control/)).toBeInTheDocument();
    expect(outage.queryByText(/^[+−]₹/)).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Switched off" })).toBeInTheDocument();
  });

  it("says a day is the same as the expected day when its band has no width, instead of presenting it as a finding", async () => {
    const user = userEvent.setup();
    const f = energyFutures();
    f.futures = f.futures.map((x) => (x.key === "batteryOffline" ? { ...x, sameAsExpected: true } : x));
    world(f);
    render(<FuturesView id={PROPERTY_ID} />);
    await user.click(await screen.findByRole("button", { name: "Run the futures" }));
    const row = within((await screen.findAllByRole("row")).find((r) => within(r).queryByText("Battery offline"))!);
    expect(row.getByText(/The same as the expected day, to the last digit: the band has no width here/)).toBeInTheDocument();
    const other = within((await screen.findAllByRole("row")).find((r) => within(r).queryByText("Rain"))!);
    expect(other.queryByText(/to the last digit/)).not.toBeInTheDocument();
  });

  it("gives the day that cannot be run its reason, and no number", async () => {
    const user = userEvent.setup();
    world();
    render(<FuturesView id={PROPERTY_ID} />);
    await user.click(await screen.findByRole("button", { name: "Run the futures" }));
    const sunny = within((await screen.findAllByRole("row")).find((r) => within(r).queryByText("Sunny"))!);
    expect(sunny.getByText("Cannot be run")).toBeInTheDocument();
    expect(sunny.getByText(/no calibrated band for this place yet/, { selector: "td" })).toBeInTheDocument();
    expect(sunny.queryByText(/₹/)).not.toBeInTheDocument();
  });

  it("states the spread across the days without an outage, with the reason the outage days are left out", async () => {
    const user = userEvent.setup();
    world();
    render(<FuturesView id={PROPERTY_ID} />);
    await user.click(await screen.findByRole("button", { name: "Run the futures" }));
    const s = await screen.findByRole("status");
    expect(s).toHaveTextContent("from ₹41.20 (expected day) to ₹58.40 (rain)");
    expect(s).toHaveTextContent("lower because load is switched off");
  });

  it("refuses bad inputs without asking the server", async () => {
    const user = userEvent.setup();
    const api = world();
    render(<FuturesView id={PROPERTY_ID} />);
    await user.clear(await screen.findByLabelText(/An outage starts at/));
    await user.type(screen.getByLabelText(/An outage starts at/), "25");
    await user.click(screen.getByRole("button", { name: "Run the futures" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("between 0 and 23");
    expect(api.called("POST", `${base}/futures`)).toHaveLength(0);
  });

  it("shows what is missing, from the server, when the property is not ready", async () => {
    const user = userEvent.setup();
    world(json({ error: { code: "PLAN_INPUTS_MISSING", message: "A plan cannot be made yet: Choose the tariff you pay.", details: { missing: [{ what: "tariff", why: "Choose the tariff you pay on the Tariff tab." }] } } }, 422));
    render(<FuturesView id={PROPERTY_ID} />);
    await user.click(await screen.findByRole("button", { name: "Run the futures" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose the tariff you pay on the Tariff tab.");
  });

  it("asks a visitor who is not signed in to sign in", async () => {
    auth.user = null;
    world();
    render(<FuturesView id={PROPERTY_ID} />);
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/login?next=/property/${PROPERTY_ID}/futures`);
  });
});
