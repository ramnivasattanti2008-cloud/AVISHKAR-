import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError, ProviderError } from "../src/errors.js";
import { MemoryCache, cachedFetch } from "../src/providers/cache.js";
import { withFailover } from "../src/providers/failover.js";
import { NominatimGeocoder } from "../src/providers/geocoding.js";
import { ProviderHttp } from "../src/providers/http.js";
import { checkPositionSource, describePosition } from "../src/providers/positioning.js";
import { MemoryRecorder, summariseHealth } from "../src/providers/recorder.js";

type Handler = (url: URL, attempt: number) => Response | Promise<Response>;
function fakeFetch(handler: Handler) {
  const urls: URL[] = [];
  const impl = (async (input: URL | string) => {
    const url = new URL(input.toString());
    urls.push(url);
    return handler(url, urls.length);
  }) as typeof fetch;
  return { impl, urls };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function client(handler: Handler, extra: Partial<ConstructorParameters<typeof ProviderHttp>[0]> = {}) {
  const f = fakeFetch(handler);
  const recorder = new MemoryRecorder();
  const sleeps: number[] = [];
  const http = new ProviderHttp({
    provider: "test",
    baseUrl: "https://example.test/api",
    userAgent: "AVISHKAR-tests/1.0 (contact: tests)",
    timeoutMs: 1000,
    recorder,
    fetchImpl: f.impl,
    sleep: async (ms) => void sleeps.push(ms),
    ...extra,
  });
  return { http, recorder, sleeps, ...f };
}
const Shape = z.object({ n: z.number() });

describe("ProviderHttp", () => {
  it("returns validated data, sends the identifying User-Agent and records the call", async () => {
    let ua = "";
    const f = fakeFetch((_u) => json({ n: 7 }));
    const orig = f.impl;
    const spy = (async (i: URL, init?: RequestInit) => {
      ua = new Headers(init?.headers).get("user-agent") ?? "";
      return orig(i);
    }) as unknown as typeof fetch;
    const { http, recorder } = client(() => json({ n: 7 }), { fetchImpl: spy });
    expect(await http.getJson("op", "/x", { a: 1, skip: undefined }, { schema: Shape })).toEqual({ n: 7 });
    expect(ua).toContain("AVISHKAR-tests");
    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0]).toMatchObject({ provider: "test", operation: "op", ok: true, statusCode: 200 });
  });

  it("POSTs a JSON body with a content type and validates the reply", async () => {
    let seen: { method?: string; body?: string; type?: string | null } = {};
    const { http } = client(() => json({ n: 5 }), {
      fetchImpl: (async (_i: URL | string, init?: RequestInit) => {
        seen = { method: init?.method, body: init?.body as string, type: new Headers(init?.headers).get("content-type") };
        return json({ n: 5 });
      }) as typeof fetch,
    });
    expect(await http.postJson("search", "/search", { a: [1, 2] }, { schema: Shape })).toEqual({ n: 5 });
    expect(seen).toEqual({ method: "POST", body: '{"a":[1,2]}', type: "application/json" });
  });

  it("builds the URL from base, path and query without undefined values", async () => {
    const { http, urls } = client(() => json({ n: 1 }));
    await http.getJson("op", "/search", { q: "a b", limit: 2, skip: undefined }, { schema: Shape });
    expect(urls[0]!.toString()).toBe("https://example.test/api/search?q=a+b&limit=2");
  });

  it("retries a 503 and succeeds, recording the failed attempt and the success", async () => {
    const { http, recorder, sleeps } = client((_u, n) => (n === 1 ? json({}, 503) : json({ n: 2 })));
    expect(await http.getJson("op", "/x", {}, { schema: Shape })).toEqual({ n: 2 });
    expect(recorder.calls.map((c) => c.ok)).toEqual([false, true]);
    expect(sleeps).toEqual([300]);
  });

  it("honours Retry-After on 429", async () => {
    const { http, sleeps } = client((_u, n) => (n === 1 ? json({}, 429, { "retry-after": "2" }) : json({ n: 3 })));
    await http.getJson("op", "/x", {}, { schema: Shape });
    expect(sleeps).toEqual([2000]);
  });

  it("gives up after the retries with PROVIDER_UNAVAILABLE", async () => {
    const { http, recorder } = client(() => json({}, 500), { retries: 2 });
    await expect(http.getJson("op", "/x", {}, { schema: Shape })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", provider: "test" });
    expect(recorder.calls).toHaveLength(3);
    expect(recorder.calls.every((c) => !c.ok)).toBe(true);
  });

  it("does not retry a 4xx and reports PROVIDER_BAD_RESPONSE", async () => {
    const { http, recorder } = client(() => json({}, 404));
    await expect(http.getJson("op", "/x", {}, { schema: Shape })).rejects.toMatchObject({ code: "PROVIDER_BAD_RESPONSE" });
    expect(recorder.calls).toHaveLength(1);
  });

  it("refuses a response that does not match the schema instead of passing it on", async () => {
    const { http } = client(() => json({ n: "seven" }));
    const err = await http.getJson("op", "/x", {}, { schema: Shape }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.code).toBe("PROVIDER_BAD_RESPONSE");
    expect(err.message).toContain("expected shape");
  });

  it("treats a network failure as unavailable", async () => {
    const { http } = client(() => {
      throw new TypeError("fetch failed");
    });
    await expect(http.getJson("op", "/x", {}, { schema: Shape })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });

  it("spaces calls by the provider's minimum interval", async () => {
    let t = 1_000_000;
    const { http, sleeps } = client(() => json({ n: 1 }), { minIntervalMs: 1000, now: () => t, sleep: async (ms) => void ((t += ms), sleeps2.push(ms)) });
    const sleeps2: number[] = [];
    await http.getJson("op", "/x", {}, { schema: Shape });
    await http.getJson("op", "/x", {}, { schema: Shape });
    await http.getJson("op", "/x", {}, { schema: Shape });
    expect(sleeps2).toEqual([1000, 1000]);
    expect(sleeps).toEqual([]);
  });
});

describe("cachedFetch", () => {
  const clock = (iso: string) => () => new Date(iso);

  it("serves a fresh hit without calling the provider", async () => {
    const cache = new MemoryCache();
    await cache.set("k", "p", "cached", 60, new Date("2026-01-01T00:00:00Z"));
    const r = await cachedFetch(cache, "k", "p", 60, async () => "fresh", clock("2026-01-01T00:00:30Z"));
    expect(r).toMatchObject({ value: "cached", fromCache: true, stale: false });
  });

  it("refreshes an expired entry", async () => {
    const cache = new MemoryCache();
    await cache.set("k", "p", "old", 60, new Date("2026-01-01T00:00:00Z"));
    const r = await cachedFetch(cache, "k", "p", 60, async () => "new", clock("2026-01-01T01:00:00Z"));
    expect(r).toMatchObject({ value: "new", fromCache: false, stale: false });
    expect((await cache.get<string>("k"))?.value).toBe("new");
  });

  it("serves the expired entry, marked stale, when the provider fails (never hides the age)", async () => {
    const cache = new MemoryCache();
    await cache.set("k", "p", "old", 60, new Date("2026-01-01T00:00:00Z"));
    const r = await cachedFetch(cache, "k", "p", 60, async () => Promise.reject(new Error("down")), clock("2026-01-01T01:00:00Z"));
    expect(r).toMatchObject({ value: "old", fromCache: true, stale: true });
    expect(r.storedAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("propagates the failure when there is nothing cached", async () => {
    await expect(cachedFetch(new MemoryCache(), "k", "p", 60, async () => Promise.reject(new Error("down")))).rejects.toThrow("down");
  });
});

describe("withFailover", () => {
  const a = { name: "a" };
  const b = { name: "b" };
  it("uses the second provider when the first fails and says why", async () => {
    const r = await withFailover([a, b], "op", async (p) => {
      if (p.name === "a") throw new Error("a is down");
      return "from b";
    });
    expect(r).toMatchObject({ value: "from b", provider: "b" });
    expect(r.failures).toEqual([{ provider: "a", reason: "a is down" }]);
  });
  it("throws one error naming every failure when all fail", async () => {
    const err = await withFailover([a, b], "weather", async (p) => Promise.reject(new Error(`${p.name} failed`))).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toContain("a: a failed");
    expect(err.message).toContain("b: b failed");
  });
});

describe("NominatimGeocoder", () => {
  const place = (over: Record<string, unknown> = {}) => ({
    place_id: 1,
    lat: "12.9767936",
    lon: "77.590082",
    display_name: "Bengaluru, Karnataka, India",
    category: "boundary",
    type: "administrative",
    importance: 0.7,
    boundingbox: ["12.8", "13.1", "77.4", "77.8"],
    osm_type: "relation",
    osm_id: 7902,
    address: { city: "Bengaluru", country: "India" },
    ...over,
  });
  const make = (handler: Handler) => {
    const c = client(handler);
    const cache = new MemoryCache();
    return { geo: new NominatimGeocoder({ http: c.http, cache }), cache, ...c };
  };

  it("searches, labels the result REFERENCE with attribution, and sends the right query", async () => {
    const { geo, urls } = make(() => json([place()]));
    const m = await geo.search("  Bengaluru ", { limit: 3, countryCodes: ["IN"] });
    expect(urls[0]!.searchParams.get("q")).toBe("Bengaluru");
    expect(urls[0]!.searchParams.get("countrycodes")).toBe("in");
    expect(m.provenance).toMatchObject({ status: "REFERENCE", provider: "nominatim", dataType: "geocode_search" });
    expect(m.provenance.notes.join(" ")).toContain("OpenStreetMap");
    expect(m.value).toHaveLength(1);
    expect(m.value![0]).toMatchObject({ latitude: 12.9767936, longitude: 77.590082, kind: "boundary/administrative", boundingBox: [12.8, 13.1, 77.4, 77.8] });
  });

  it("drops a result whose coordinates are impossible rather than showing it", async () => {
    const { geo } = make(() => json([place({ lat: "95", lon: "10" }), place({ place_id: 2, lat: "18.5", lon: "73.8" })]));
    const m = await geo.search("somewhere");
    expect(m.value!.map((r) => r.latitude)).toEqual([18.5]);
  });

  it("keeps one result per display name, the first (most relevant), and still lists different places", async () => {
    const { geo } = make(() =>
      json([
        place({ place_id: 1, osm_type: "node", osm_id: 1, display_name: "Indiranagar, Bengaluru" }),
        place({ place_id: 2, lat: "12.99", osm_type: "way", osm_id: 2, display_name: "indiranagar, bengaluru " }),
        place({ place_id: 3, lat: "13.2", osm_type: "node", osm_id: 3, display_name: "Indiranagar, Lucknow" }),
      ]),
    );
    const m = await geo.search("indiranagar");
    expect(m.value!.map((r) => [r.label, r.osm?.id])).toEqual([
      ["Indiranagar, Bengaluru", 1],
      ["Indiranagar, Lucknow", 3],
    ]);
  });

  it("caches, so the second identical search does not call the provider", async () => {
    const { geo, urls } = make(() => json([place()]));
    await geo.search("Bengaluru");
    await geo.search("bengaluru");
    expect(urls).toHaveLength(1);
  });

  it("serves a stale copy with a plain-language note when the service is down", async () => {
    let down = false;
    const { geo, cache } = make(() => (down ? json({}, 503) : json([place()])));
    await geo.search("Bengaluru", {}, { now: () => new Date("2026-01-01T00:00:00Z") });
    const key = [...(cache as unknown as { m: Map<string, unknown> }).m.keys()][0]!;
    // expire it
    const rec = (await cache.get<unknown>(key))!;
    await cache.set(key, "nominatim", rec.value, 1, new Date("2025-12-01T00:00:00Z"));
    down = true;
    const m = await geo.search("Bengaluru", {}, { now: () => new Date("2026-01-01T00:42:00Z") });
    expect(m.value).toHaveLength(1);
    expect(m.provenance.notes.join(" ")).toContain("did not answer");
  });

  it("reports an unreachable geocoder as an error when nothing is cached", async () => {
    const { geo } = make(() => json({}, 503));
    await expect(geo.search("Bengaluru")).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });

  it("rejects too-short search text and impossible reverse coordinates before calling anyone", async () => {
    const { geo, urls } = make(() => json([]));
    await expect(geo.search("ab")).rejects.toBeInstanceOf(AppError);
    await expect(geo.reverse(120, 10)).rejects.toMatchObject({ code: "INVALID_COORDINATES" });
    expect(urls).toHaveLength(0);
  });

  it("returns null for a reverse lookup in the middle of the ocean", async () => {
    const { geo } = make(() => json({ error: "Unable to geocode" }));
    const m = await geo.reverse(0, -30);
    expect(m.value).toBeNull();
    expect(m.provenance.status).toBe("REFERENCE");
  });
});

describe("positioning sources (spec section 4)", () => {
  it("accepts browser geolocation and never labels it NavIC", () => {
    const c = checkPositionSource("browser-geolocation", { navicEnabled: false });
    expect(c).toMatchObject({ ok: true, info: { label: "Browser geolocation" } });
    expect(describePosition("browser-geolocation", 12.4)).toBe("POSITION SOURCE: Browser geolocation, accuracy 12 m");
    expect(describePosition("browser-geolocation")).toContain("accuracy not reported");
  });
  it("refuses a NavIC label unless a receiver integration is enabled, instead of faking it", () => {
    expect(checkPositionSource("navic", { navicEnabled: false })).toMatchObject({ ok: false });
    expect(checkPositionSource("navic", { navicEnabled: true })).toMatchObject({ ok: true });
  });
  it("rejects unknown sources", () => {
    expect(checkPositionSource("gps-magic", { navicEnabled: true })).toMatchObject({ ok: false });
  });
});

describe("summariseHealth", () => {
  const at = (m: number) => new Date(Date.UTC(2026, 0, 1, 0, m));
  it("is unknown (not healthy) when there are no recent calls", () => {
    expect(summariseHealth("x", [])).toMatchObject({ state: "unknown", calls: 0, p50Ms: null });
  });
  it("is healthy, degraded or down by failure rate", () => {
    const ok = (m: number, ms = 100) => ({ ok: true, latencyMs: ms, error: null, createdAt: at(m) });
    const bad = (m: number) => ({ ok: false, latencyMs: 50, error: "boom", createdAt: at(m) });
    expect(summariseHealth("x", [ok(1), ok(2), ok(3)]).state).toBe("healthy");
    expect(summariseHealth("x", [ok(1), ok(2), bad(3)]).state).toBe("degraded");
    const down = summariseHealth("x", [bad(1), bad(2)]);
    expect(down).toMatchObject({ state: "down", lastError: "boom" });
    expect(summariseHealth("x", [ok(1, 100), ok(2, 300), ok(3, 200)])).toMatchObject({ p50Ms: 200, lastSuccessAt: at(3).toISOString() });
  });
});
