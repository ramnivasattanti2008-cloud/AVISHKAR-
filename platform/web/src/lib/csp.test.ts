import { describe, expect, it } from "vitest";
import { BASEMAPS } from "./basemaps";
import { contentSecurityPolicy, staticSecurityHeaders, tileOrigin } from "./csp";

const directive = (csp: string, name: string): string[] => (csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "").split(" ").slice(1);

describe("contentSecurityPolicy", () => {
  const csp = contentSecurityPolicy({ development: false });

  it("lets a page load code and data from its own origin, and not be framed or given plugins", () => {
    expect(directive(csp, "default-src")).toEqual(["'self'"]);
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
    expect(directive(csp, "base-uri")).toEqual(["'self'"]);
    expect(directive(csp, "form-action")).toEqual(["'self'"]);
    expect(directive(csp, "script-src")).not.toContain("'unsafe-eval'"); // only the development server needs eval
    expect(directive(csp, "script-src")).not.toContain("'unsafe-inline'"); // an inline script runs by nonce or not at all
    expect(directive(csp, "script-src")).not.toContain("*");
  });

  it("allows every host the map really takes tiles from, for pictures and for the requests that fetch them, and no other", () => {
    for (const b of BASEMAPS) {
      for (const tile of b.tiles) {
        const origin = new URL(tile.replace(/\{[a-z]\}/g, "x")).origin;
        const covered = directive(csp, "img-src").concat(directive(csp, "connect-src")).some((h) => h === origin || (h.startsWith("https://*.") && origin.endsWith(h.slice("https://*".length))));
        expect(covered, `${origin} (${b.label})`).toBe(true);
      }
    }
    expect(directive(csp, "connect-src").filter((h) => h.startsWith("http"))).toHaveLength(3); // the three tile hosts: nothing else is reachable
  });

  it("lets the map's workers and its images, which are blobs, run", () => {
    expect(directive(csp, "worker-src")).toContain("blob:");
    expect(directive(csp, "img-src")).toContain("blob:");
  });

  it("adds the tile server a deployment chose, so changing provider does not blank the map, and ignores one that is not a web address", () => {
    const own = contentSecurityPolicy({ development: false, tileUrl: "https://tiles.example.com/{z}/{x}/{y}.png" });
    expect(directive(own, "img-src")).toContain("https://tiles.example.com");
    expect(directive(own, "connect-src")).toContain("https://tiles.example.com");
    expect(tileOrigin("javascript:alert(1)")).toBeNull();
    expect(tileOrigin("not a url")).toBeNull();
    expect(tileOrigin(undefined)).toBeNull();
    expect(contentSecurityPolicy({ development: false, tileUrl: "javascript:alert(1)" })).toBe(csp);
  });

  it("allows eval and a websocket only in development, for hot reload", () => {
    const dev = contentSecurityPolicy({ development: true });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(directive(dev, "connect-src")).toContain("ws:");
    expect(directive(csp, "connect-src")).not.toContain("ws:");
  });
});

describe("the nonce", () => {
  /**
   * The policy that actually reaches a browser. Next writes the data a page hydrates from into inline scripts whose
   * contents differ per page and per build, so they can only run by nonce; a fixed hash list left the production app
   * answering HTTP 200 with no working JavaScript at all.
   */
  const withNonce = contentSecurityPolicy({ development: false, nonce: "abc123" });

  it("lets the scripts of this one request run, and says so in the way Next looks for", () => {
    expect(directive(withNonce, "script-src")).toContain("'nonce-abc123'");
    // Next finds the nonce by this exact pattern in the header it is given.
    expect(/'nonce-([^']+)'/.exec(withNonce)?.[1]).toBe("abc123");
  });

  it("lets a trusted script load the rest, which is how Next loads its chunks", () => {
    expect(directive(withNonce, "script-src")).toContain("'strict-dynamic'");
  });

  it("never allows an inline script without the nonce, in either mode", () => {
    expect(directive(withNonce, "script-src")).not.toContain("'unsafe-inline'");
    expect(directive(contentSecurityPolicy({ development: true, nonce: "abc123" }), "script-src")).not.toContain("'unsafe-inline'");
  });

  it("allows no inline script at all when there is no nonce to allow one by", () => {
    const src = directive(contentSecurityPolicy({ development: false }), "script-src");
    expect(src).toEqual(["'self'"]);
  });

  it("keeps inline styles, because a style attribute cannot carry a nonce and cannot run code", () => {
    expect(directive(withNonce, "style-src")).toContain("'unsafe-inline'");
  });

  it("changes with the nonce and nothing else", () => {
    const other = contentSecurityPolicy({ development: false, nonce: "zzz999" });
    expect(other.replace("zzz999", "abc123")).toBe(withNonce);
  });
});

describe("staticSecurityHeaders", () => {
  it("sends the headers that stop content sniffing, leaking the path to other sites, and sensors nobody asked for", () => {
    const h = Object.fromEntries(staticSecurityHeaders().map((x: { key: string; value: string }) => [x.key, x.value]));
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Permissions-Policy"]).toContain("geolocation=(self)");
    expect(h["Permissions-Policy"]).toContain("camera=()");
  });

  it("does not send a policy of its own: a second, nonce-less one would block every script the real one allows", () => {
    expect(staticSecurityHeaders().map((x: { key: string }) => x.key)).not.toContain("Content-Security-Policy");
  });
});

describe("a tile URL that is present but blank", () => {
  /**
   * `docker-compose.yml` passes `NEXT_PUBLIC_OSM_TILE_URL: ${NEXT_PUBLIC_OSM_TILE_URL:-}`, which is an empty
   * string when the operator has not chosen a tile service. An empty string used to become the tile URL, so the
   * map asked its own origin for `/{z}/{x}/{y}.png`, got Next's 404 page, and could not decode it as an image:
   * a blank basemap in every containerised deployment. The policy has to keep covering the real hosts whichever
   * way the variable arrives.
   */
  it("leaves the public tile hosts in the policy", () => {
    const csp = contentSecurityPolicy({ development: false, tileUrl: ["", "   "] });
    expect(directive(csp, "img-src")).toContain("https://tile.openstreetmap.org");
    expect(directive(csp, "connect-src")).toContain("https://tile.openstreetmap.org");
  });

  it("adds no empty or whitespace origin to the policy", () => {
    const csp = contentSecurityPolicy({ development: false, tileUrl: ["", "   ", "not a url"] });
    for (const d of ["img-src", "connect-src", "font-src"]) {
      expect(directive(csp, d).filter((v) => v.trim() === "")).toEqual([]);
    }
  });
});
