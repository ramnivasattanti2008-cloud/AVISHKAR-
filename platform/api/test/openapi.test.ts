import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildOpenApi, stringifyStable } from "../src/openapi.js";

describe("OpenAPI contract", () => {
  it("matches the committed openapi.json (run `pnpm -C platform/api openapi` after changing a route)", async () => {
    const generated = stringifyStable(await buildOpenApi());
    expect(generated).toBe(readFileSync("openapi.json", "utf8").replace(/\r\n/g, "\n"));
  });

  it("documents every route with a summary, tags and an error response", async () => {
    const doc = (await buildOpenApi()) as { paths: Record<string, Record<string, { summary?: string; tags?: string[]; responses: Record<string, unknown> }>> };
    for (const [path, methods] of Object.entries(doc.paths)) {
      // never fail by design: the document itself, liveness, and health (a down database is reported as degraded, with a 200)
      if (["/api/openapi.json", "/api/health", "/api/system/health"].includes(path)) continue;
      for (const [method, op] of Object.entries(methods)) {
        expect(op.summary, `${method.toUpperCase()} ${path} needs a summary`).toBeTruthy();
        expect(op.tags?.length, `${method.toUpperCase()} ${path} needs tags`).toBeGreaterThan(0);
        expect(Object.keys(op.responses).some((c) => Number(c) >= 400), `${method.toUpperCase()} ${path} documents no error response`).toBe(true);
      }
    }
  });
});
