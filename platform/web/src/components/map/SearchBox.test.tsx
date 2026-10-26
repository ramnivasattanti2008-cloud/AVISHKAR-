import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchBox } from "./SearchBox";

const place = (label: string, latitude: number, longitude: number) => ({ label, latitude, longitude, kind: "place" });
const envelope = (value: unknown) => new Response(JSON.stringify({ value, provenance: {} }), { status: 200, headers: { "content-type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
const input = () => screen.getByRole("combobox");

describe("SearchBox", () => {
  it("treats a coordinate pair as coordinates: no geocoder call, source is manual", async () => {
    const onPick = vi.fn();
    render(<SearchBox onPick={onPick} />);
    await user().type(input(), "12.9716, 77.5946");
    await act(() => vi.advanceTimersByTimeAsync(1000));
    await user().click(screen.getByRole("button", { name: "Go" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onPick).toHaveBeenCalledWith({ latitude: 12.9716, longitude: 77.5946, source: "manual" });
  });

  it("waits for a pause in typing, then searches once with the trimmed text", async () => {
    fetchMock.mockResolvedValue(envelope([place("Indiranagar, Bengaluru", 12.98, 77.64)]));
    render(<SearchBox onPick={() => {}} />);
    await user().type(input(), "  Indiranagar   Bengaluru ");
    expect(fetchMock).not.toHaveBeenCalled(); // the debounce has not elapsed
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/geocode/search?q=Indiranagar+Bengaluru&limit=5");
    expect(await screen.findByRole("option", { name: /Indiranagar/ })).toBeInTheDocument();
  });

  it("does not search for fewer than three characters", async () => {
    render(<SearchBox onPick={() => {}} />);
    await user().type(input(), "Bg");
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("picks a result by click and reports it as an address lookup", async () => {
    fetchMock.mockResolvedValue(envelope([place("MG Road, Bengaluru", 12.97, 77.6), place("MG Road, Pune", 18.5, 73.87)]));
    const onPick = vi.fn();
    render(<SearchBox onPick={onPick} />);
    await user().type(input(), "MG Road");
    await act(() => vi.advanceTimersByTimeAsync(600));
    await user().click(await screen.findByRole("option", { name: /Pune/ }));
    expect(onPick).toHaveBeenCalledWith({ latitude: 18.5, longitude: 73.87, source: "geocoded", label: "MG Road, Pune" });
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(input()).toHaveValue("MG Road, Pune");
  });

  it("supports the keyboard: arrow to a result, Enter to pick it", async () => {
    fetchMock.mockResolvedValue(envelope([place("First, India", 1, 1), place("Second, India", 2, 2)]));
    const onPick = vi.fn();
    render(<SearchBox onPick={onPick} />);
    const u = user();
    await u.type(input(), "Somewhere");
    await act(() => vi.advanceTimersByTimeAsync(600));
    await screen.findAllByRole("option");
    await u.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ label: "Second, India", source: "geocoded" }));
  });

  it("says plainly when nothing is found", async () => {
    fetchMock.mockResolvedValue(envelope([]));
    render(<SearchBox onPick={() => {}} />);
    await user().type(input(), "Qzxqzx");
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(await screen.findByText(/No place found/)).toBeInTheDocument();
  });

  it("explains an unavailable address service and points to the other ways in", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: "PROVIDER_UNAVAILABLE", message: "nominatim down" } }), { status: 503 }));
    render(<SearchBox onPick={() => {}} />);
    await user().type(input(), "Anywhere");
    await act(() => vi.advanceTimersByTimeAsync(600));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/not answering/);
    expect(alert).toHaveTextContent(/click the map or paste coordinates/);
  });

  it("reports the browser's location as browser geolocation, with its accuracy, never as NavIC", async () => {
    const getCurrentPosition = vi.fn((ok: PositionCallback) => ok({ coords: { latitude: 12.5, longitude: 77.5, accuracy: 23.4 } } as GeolocationPosition));
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
    const onPick = vi.fn();
    render(<SearchBox onPick={onPick} />);
    await user().click(screen.getByRole("button", { name: /Locate me/ }));
    expect(onPick).toHaveBeenCalledWith({ latitude: 12.5, longitude: 77.5, accuracyM: 23.4, source: "browser-geolocation" });
    expect(JSON.stringify(onPick.mock.calls)).not.toMatch(/navic/i);
  });

  it("explains a refused location permission", async () => {
    const getCurrentPosition = vi.fn((_ok: PositionCallback, err: PositionErrorCallback) => err({ code: 1, PERMISSION_DENIED: 1, message: "denied" } as GeolocationPositionError));
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
    render(<SearchBox onPick={() => {}} />);
    await user().click(screen.getByRole("button", { name: /Locate me/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/permission was denied/);
  });
});
