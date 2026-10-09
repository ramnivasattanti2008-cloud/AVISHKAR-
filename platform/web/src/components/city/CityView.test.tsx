import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi, json, property, provenance } from "@/test/fixtures";
import type { CityEnergyMap } from "@/lib/types";
import { CityView } from "./CityView";

const auth = vi.hoisted(() => ({ user: { id: "u1", email: "me@example.com", role: "USER", displayName: null } as { id: string; email: string; role: string; displayName: string | null } | null }));
vi.mock("../AuthProvider", () => ({ useAuth: () => ({ user: auth.user, loading: false, login: vi.fn(), register: vi.fn(), logout: vi.fn() }) }));
// the map needs a WebGL canvas that jsdom does not have; the page's own content is what is under test
vi.mock("../map/MapCanvas", () => ({ default: ({ cells, label }: { cells?: { id: string; fill: string }[]; label?: string }) => <div data-testid="map" aria-label={label}>{(cells ?? []).map((c) => <span key={c.id} data-cell={c.id} data-fill={c.fill} />)}</div> }));

function cell(id: string, ghi: number | null, yours: CityEnergyMap["cells"][number]["yours"] = null): CityEnergyMap["cells"][number] {
  const p = provenance({ status: ghi === null ? "UNAVAILABLE" : "REFERENCE", provider: "nasa-power", dataType: "solar_resource_cell", notes: ghi === null ? ["The solar-resource provider returned no annual value for this cell."] : [] });
  return {
    id,
    row: Number(id[1]),
    col: Number(id[3]),
    centre: { latitude: 12.97, longitude: 77.64 },
    bounds: { west: 77.6, south: 12.9, east: 77.7, north: 13 },
    geojson: { type: "Polygon", coordinates: [[[77.6, 12.9], [77.7, 12.9], [77.7, 13], [77.6, 13], [77.6, 12.9]]] },
    solar: ghi === null ? { value: null, unit: "kWh/m2/day", provenance: p } : { value: { annualGhiKwhM2Day: ghi, bestMonth: { month: 3, ghiKwhM2Day: ghi + 1 }, worstMonth: { month: 7, ghiKwhM2Day: ghi - 1 }, period: "20-year climatology (2001-2020)" }, unit: "kWh/m2/day", provenance: p },
    yours,
  };
}

const unknown = (reason: string) => ({ status: "UNAVAILABLE" as const, reason });

function cityMap(over: Partial<CityEnergyMap> = {}): CityEnergyMap {
  return {
    label: "CITY ENERGY MAP",
    madeAt: "2026-10-09T10:00:00.000Z",
    grid: { centre: { latitude: 12.97, longitude: 77.64 }, spanKm: 12, cellsPerSide: 2, cellKm: 6 },
    cells: [
      cell("r0c0", 5.48),
      cell("r0c1", 5.61, { properties: 1, names: ["Home"], solarKwp: 5, batteryKwh: 10, evs: 0, flexibleKw: 0.5, meanDailyKwh: 18.2 }),
      cell("r1c0", null),
      cell("r1c1", 5.52),
    ],
    solarSpread: { distinctValues: 3, lowest: 5.48, highest: 5.61, note: "The cells differ by 0.13 kWh/m² per day, 2.4% of the lowest. A difference this small is the model's grid showing through, not a roof-by-roof difference." },
    yourTotals: { properties: 1, names: ["Home"], solarKwp: 5, batteryKwh: 10, evs: 0, flexibleKw: 0.5, meanDailyKwh: 18.2 },
    cityWide: {
      demand: unknown("AVISHKAR has no source for how much electricity a city uses."),
      storage: unknown("No register of batteries in a city exists here."),
      evs: unknown("No register of vehicles in a city exists here."),
      flexibility: unknown("Nothing but your own entries says what can move."),
      energyRisk: unknown("No outage, feeder or network data source is connected."),
    },
    notes: ["Only your own properties appear on this map.", "The solar resource is a 20-year climatology at each cell's centre."],
    ...over,
  };
}

function world(c: CityEnergyMap | Response = cityMap()) {
  const api = fakeApi([
    ["GET", "/api/properties", () => json({ properties: [property({ name: "Home" })] })],
    ["GET", "/api/geocode/search", () => json({ value: [{ latitude: 12.97, longitude: 77.64, label: "Bengaluru, Karnataka, India", kind: "city", importance: 0.7 }], provenance: provenance({ status: "REFERENCE", provider: "nominatim", dataType: "geocode" }) })],
    ["POST", "/api/city", () => (c instanceof Response ? c : json(c))],
  ]);
  vi.stubGlobal("fetch", api.fetch);
  return api;
}

const search = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(await screen.findByLabelText(/Search an address/i), "Bengaluru");
  await user.click(await screen.findByRole("option", { name: /Bengaluru/ }));
};

beforeEach(() => {
  auth.user = { id: "u1", email: "me@example.com", role: "USER", displayName: null };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CityView", () => {
  it("says up front that a city's own energy is not shown, and asks nothing of the server until a place is chosen", async () => {
    const api = world();
    render(<CityView />);
    expect(await screen.findByText(/AVISHKAR has no source for it, and\s+a number without a source would be invented/)).toBeInTheDocument();
    expect(api.called("POST", "/api/city")).toHaveLength(0);
  });

  it("draws a cell per cell with a colour from its own value, and shades a cell with no value differently from a low one", async () => {
    const user = userEvent.setup();
    world();
    render(<CityView />);
    await search(user);
    const map = await screen.findByTestId("map");
    const fills = [...map.querySelectorAll("[data-cell]")].map((e) => [e.getAttribute("data-cell"), e.getAttribute("data-fill")]);
    expect(fills).toHaveLength(4);
    const byId = Object.fromEntries(fills);
    expect(byId["r1c0"]).toBe("#9ca3af"); // the cell with no value is grey, not the palest colour
    expect(byId["r0c0"]).not.toBe(byId["r0c1"]); // the lowest and the highest differ
  });

  it("lists each cell with its sun, its best and worst month, and your own properties in it", async () => {
    const user = userEvent.setup();
    world();
    render(<CityView />);
    await search(user);
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(5); // the header and four cells
    const withMine = within(rows.find((r) => within(r).queryByText("Home"))!);
    expect(withMine.getByText(/5 kWp/)).toBeInTheDocument();
    expect(withMine.getByText(/uses 18.2 kWh a day/)).toBeInTheDocument();
    const noValue = within(rows.find((r) => within(r).queryByText(/returned no annual value/))!);
    expect(noValue.queryByText(/kWh\/m²\/day/)).not.toBeInTheDocument(); // no number where there is none
    expect(within(rows[1]!).getByText(/March/)).toBeInTheDocument();
  });

  it("states the real spread between the cells, in the provider's own words", async () => {
    const user = userEvent.setup();
    world();
    render(<CityView />);
    await search(user);
    expect(await screen.findByText(/the model's grid showing through/)).toBeInTheDocument();
    expect(screen.getByText(/5.48 to 5.61 kWh\/m² per day/)).toBeInTheDocument();
  });

  it("names each thing a city map cannot tell you, with the reason, and never a number for it", async () => {
    const user = userEvent.setup();
    world();
    render(<CityView />);
    await search(user);
    const sec = await screen.findByRole("region", { name: "What this map does not tell you" });
    const items = within(sec).getAllByRole("listitem");
    expect(items).toHaveLength(5);
    expect(within(sec).getAllByText("UNAVAILABLE")).toHaveLength(5);
    expect(within(sec).getByText(/No outage, feeder or network data source is connected/)).toBeInTheDocument();
    expect(sec.textContent).not.toMatch(/\d+(\.\d+)?\s*(kWh|kW|MW)/);
  });

  it("refuses cells smaller than the provider can tell apart, without asking the server", async () => {
    const user = userEvent.setup();
    const api = world();
    render(<CityView />);
    await search(user);
    api.calls.length = 0;
    await user.clear(screen.getByLabelText(/The square is, km across/));
    await user.type(screen.getByLabelText(/The square is, km across/), "4");
    await user.clear(screen.getByLabelText(/Cells along each side/));
    await user.type(screen.getByLabelText(/Cells along each side/), "5");
    await user.click(screen.getByRole("button", { name: "Draw it again" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("at least 1.1 km");
    expect(api.called("POST", "/api/city")).toHaveLength(0);
  });

  it("asks a visitor who is not signed in to sign in", () => {
    auth.user = null;
    world();
    render(<CityView />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=/city");
  });
});
