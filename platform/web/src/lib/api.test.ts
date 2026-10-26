import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, describeError, readCookie } from "./api";

function respond(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  document.cookie = "avk_csrf=; Max-Age=0; path=/";
});
afterEach(() => vi.unstubAllGlobals());

describe("readCookie", () => {
  it("finds a cookie, decodes it, and returns undefined when absent", () => {
    expect(readCookie("b", "a=1; b=x%20y; c=3")).toBe("x y");
    expect(readCookie("z", "a=1; b=2")).toBeUndefined();
    expect(readCookie("t", "t=a=b=c")).toBe("a=b=c");
  });
});

describe("api", () => {
  it("sends GET with no CSRF header and drops undefined or null query values", async () => {
    document.cookie = "avk_csrf=tok; path=/";
    fetchMock.mockResolvedValue(respond(200, { ok: true }));
    await api("/api/preview", { query: { latitude: 12.5, longitude: 77.5, skip: undefined, none: null, flag: false } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/preview?latitude=12.5&longitude=77.5&flag=false");
    expect(init.method).toBe("GET");
    expect(init.headers["x-csrf-token"]).toBeUndefined();
    expect(init.credentials).toBe("same-origin");
  });

  it("echoes the CSRF cookie on state-changing calls and sends JSON bodies", async () => {
    document.cookie = "avk_csrf=tok123; path=/";
    fetchMock.mockResolvedValue(respond(201, { id: "p1" }));
    const out = await api<{ id: string }>("/api/properties", { method: "POST", body: { name: "Home" } });
    expect(out).toEqual({ id: "p1" });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers["x-csrf-token"]).toBe("tok123");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.body).toBe('{"name":"Home"}');
  });

  it("turns the API error envelope into an ApiError with code, message, details and request id", async () => {
    fetchMock.mockResolvedValue(respond(409, { error: { code: "EMAIL_TAKEN", message: "That email is already registered.", details: { field: "email" }, requestId: "req-1" } }));
    const err = await api("/api/auth/register", { method: "POST", body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: "EMAIL_TAKEN", message: "That email is already registered.", details: { field: "email" }, requestId: "req-1" });
    expect(describeError(err)).toBe("That email is already registered.");
  });

  it("still gives a clear error when the failure body is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 }));
    const err = await api("/api/x").catch((e) => e);
    expect(err).toMatchObject({ status: 502, code: "HTTP_ERROR", message: "The server answered 502." });
  });

  it("returns undefined for 204", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    expect(await api("/api/auth/logout", { method: "POST" })).toBeUndefined();
  });

  it("reports an unreachable server as a NETWORK error, but lets an abort through untouched", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await api("/api/x").catch((e) => e)).toMatchObject({ status: 0, code: "NETWORK" });
    const abort = new DOMException("aborted", "AbortError");
    fetchMock.mockRejectedValueOnce(abort);
    expect(await api("/api/x").catch((e) => e)).toBe(abort);
  });
});

describe("describeError", () => {
  it("handles errors and anything else", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
    expect(describeError("weird")).toBe("Something went wrong.");
  });
});
