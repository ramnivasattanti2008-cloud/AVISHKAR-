import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LoadForecast, SolarForecast } from "@/lib/types";
import { PROPERTY_ID, fakeApi, json, loadForecast, provenance, solarForecast, solarPerformance } from "@/test/fixtures";
import { LoadForecastPanel, SolarForecastPanel } from "./ModelForecasts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const unavailable = (reason: string, dataType: string) => ({ value: null, provenance: provenance({ status: "UNAVAILABLE", provider: "avishkar-engine", dataType, notes: [reason] }) });

describe("SolarForecastPanel", () => {
  it("shows the expected energy with its range, the system it is for, the chart, and how the model scored", async () => {
    const api = fakeApi([
      ["GET", `/api/properties/${PROPERTY_ID}/solar-forecast`, () => json(solarForecast())],
      ["GET", `/api/properties/${PROPERTY_ID}/solar-forecast/performance`, () => json(solarPerformance())],
    ]);
    vi.stubGlobal("fetch", api.fetch);
    render(<SolarForecastPanel id={PROPERTY_ID} />);

    const panel = await screen.findByRole("region", { name: "Solar output forecast" });
    expect(await within(panel).findByText(/Roof: 5 kWp, tilted 12°, facing south, system losses 14% \(assumed\)/)).toBeInTheDocument();
    expect(within(panel).getByText("31.4 kWh")).toBeInTheDocument();
    expect(within(panel).getByText("likely 25.1 to 37.7 kWh")).toBeInTheDocument();
    expect(within(panel).getByText("79% held")).toBeInTheDocument();
    expect(within(panel).getByText("FORECAST")).toBeInTheDocument();
    expect(within(panel).getByRole("img", { name: /Solar output forecast: 48 hourly values in kW/ })).toBeInTheDocument();

    const skill = await within(panel).findByRole("region", { name: "How well the solar forecast has done lately" });
    expect(within(skill).getByText("It missed 40% less than simply repeating yesterday’s output.")).toBeInTheDocument();
    expect(within(skill).getByText(/not of metered panel output/)).toBeInTheDocument();
    expect(within(skill).getByText("ESTIMATED")).toBeInTheDocument();
  });

  it("does not claim a forecast beats the naive baseline when it does not", async () => {
    const p = solarPerformance();
    p.result.value!.skillVsPersistence = -0.15;
    const api = fakeApi([
      ["GET", /solar-forecast$/, () => json(solarForecast())],
      ["GET", /performance$/, () => json(p)],
    ]);
    vi.stubGlobal("fetch", api.fetch);
    render(<SolarForecastPanel id={PROPERTY_ID} />);
    expect(await screen.findByText(/It did not beat simply repeating yesterday’s output \(15% worse\)/)).toBeInTheDocument();
  });

  it("says why there is no range, and draws no band, when the record of past errors is missing", async () => {
    const f = solarForecast({
      band: { available: false, reason: "Open-Meteo returned no hour with both an analysis and a day-ahead forecast.", calibration: null },
    });
    for (const h of f.hours.value!) {
      h.p10Kw = null;
      h.p90Kw = null;
    }
    f.energy.value!.kwhP10 = null;
    f.energy.value!.kwhP90 = null;
    const api = fakeApi([
      ["GET", /solar-forecast$/, () => json(f)],
      ["GET", /performance$/, () => json(solarPerformance())],
    ]);
    vi.stubGlobal("fetch", api.fetch);
    render(<SolarForecastPanel id={PROPERTY_ID} />);
    expect(await screen.findByText(/No uncertainty range is shown: Open-Meteo returned no hour/)).toBeInTheDocument();
    expect(screen.getByText("no range claimed")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Solar output forecast/ }).getAttribute("aria-label")).not.toContain("shaded band");
  });

  it("tells you to add a system, with a link, instead of drawing anything, when there is none", async () => {
    const f: SolarForecast = { ...solarForecast(), systems: [], hours: unavailable("No solar system is entered for this property. Add one (installed or planned) on the Assets tab to forecast its output.", "solar_output_forecast"), energy: unavailable("x", "e") };
    const api = fakeApi([["GET", /solar-forecast$/, () => json(f)]]);
    vi.stubGlobal("fetch", api.fetch);
    render(<SolarForecastPanel id={PROPERTY_ID} />);
    expect(await screen.findByText(/No solar system is entered for this property/)).toBeInTheDocument();
    expect(screen.getByText("UNAVAILABLE")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add a solar system" })).toHaveAttribute("href", `/property/${PROPERTY_ID}/assets`);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(api.calls.some((c) => c.path.endsWith("/performance"))).toBe(false); // nothing to score
  });

  it("shows the server's words when the engine is down", async () => {
    const api = fakeApi([["GET", /solar-forecast$/, () => json({ error: { code: "ENGINE_UNAVAILABLE", message: "The planning engine is not answering, so plans and model forecasts are unavailable right now." } }, 503)]]);
    vi.stubGlobal("fetch", api.fetch);
    render(<SolarForecastPanel id={PROPERTY_ID} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The planning engine is not answering");
  });
});

describe("LoadForecastPanel", () => {
  it("shows the chosen method, how it was scored, the chart and the methods compared", async () => {
    const api = fakeApi([["GET", `/api/properties/${PROPERTY_ID}/load-forecast`, () => json(loadForecast())]]);
    vi.stubGlobal("fetch", api.fetch);
    render(<LoadForecastPanel id={PROPERTY_ID} />);

    const panel = await screen.findByRole("region", { name: "Electricity use forecast" });
    expect(await within(panel).findByText("28.4 kWh")).toBeInTheDocument();
    expect(within(panel).getAllByText("Average of this hour of the week").length).toBeGreaterThan(0);
    expect(within(panel).getByText("mean error 0.08 kW on 14 days it had not seen")).toBeInTheDocument();
    expect(within(panel).getByText("81% held")).toBeInTheDocument();
    expect(within(panel).getByText("2.5 kW")).toBeInTheDocument();
    expect(within(panel).getByRole("img", { name: /Electricity use forecast: 24 hourly values in kW/ })).toBeInTheDocument();
    const table = within(panel).getByRole("region", { name: "Forecasting methods compared" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByText("chosen")).toBeInTheDocument();
    expect(within(panel).getByText(/Built from 70 days of 60-minute readings \(1% of hours had no reading/)).toBeInTheDocument();
  });

  it("refetches for the horizon that is chosen", async () => {
    const api = fakeApi([["GET", /load-forecast$/, () => json(loadForecast())]]);
    vi.stubGlobal("fetch", api.fetch);
    render(<LoadForecastPanel id={PROPERTY_ID} />);
    await screen.findByText("28.4 kWh");
    await userEvent.selectOptions(screen.getByLabelText("Forecast length"), "168");
    await waitFor(() => expect(api.calls.some((c) => c.search === "?hours=168")).toBe(true));
  });

  it("says that old data gives an estimate of the hours after it, not a forecast of tomorrow", async () => {
    const f: LoadForecast = loadForecast();
    f.hours.provenance = { ...f.hours.provenance, status: "ESTIMATED", notes: ["Estimated: your meter data ends 190.2 days ago, so this is what the model expects for the hours that followed it, not for the coming days."] };
    const api = fakeApi([["GET", /load-forecast$/, () => json(f)]]);
    vi.stubGlobal("fetch", api.fetch);
    render(<LoadForecastPanel id={PROPERTY_ID} />);
    expect(await screen.findAllByText(/not for the coming days/)).not.toHaveLength(0);
    expect(screen.getAllByText("ESTIMATED").length).toBeGreaterThan(0);
    expect(screen.queryByText("FORECAST")).not.toBeInTheDocument();
  });

  it("explains what is missing, with a link to the meter data tab, when there is not enough history", async () => {
    const f: LoadForecast = { ...loadForecast(), hours: unavailable("A load forecast needs at least 14 days of readings with at least 60% of the hours present; these cover 8.0 days.", "load_forecast"), energy: unavailable("x", "e"), model: null, history: null };
    const api = fakeApi([["GET", /load-forecast$/, () => json(f)]]);
    vi.stubGlobal("fetch", api.fetch);
    render(<LoadForecastPanel id={PROPERTY_ID} />);
    expect(await screen.findByText(/at least 14 days of readings/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Meter data" })).toHaveAttribute("href", `/property/${PROPERTY_ID}/meter-data`);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
