import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "./csp";
import { THEME_SCRIPT } from "./theme-script";

const directive = (csp: string, name: string): string[] => (csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "").split(" ").slice(1);

describe("THEME_SCRIPT", () => {
  it("can only run by the request's nonce, which the layout puts on its tag", () => {
    // It is an inline script, so the policy must admit it by nonce; nothing else in script-src can let an inline script run.
    const csp = contentSecurityPolicy({ development: false, nonce: "abc123" });
    expect(directive(csp, "script-src")).toContain("'nonce-abc123'");
    expect(directive(csp, "script-src")).not.toContain("'unsafe-inline'");
    // And with no nonce it would not run at all, rather than running under a stale hash.
    expect(directive(contentSecurityPolicy({ development: false }), "script-src")).toEqual(["'self'"]);
  });

  it("only touches our own localStorage and never the network", () => {
    expect(THEME_SCRIPT).toContain('localStorage.getItem("avk-theme")');
    expect(THEME_SCRIPT).not.toMatch(/fetch|XMLHttpRequest|navigator|https?:\/\//);
  });

  it("cannot throw where localStorage is blocked, because a theme must never stop the page loading", () => {
    expect(THEME_SCRIPT.startsWith("try{")).toBe(true);
    expect(THEME_SCRIPT).toContain("catch(e){}");
  });

  it("sets the theme only to a value the stylesheet knows", () => {
    expect(THEME_SCRIPT).toContain('t==="light"||t==="dark"');
  });
});
