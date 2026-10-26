import { describe, expect, it } from "vitest";
import { BASEMAPS } from "./basemaps";
import { contentSecurityPolicy, securityHeaders, tileOrigin } from "./csp";

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

describe("securityHeaders", () => {
  it("sends the policy with the headers that stop content sniffing, leaking the path to other sites, and sensors nobody asked for", () => {
    const h = Object.fromEntries(securityHeaders({ development: false }).map((x) => [x.key, x.value]));
    expect(h["Content-Security-Policy"]).toContain("default-src 'self'");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Permissions-Policy"]).toContain("geolocation=(self)");
    expect(h["Permissions-Policy"]).toContain("camera=()");
  });
});
