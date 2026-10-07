import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnergySummary } from "@/lib/types";
import { PROPERTY_ID, energyDna, energyImport, energySummary, fakeApi, json, property } from "@/test/fixtures";
import { DailyChart, PatternChart } from "./MeterCharts";
import { MeterDataView } from "./MeterDataView";

const auth = vi.hoisted(() => ({ user: { id: "u1", email: "me@example.com", role: "USER", displayName: null } as { id: string; email: string; role: string; displayName: string | null } | null }));
vi.mock("../AuthProvider", () => ({ useAuth: () => ({ user: auth.user, loading: false, login: vi.fn(), register: vi.fn(), logout: vi.fn() }) }));

const NO_TWIN = { error: { code: "NOT_FOUND", message: "No Energy Twin yet." } };
const empty: EnergySummary = { imports: [], coverage: null, dailyKwh: [], dna: null, dnaUnavailableReason: "Import a meter file to build your Energy DNA." };

function world(summary: EnergySummary = energySummary()) {
  const w = { summary };
  const api = fakeApi([
    ["GET", `/api/properties/${PROPERTY_ID}`, () => json(property())],
    ["GET", `/api/properties/${PROPERTY_ID}/twin`, () => json(NO_TWIN, 404)],
    ["GET", `/api/properties/${PROPERTY_ID}/energy`, () => json(w.summary)],
    ["DELETE", /\/energy\/imports\/[0-9a-f-]{36}$/, () => {
      w.summary = empty;
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

describe("MeterDataView", () => {
  it("says plainly that nothing is assumed when there are no readings", async () => {
    world(empty);
    render(<MeterDataView id={PROPERTY_ID} />);
    expect(await screen.findByText(/No readings yet\. AVISHKAR does not guess/)).toBeInTheDocument();
    expect(screen.getByText("Import a meter file to build your Energy DNA.")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Energy read on each/ })).not.toBeInTheDocument();
  });

  it("shows coverage, the imports, the daily chart and the Energy DNA", async () => {
    world();
    render(<MeterDataView id={PROPERTY_ID} />);
    expect(await screen.findByText(/1,344 readings over 14 days, every 15 minutes/)).toBeInTheDocument();
    expect(screen.getByText("meter.csv")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Energy read on each of 14 days/ })).toBeInTheDocument();
    const dna = screen.getByRole("region", { name: "Energy DNA" });
    expect(within(dna).getByText(/Version 1: 14 complete days/)).toBeInTheDocument();
    expect(within(dna).getByText("Average day")).toBeInTheDocument();
    expect(within(dna).getByText("30.9")).toBeInTheDocument();
    expect(within(dna).getAllByText("ESTIMATED")).toHaveLength(6); // every baseline figure is an estimate from those days, and says so
  });

  it("labels what it cannot know: an unavailable weekend average and the reasons on the DNA", async () => {
    const dna = energyDna();
    dna.baseline.weekendDailyKwh = { value: null, unit: "kWh/day", provenance: { ...dna.baseline.weekendDailyKwh.provenance, status: "UNAVAILABLE", notes: ["Fewer than two complete weekend days: one day is not a pattern."] } };
    world(energySummary({ dna }));
    render(<MeterDataView id={PROPERTY_ID} />);
    const region = await screen.findByRole("region", { name: "Energy DNA" });
    expect(within(region).getByText("UNAVAILABLE")).toBeInTheDocument();
    expect(within(region).getAllByText(/Fewer than two complete weekend days/).length).toBeGreaterThan(0);
    expect(within(region).getByText(/Weather sensitivity:/)).toBeInTheDocument();
    expect(within(region).getByText("Mar 2026")).toBeInTheDocument(); // the monthly table
  });

  it("explains why there is no fingerprint when readings exist but are too few", async () => {
    world(energySummary({ dna: null, dnaUnavailableReason: "A usage fingerprint needs at least 7 complete days (95% of the readings present). Your readings have 3 out of 3 days." }));
    render(<MeterDataView id={PROPERTY_ID} />);
    expect(await screen.findByText(/needs at least 7 complete days/)).toBeInTheDocument();
  });

  it("deletes an import and says the Energy DNA was rebuilt", async () => {
    const { api } = world();
    render(<MeterDataView id={PROPERTY_ID} />);
    await userEvent.click(await screen.findByRole("button", { name: /Delete meter.csv and its readings/ }));
    expect(await screen.findByText(/meter.csv and its 1,344 readings were deleted, and the Energy DNA was rebuilt/)).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "DELETE" && c.path.endsWith(`/energy/imports/${energyImport().id}`))).toBe(true);
    await waitFor(() => expect(screen.getByText(/No readings yet/)).toBeInTheDocument());
  });

  it("asks a signed-out visitor to sign in", async () => {
    auth.user = null;
    world();
    render(<MeterDataView id={PROPERTY_ID} />);
    expect(await screen.findByText("Property not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/login?next=/property/${PROPERTY_ID}/meter-data`);
  });
});

describe("DailyChart", () => {
  const day = (date: string, complete = true) => ({ date, kwh: 20, readings: complete ? 96 : 40, expectedReadings: 96, complete });

  it("says how many days are partial, and explains faded bars", () => {
    render(<DailyChart days={[day("2026-03-02"), day("2026-03-03"), day("2026-03-04", false)]} />);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", expect.stringContaining("1 of them is a partial day"));
    cleanup();
    render(<DailyChart days={[day("2026-03-02", false), day("2026-03-03", false)]} />);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", expect.stringContaining("2 of them are partial days"));
    expect(screen.getByText(/Faded bars are partial days/)).toBeInTheDocument();
  });

  it("does not mention partial days when all are complete", () => {
    render(<DailyChart days={[day("2026-03-02"), day("2026-03-03")]} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).not.toContain("partial");
    expect(screen.queryByText(/Faded bars/)).not.toBeInTheDocument();
  });

  it("draws nothing for no days", () => {
    render(<DailyChart days={[]} />);
    expect(screen.getByText("No readings to chart.")).toBeInTheDocument();
  });
});

describe("PatternChart", () => {
  it("names the busiest hour for screen readers", () => {
    const hourly = Array.from({ length: 24 }, (_, h) => (h === 19 ? 3 : 1));
    render(<PatternChart hourly={hourly} weekday={null} weekend={null} />);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Average power by hour of the day, peaking at 19:00");
  });
});
