import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeApi, json } from "@/test/fixtures";
import { useApi } from "./useApi";

afterEach(() => vi.unstubAllGlobals());

describe("useApi", () => {
  it("loads, then returns the answer", async () => {
    vi.stubGlobal("fetch", fakeApi([["GET", "/api/a", () => json({ n: 1 })]]).fetch);
    const { result } = renderHook(() => useApi<{ n: number }>("/api/a"));
    expect(result.current).toMatchObject({ data: null, loading: true });
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));
    expect(result.current.loading).toBe(false);
  });

  it("does nothing, and is not loading, for a null path", () => {
    const api = fakeApi([]);
    vi.stubGlobal("fetch", api.fetch);
    const { result } = renderHook(() => useApi(null));
    expect(result.current).toMatchObject({ data: null, error: null, loading: false });
    expect(api.calls).toHaveLength(0);
  });

  it("reports an error with the server's words", async () => {
    vi.stubGlobal("fetch", fakeApi([["GET", "/api/a", () => json({ error: { code: "NOT_FOUND", message: "No such property." } }, 404)]]).fetch);
    const { result } = renderHook(() => useApi("/api/a"));
    await waitFor(() => expect(result.current.error).toBe("No such property."));
    expect(result.current.data).toBeNull();
  });

  it("keeps showing the previous answer while a reload is in flight, then swaps in the new one", async () => {
    let n = 0;
    let release: (() => void) | undefined;
    vi.stubGlobal(
      "fetch",
      fakeApi([
        [
          "GET",
          "/api/a",
          async () => {
            n++;
            if (n === 2) await new Promise<void>((r) => (release = r));
            return json({ n });
          },
        ],
      ]).fetch,
    );
    const { result } = renderHook(() => useApi<{ n: number }>("/api/a"));
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.data).toEqual({ n: 1 }); // not blanked
    release!();
    await waitFor(() => expect(result.current.data).toEqual({ n: 2 }));
    expect(result.current.loading).toBe(false);
  });

  it("never shows the answer for the old path after the path changes", async () => {
    vi.stubGlobal("fetch", fakeApi([["GET", /^\/api\/(a|b)$/, ({ url }) => json({ from: url.pathname })]]).fetch);
    const { result, rerender } = renderHook(({ p }) => useApi<{ from: string }>(p), { initialProps: { p: "/api/a" } });
    await waitFor(() => expect(result.current.data).toEqual({ from: "/api/a" }));
    rerender({ p: "/api/b" });
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data).toEqual({ from: "/api/b" }));
  });

  it("keeps the previous data when a reload fails, along with the error", async () => {
    let n = 0;
    vi.stubGlobal("fetch", fakeApi([["GET", "/api/a", () => (++n === 1 ? json({ n }) : json({ error: { code: "INTERNAL", message: "Something went wrong on our side." } }, 500))]]).fetch);
    const { result } = renderHook(() => useApi<{ n: number }>("/api/a"));
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.error).toBe("Something went wrong on our side."));
    expect(result.current.data).toEqual({ n: 1 });
  });
});
