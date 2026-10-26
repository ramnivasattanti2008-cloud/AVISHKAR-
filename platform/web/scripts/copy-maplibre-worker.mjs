/**
 * Copies the map library's worker files to public/maplibre/ under their own names.
 *
 * MapLibre starts its tile-decoding worker from a file next to its own module, found by name ("maplibre-gl-worker.mjs"). The
 * bundler renames every asset with a hash in a production build, so that name is not there and the map stays blank with a worker
 * error. Serving the two files unchanged, and telling MapLibre where they are (components/map/MapCanvas.tsx), is what makes the
 * production build draw a map. They are generated: public/maplibre is not committed.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The worker and the shared chunk it imports by relative name. */
export const WORKER_FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

export function copyWorker(destDir) {
  const require = createRequire(import.meta.url);
  const dist = join(dirname(require.resolve("maplibre-gl/package.json")), "dist");
  mkdirSync(destDir, { recursive: true });
  for (const f of WORKER_FILES) {
    const from = join(dist, f);
    if (!existsSync(from)) throw new Error(`maplibre-gl no longer ships ${f}: the map's worker cannot be copied, and the map would stay blank. Update scripts/copy-maplibre-worker.mjs.`);
    copyFileSync(from, join(destDir, f));
  }
  // the worker must still find the shared chunk by the name it imports
  const worker = readFileSync(join(destDir, "maplibre-gl-worker.mjs"), "utf8");
  if (!worker.includes("maplibre-gl-shared.mjs")) throw new Error("The map's worker no longer imports maplibre-gl-shared.mjs: check which files it needs.");
  return WORKER_FILES.map((f) => join(destDir, f));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = copyWorker(resolve(dirname(fileURLToPath(import.meta.url)), "..", "public", "maplibre"));
  console.log(`copied ${out.length} map worker files to public/maplibre`); // eslint-disable-line no-console
}
