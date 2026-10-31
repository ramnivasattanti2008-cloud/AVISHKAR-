import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeApi, json } from "@/test/fixtures";
import type { SystemHealth } from "@/lib/types";
import { DegradedBanner, degradedLines } from "./DegradedBanner";

const provider = (name: string, state: "healthy" | "degraded" | "down" | "unknown") => ({ provider: name, state, calls: 3, failures: state === "healthy" ? 0 : 3, p50Ms: 100, p95Ms: 200, lastSuccessAt: null, lastErrorAt: null, lastError: null });
const health = (over: Partial<SystemHealth> = {}): SystemHealth => ({
  status: "ok",
  database: { state: "healthy", postgis: "3.4", latencyMs: 2, error: null },
  providers: [provider("nominatim", "healthy"), provider("open-meteo", "unknown")],
  engine: { state: "healthy", version: "1", solver: "HiGHS 1.7", error: null },
  windowMinutes: 15,
  generatedAt: "2026-10-27T06:00:00.000Z",
  ...over,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("degradedLines", () => {
  it("says nothing when all is well, and 'unknown' (no recent traffic) is not a failure", () => {
    expect(degradedLines(health(), false)).toEqual([]);
    expect(degradedLines(null, false)).toEqual([]);
  });

  it("names what is affected, in plain words", () => {
    const lines = degradedLines(health({ status: "degraded", engine: { state: "down", version: null, solver: null, error: "timeout" }, providers: [provider("open-meteo", "down"), provider("overpass", "degraded")] }), false);
    expect(lines[0]).toMatch(/planning engine is not answering/);
    expect(lines[1]).toBe("Failing recently: weather and solar forecasts, building outlines. Values from them may be older than usual or missing, and are labelled so.");
  });

  it("says the server itself is not answering when the check cannot be made", () => {
    expect(degradedLines(null, true)).toEqual(["The AVISHKAR server is not answering, so nothing can be loaded or saved right now."]);
  });
});

describe("DegradedBanner", () => {
  it("shows nothing when the system is healthy", async () => {
    const api = fakeApi([["GET", "/api/system/health", () => json(health())]]);
    vi.stubGlobal("fetch", api.fetch);
    const { container } = render(<DegradedBanner />);
    await vi.waitFor(() => expect(api.calls.length).toBeGreaterThan(0));
    expect(container).toBeEmptyDOMElement();
  });

  it("shows what is down, with a link to the system page", async () => {
    vi.stubGlobal("fetch", fakeApi([["GET", "/api/system/health", () => json(health({ status: "degraded", database: { state: "down", postgis: null, latencyMs: null, error: "refused" } }))]]).fetch);
    render(<DegradedBanner />);
    const banner = await screen.findByRole("status", { name: "Service status" });
    expect(banner).toHaveTextContent("The database is not answering");
    expect(screen.getByRole("link", { name: "System status" })).toHaveAttribute("href", "/system");
  });
});
