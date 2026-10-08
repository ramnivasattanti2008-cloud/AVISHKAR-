import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROPERTY_ID, fakeApi, json, property, provenance, today } from "@/test/fixtures";
import type { Today } from "@/lib/types";
import { TodayView } from "./TodayView";

const auth = vi.hoisted(() => ({ user: { id: "u1", email: "me@example.com", role: "USER", displayName: null } as { id: string; email: string; role: string; displayName: string | null } | null }));
vi.mock("../AuthProvider", () => ({ useAuth: () => ({ user: auth.user, loading: false, login: vi.fn(), register: vi.fn(), logout: vi.fn() }) }));

const base = `/api/properties/${PROPERTY_ID}`;

function world(t: Today = today(), prop = property()) {
  const api = fakeApi([
    ["GET", base, () => json(prop)],
    ["GET", `${base}/twin`, () => json({ error: { code: "NOT_FOUND", message: "none" } }, 404)],
    ["GET", `${base}/today`, () => json(t)],
  ]);
  vi.stubGlobal("fetch", api.fetch);
  return api;
}

const tile = async (name: string) => within(await screen.findByRole("listitem", { name }));
const missing = (dataType: string, reason: string) => ({ value: null, provenance: provenance({ status: "UNAVAILABLE", provider: "avishkar-today", dataType, notes: [reason] }) });

beforeEach(() => {
  auth.user = { id: "u1", email: "me@example.com", role: "USER", displayName: null };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TodayView", () => {
  it("shows the eight figures of the home screen, each under its own data label", async () => {
    world();
    render(<TodayView id={PROPERTY_ID} />);
    expect(await screen.findByText("Your energy. Understood.")).toBeInTheDocument();
    expect(await (await tile("Energy autonomy")).findByText("81 / 100")).toBeInTheDocument();
    const gen = await tile("Generation today");
    expect(gen.getByText("21.4 kWh")).toBeInTheDocument();
    expect(gen.getByText("FORECAST")).toBeInTheDocument();
    expect((await tile("Consumption today")).getByText("28.2 kWh")).toBeInTheDocument();
    expect((await tile("Available surplus")).getByText("9.6 kWh")).toBeInTheDocument();
    const weather = await tile("Weather risk to the sun");
    expect(weather.getByText("52% cloud over the next 9 daylight hours")).toBeInTheDocument();
    expect(weather.getAllByText("MEDIUM").length).toBeGreaterThan(0);
    const res = await tile("Critical-load backup");
    expect(res.getByText("9.5 h")).toBeInTheDocument();
    expect(res.getByText(/if the grid failed now · score 40 \/ 100/)).toBeInTheDocument();
    expect((await tile("Expected value")).getByText("₹40.40")).toBeInTheDocument();
    expect((await tile("Confidence in the advice")).getByText("3 of 4")).toBeInTheDocument();
  });

  it("shows the recommendation with a Why? that opens the reasoning, the data used and the assumptions", async () => {
    world();
    render(<TodayView id={PROPERTY_ID} />);
    const sec = await screen.findByRole("region", { name: "What to do next" });
    expect(within(sec).getByText("Use the battery from 16:00: 2 kWh before 19:00.")).toBeInTheDocument();
    expect(within(sec).getByText(/Less steady: the planner gives the same advice/)).toBeInTheDocument();
    await userEvent.click(within(sec).getByText("Why?"));
    expect(within(sec).getByText("discharged at 18:00 to avoid importing at INR 10.00 per kWh")).toBeInTheDocument();
    expect(within(sec).getByText(/Tariff: Test ToD/)).toBeInTheDocument();
    expect(within(sec).getByText(/The battery's charge now is not known/)).toBeInTheDocument();
    expect(within(sec).getByRole("link", { name: "The whole plan, hour by hour" })).toHaveAttribute("href", `/property/${PROPERTY_ID}/plan`);
  });

  it("prints no number for what is unavailable: it says why, and links to what would fill it in", async () => {
    world(
      today({
        generation: missing("solar_energy_today", "No solar forecast has been made for this property yet."),
        surplus: missing("solar_surplus_today", "Needs both a solar forecast and a pattern of use for today."),
        plan: missing("plan_summary", "No plan has been made yet."),
        recommendation: null,
        achieved: { expectedSavingsInr: null, basis: "No plan yet.", carbon: { status: "UNAVAILABLE", reason: "No emission-factor table has been read from a source, so no carbon figure is stated." } },
        next: [
          { label: "Make a solar forecast", href: `/property/${PROPERTY_ID}/forecast`, why: "Today's generation is read from the latest solar forecast." },
          { label: "Make a plan", href: `/property/${PROPERTY_ID}/plan`, why: "A plan gives the recommendation." },
        ],
      }),
    );
    render(<TodayView id={PROPERTY_ID} />);
    const gen = await tile("Generation today");
    expect(gen.getByText("No solar forecast has been made for this property yet.")).toBeInTheDocument();
    expect(gen.getByText("UNAVAILABLE")).toBeInTheDocument();
    expect(gen.queryByText(/kWh/)).not.toBeInTheDocument();
    const autonomy = await tile("Energy autonomy");
    expect(autonomy.queryByText(/\/ 100/)).not.toBeInTheDocument();
    expect((await tile("Expected value")).getByText("No plan has been made yet.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "What to do next" })).not.toBeInTheDocument();
    const missingSec = screen.getByRole("region", { name: "To fill in what is missing" });
    expect(within(missingSec).getByRole("link", { name: "Make a solar forecast" })).toHaveAttribute("href", `/property/${PROPERTY_ID}/forecast`);
    expect(within(missingSec).getByRole("link", { name: "Make a plan" })).toHaveAttribute("href", `/property/${PROPERTY_ID}/plan`);
  });

  it("says what is expected to be achieved as expected, never as measured, and states no carbon", async () => {
    world();
    render(<TodayView id={PROPERTY_ID} />);
    const sec = await screen.findByRole("region", { name: "What AVISHKAR is expected to achieve" });
    expect(within(sec).getByText("₹40.40")).toBeInTheDocument();
    expect(within(sec).getByText(/A forecast, not a measurement/)).toBeInTheDocument();
    expect(within(sec).getByText("not stated")).toBeInTheDocument();
    expect(within(sec).getByText(/No emission-factor table has been read from a source/)).toBeInTheDocument();
    expect(within(sec).getByText("12.5 kWh")).toBeInTheDocument();
  });

  it("marks an old plan as old, in the value tile", async () => {
    const t = today();
    world({ ...t, plan: { ...t.plan, value: { ...t.plan.value!, stale: true } } });
    render(<TodayView id={PROPERTY_ID} />);
    expect(await (await tile("Expected value")).findByText(/saved over the plan's hours against no control \(an old plan\)/)).toBeInTheDocument();
  });

  it("is a demo property's banner too, and a sign-in prompt for a visitor", async () => {
    world(today(), property({ isDemo: true }));
    render(<TodayView id={PROPERTY_ID} />);
    expect((await screen.findAllByRole("note"))[0]).toHaveTextContent("DEMO DATA");
    cleanup();
    auth.user = null;
    world();
    render(<TodayView id={PROPERTY_ID} />);
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/login?next=/property/${PROPERTY_ID}/today`);
  });

  it("shows the server's error rather than a blank page", async () => {
    const api = fakeApi([
      ["GET", base, () => json(property())],
      ["GET", `${base}/twin`, () => json({ error: { code: "NOT_FOUND", message: "none" } }, 404)],
      ["GET", `${base}/today`, () => json({ error: { code: "INTERNAL", message: "Something went wrong on our side." } }, 500)],
    ]);
    vi.stubGlobal("fetch", api.fetch);
    render(<TodayView id={PROPERTY_ID} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong on our side.");
  });
});
