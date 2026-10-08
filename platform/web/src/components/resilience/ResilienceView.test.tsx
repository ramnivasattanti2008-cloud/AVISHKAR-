import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROPERTY_ID, fakeApi, json, property, resilienceReport } from "@/test/fixtures";
import type { ResilienceReport } from "@/lib/types";
import { ResilienceView } from "./ResilienceView";

const auth = vi.hoisted(() => ({ user: { id: "u1", email: "me@example.com", role: "USER", displayName: null } as { id: string; email: string; role: string; displayName: string | null } | null }));
vi.mock("../AuthProvider", () => ({ useAuth: () => ({ user: auth.user, loading: false, login: vi.fn(), register: vi.fn(), logout: vi.fn() }) }));

function world(handler: () => Response = () => json(resilienceReport()), prop = property()) {
  const api = fakeApi([
    ["GET", `/api/properties/${PROPERTY_ID}`, () => json(prop)],
    ["GET", `/api/properties/${PROPERTY_ID}/twin`, () => json({ error: { code: "NOT_FOUND", message: "none" } }, 404)],
    ["GET", `/api/properties/${PROPERTY_ID}/resilience`, handler],
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

describe("ResilienceView", () => {
  it("opens with an answer: the score, the hours with and without the sun, the critical load and the method", async () => {
    const api = world();
    render(<ResilienceView id={PROPERTY_ID} />);
    const sec = await screen.findByRole("region", { name: "If the grid failed now" });
    expect(api.called("GET", `/api/properties/${PROPERTY_ID}/resilience`)[0]!.search).toBe("?targetHours=4");
    expect(within(sec).getByText("SIMULATED")).toBeInTheDocument();
    expect(within(sec).getByText("20 / 100")).toBeInTheDocument();
    expect(within(sec).getAllByText("4.7 h")).toHaveLength(2); // with the forecast sun, and the battery alone
    expect(within(sec).getByText("1 kW")).toBeInTheDocument();
    expect(within(sec).getByText("2 × Fridge")).toBeInTheDocument();
    expect(within(sec).getByText(/divided by 24/)).toBeInTheDocument();
    expect(within(sec).getByText(/assumed: enter the real charge above/)).toBeInTheDocument();
  });

  it("recommends a reserve for the time asked, and says how much to add", async () => {
    world();
    render(<ResilienceView id={PROPERTY_ID} />);
    const sec = await screen.findByRole("region", { name: "The reserve to keep" });
    expect(within(sec).getByText("To last 4 h with no sun")).toBeInTheDocument();
    expect(within(sec).getByText("5.22 kWh")).toBeInTheDocument();
    expect(within(sec).getByText("52% of the battery")).toBeInTheDocument();
    expect(within(sec).getByText("4.22 kWh")).toBeInTheDocument();
    expect(within(sec).queryByRole("status")).not.toBeInTheDocument();
  });

  it("says when the battery cannot hold the time asked", async () => {
    const base = resilienceReport();
    const r = base.resilience.value!;
    world(() => json(resilienceReport({ resilience: { ...base.resilience, value: { ...r, recommendedReserve: { ...r.recommendedReserve!, targetHours: 24, feasible: false, reserveKwh: 25.3, gapKwh: 24.3, longestPossibleHours: 8.5 } } } })));
    render(<ResilienceView id={PROPERTY_ID} />);
    expect(await screen.findByText("This battery cannot hold 24 hours of the critical load: the most it can carry with no sun is about 8.5 hours.")).toHaveAttribute("role", "status");
  });

  it("shows a lower bound as at least, when the load was carried through every hour examined", async () => {
    const base = resilienceReport();
    const r = base.resilience.value!;
    world(() => json(resilienceReport({ resilience: { ...base.resilience, value: { ...r, score: 100, backupHours: { withForecastSun: 48, atLeast: true, withoutSun: 31.6 } } } })));
    render(<ResilienceView id={PROPERTY_ID} />);
    const sec = await screen.findByRole("region", { name: "If the grid failed now" });
    expect(within(sec).getByText("at least 48 h")).toBeInTheDocument();
    expect(within(sec).getByText("100 / 100")).toBeInTheDocument();
  });

  it("shows autonomy with its parts and its method, from the plan it was read from", async () => {
    world();
    render(<ResilienceView id={PROPERTY_ID} />);
    const sec = await screen.findByRole("region", { name: "Autonomy" });
    expect(within(sec).getByText("24 / 100")).toBeInTheDocument();
    expect(within(sec).getByText("77% from the grid")).toBeInTheDocument();
    expect(within(sec).getByText("21.5 kWh")).toBeInTheDocument();
    expect(within(sec).getByText(/Autonomy = 100 x \(1 - energy bought from the grid/)).toBeInTheDocument();
    expect(within(sec).getByText(/Critical load cover if the grid failed now: 4.7 h/)).toBeInTheDocument();
  });

  it("points to the Plan tab, and prints no number, when autonomy has no plan to read from", async () => {
    const base = resilienceReport();
    world(() => json(resilienceReport({ autonomy: { value: null, provenance: { ...base.autonomy.provenance, status: "UNAVAILABLE", notes: ["No plan has been made yet, and autonomy is read from a plan."] } } })));
    render(<ResilienceView id={PROPERTY_ID} />);
    const sec = await screen.findByRole("region", { name: "Autonomy" });
    expect(within(sec).getByText("UNAVAILABLE")).toBeInTheDocument();
    expect(within(sec).getAllByText(/No plan has been made yet/).length).toBeGreaterThan(0); // in the sentence, and in the source details
    expect(within(sec).getByRole("link", { name: "Make a plan" })).toHaveAttribute("href", `/property/${PROPERTY_ID}/plan`);
    expect(within(sec).queryByText(/\/ 100/)).not.toBeInTheDocument();
  });

  it("states that grid outage risk is unavailable, never predicted", async () => {
    world();
    render(<ResilienceView id={PROPERTY_ID} />);
    const note = await screen.findByRole("note");
    expect(note).toHaveTextContent("UNAVAILABLE");
    expect(note).toHaveTextContent("no outage or grid-reliability data source exists");
  });

  it("sends the time and the charge that were typed, and asks again", async () => {
    const api = world();
    render(<ResilienceView id={PROPERTY_ID} />);
    await screen.findByRole("region", { name: "If the grid failed now" });
    const target = screen.getByLabelText("I want the critical load to last, hours");
    await userEvent.clear(target);
    await userEvent.type(target, "8");
    await userEvent.type(screen.getByLabelText("Battery charge now, % (optional)"), "60");
    await userEvent.click(screen.getByRole("button", { name: "Work it out" }));
    await waitFor(() => expect(api.called("GET", `/api/properties/${PROPERTY_ID}/resilience`)).toHaveLength(2));
    expect(api.called("GET", `/api/properties/${PROPERTY_ID}/resilience`)[1]!.search).toBe("?targetHours=8&startSocPercent=60");
  });

  it("does not ask the server for a time or a charge that is not one", async () => {
    const api = world();
    render(<ResilienceView id={PROPERTY_ID} />);
    await screen.findByRole("region", { name: "If the grid failed now" });
    const target = screen.getByLabelText("I want the critical load to last, hours");
    await userEvent.clear(target);
    await userEvent.type(target, "30");
    await userEvent.click(screen.getByRole("button", { name: "Work it out" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("must be between 1 and 24 hours");
    await userEvent.clear(target);
    await userEvent.type(target, "4");
    await userEvent.type(screen.getByLabelText("Battery charge now, % (optional)"), "150");
    await userEvent.click(screen.getByRole("button", { name: "Work it out" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The battery charge must be between 0 and 100 percent");
    expect(api.called("GET", `/api/properties/${PROPERTY_ID}/resilience`)).toHaveLength(1); // only the opening answer
  });

  it("asks you to mark critical appliances, with a link, when there are none", async () => {
    world(() => json({ error: { code: "PLAN_INPUTS_MISSING", message: "Resilience needs to know what must stay on: no appliance of this property is marked CRITICAL.", details: { missing: [{ what: "critical", why: "Mark them." }] } } }, 422));
    render(<ResilienceView id={PROPERTY_ID} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("no appliance of this property is marked CRITICAL");
    expect(within(alert).getByRole("link", { name: "Mark critical appliances on the Assets tab" })).toHaveAttribute("href", `/property/${PROPERTY_ID}/assets`);
    expect(screen.queryByRole("region", { name: "If the grid failed now" })).not.toBeInTheDocument();
  });

  it("says there is no backup for a home with no battery", async () => {
    const base = resilienceReport();
    const r = base.resilience.value!;
    world(() => json(resilienceReport({ resilience: { ...base.resilience, value: { ...r, battery: null, score: 0, backupHours: { withForecastSun: 0, atLeast: false, withoutSun: 0 }, recommendedReserve: null } } } as Partial<ResilienceReport>)));
    render(<ResilienceView id={PROPERTY_ID} />);
    expect(await screen.findByText(/There is no battery, so the critical load is not served when the grid is down/)).toBeInTheDocument();
    expect(screen.getByText("0 / 100")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "The reserve to keep" })).not.toBeInTheDocument();
  });

  it("carries the demo banner on a demo property", async () => {
    world(undefined, property({ isDemo: true }));
    render(<ResilienceView id={PROPERTY_ID} />);
    expect(await screen.findByRole("note", { name: "" })).toBeDefined();
    expect(screen.getAllByRole("note")[0]).toHaveTextContent("DEMO DATA");
  });
});
