import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error a plain ES module script with no type declarations
import { WORKER_FILES, copyWorker } from "../../scripts/copy-maplibre-worker.mjs";

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("the map worker files", () => {
  it("are copied under their own names, because MapLibre finds its worker by name and the bundler renames assets", () => {
    const dir = mkdtempSync(join(tmpdir(), "avk-maplibre-"));
    made.push(dir);
    const out: string[] = copyWorker(join(dir, "maplibre"));
    expect(out.map((p) => basename(p))).toEqual(WORKER_FILES);
    expect(WORKER_FILES).toEqual(["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]);
    // the worker imports the shared chunk by that name, so the two must sit side by side
    expect(readFileSync(out[0]!, "utf8")).toContain("maplibre-gl-shared.mjs");
    expect(readFileSync(out[1]!, "utf8").length).toBeGreaterThan(10_000);
  });

  it("is what the map is pointed at: the worker path the page asks for is a file this copy produces", () => {
    const canvas = readFileSync(join(__dirname, "../components/map/MapCanvas.tsx"), "utf8");
    const url = /setWorkerUrl\("([^"]+)"\)/.exec(canvas)?.[1];
    expect(url).toBe("/maplibre/maplibre-gl-worker.mjs");
    expect(WORKER_FILES).toContain(url!.split("/").pop());
  });
});
