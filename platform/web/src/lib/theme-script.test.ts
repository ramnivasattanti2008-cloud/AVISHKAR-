import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { contentSecurityPolicy } from "./csp";
import { THEME_SCRIPT, THEME_SCRIPT_HASH } from "./theme-script";

const directive = (csp: string, name: string): string[] => (csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "").split(" ").slice(1);

describe("THEME_SCRIPT", () => {
  it("is the exact bytes the layout runs, and its hash matches what the production CSP allows", () => {
    // The hash in the CSP source list must equal the SHA-256 of the script the layout actually renders.
    const computed = "sha256-" + crypto.createHash("sha256").update(THEME_SCRIPT).digest("base64");
    expect(THEME_SCRIPT_HASH).toBe(computed);
    const csp = contentSecurityPolicy({ development: false });
    expect(directive(csp, "script-src")).toContain(`'${computed}'`);
  });

  it("only touches our own localStorage and never the network, so a hash is safe here", () => {
    expect(THEME_SCRIPT).toContain("localStorage.getItem(\"avk-theme\")");
    expect(THEME_SCRIPT).not.toMatch(/fetch|XMLHttpRequest|navigator|https?:\/\//);
  });
});
