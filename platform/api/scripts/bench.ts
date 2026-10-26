/**
 * Measures the response times the specification sets as targets (§77) against a RUNNING API and engine, with a throwaway account it
 * creates for the purpose. It writes real rows to the database the API uses, so point it at a development server, never a shared one.
 *
 *   pnpm -C platform/api dev                         (and the engine, and ENGINE_URL set)
 *   pnpm -C platform/api bench [http://127.0.0.1:8080] [repeats]
 *
 * Targets: API response under 500 ms for cached property queries; optimisation under 3 s for a normal household; a one-year
 * simplified simulation under 5 s. Map load (under 3 s) is a browser measurement, not made here.
 */
import { randomBytes } from "node:crypto";

const base = (process.argv[2] ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const repeats = Math.max(1, Number(process.argv[3] ?? 3));

let cookies = "";
let csrf = "";

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; ms: number; json: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const t0 = performance.now();
  const res = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), cookie: cookies, ...(csrf ? { "x-csrf-token": csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const ms = performance.now() - t0;
  const set = res.headers.getSetCookie();
  if (set.length) {
    const jar = new Map(cookies.split("; ").filter(Boolean).map((c) => [c.split("=")[0]!, c]));
    for (const c of set) jar.set(c.split("=")[0]!, c.split(";")[0]!);
    cookies = [...jar.values()].join("; ");
  }
  let json: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, ms, json };
}

function must<T extends { status: number; json: unknown }>(r: T, what: string): T {
  if (r.status >= 400) throw new Error(`${what} failed: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r;
}

const results: { name: string; target: number | null; ms: number[] }[] = [];
async function time(name: string, target: number | null, run: () => Promise<{ status: number; ms: number; json: unknown }>): Promise<void> {
  const ms: number[] = [];
  for (let i = 0; i < repeats; i++) ms.push(must(await run(), name).ms);
  results.push({ name, target, ms });
}

async function main(): Promise<void> {
  // a throwaway account: the password exists only in this process
  const email = `bench-${Date.now()}@example.com`;
  const password = randomBytes(18).toString("base64url");
  must(await call("POST", "/api/auth/register", { email, password }), "register");
  csrf = decodeURIComponent((cookies.match(/avk_csrf=([^;]+)/) ?? [])[1] ?? "");

  const prop = must(await call("POST", "/api/properties", { name: "Bench home", latitude: 12.9716, longitude: 77.5946, positionSource: "manual" }), "property").json;
  const id = prop.id as string;
  const plan = must(
    await call("POST", "/api/tariffs", { name: "Bench ToD", consumerType: "RESIDENTIAL", touBlocks: [{ startHour: 0, endHour: 6, rate: 4 }, { startHour: 6, endHour: 18, rate: 6 }, { startHour: 18, endHour: 24, rate: 10 }], exportRate: 3, source: "benchmark" }),
    "tariff",
  ).json;
  must(await call("PUT", `/api/properties/${id}/tariff`, { tariffPlanId: plan.id }), "select tariff");

  // 70 days of hourly readings ending yesterday (IST), generated here: a benchmark input, not a claim about any home
  const lines = ["timestamp,usage_kwh"];
  const end = Math.floor((Date.now() + 330 * 60_000) / 86_400_000) * 86_400_000 - 330 * 60_000;
  for (let d = 70; d >= 1; d--) for (let h = 0; h < 24; h++) lines.push(`${new Date(end - d * 86_400_000 + h * 3_600_000 + 330 * 60_000).toISOString().slice(0, 19)}+05:30,${(0.5 + (h >= 18 && h < 22 ? 2 : 0)).toFixed(3)}`);
  must(await call("POST", `/api/properties/${id}/energy/imports`, { csv: lines.join("\n") + "\n", filename: "bench.csv", unit: "kWh" }), "import");
  must(await call("POST", `/api/properties/${id}/solar-systems`, { name: "Roof", capacityKwp: 5, tiltDeg: 13, azimuthDeg: 180 }), "solar");
  must(await call("POST", `/api/properties/${id}/batteries`, { name: "Wall", capacityKwh: 10, maxChargeKw: 5, maxDischargeKw: 5 }), "battery");
  must(await call("POST", `/api/properties/${id}/appliances`, { name: "Fridge", kind: "refrigerator", priority: "CRITICAL", ratedPowerW: 150 }), "appliance");

  // first, uncached calls (they fill the caches), then the repeated ones the targets are about
  must(await call("POST", `/api/properties/${id}/analyze`), "analyze");
  await time("GET property (cached query)", 500, () => call("GET", `/api/properties/${id}`));
  await time("GET properties list", 500, () => call("GET", "/api/properties"));
  await time("GET energy summary", 500, () => call("GET", `/api/properties/${id}/energy`));
  await time("GET energy DNA", 500, () => call("GET", `/api/properties/${id}/energy-dna`));
  await time("GET latest twin", 500, () => call("GET", `/api/properties/${id}/twin`));
  await time("GET solar forecast (engine)", null, () => call("GET", `/api/properties/${id}/solar-forecast`));
  await time("GET load forecast (engine)", null, () => call("GET", `/api/properties/${id}/load-forecast`));
  await time("POST plan, 24 h (optimisation, with the recommendation's re-plans)", 3000, () => call("POST", `/api/properties/${id}/plan`, { mode: "BALANCED", hours: 24 }));
  await time("GET today (stored forecasts and plan)", 500, () => call("GET", `/api/properties/${id}/today`));
  await time("GET resilience", null, () => call("GET", `/api/properties/${id}/resilience`));
  await time("POST cloud-front scenario (two plans)", null, () => call("POST", `/api/properties/${id}/cloud-front`, {}));
  await time("POST what-if, one year (24 typical days)", 5000, () => call("POST", `/api/properties/${id}/scenarios`, { name: "bench", addSolarKwp: 2, costs: { solarInrPerKwp: 50000 } }));
  await time("POST copilot question", null, () => call("POST", `/api/properties/${id}/copilot/ask`, { question: "which tariff am I on" }));
  await time("GET report (Markdown)", null, () => call("GET", `/api/properties/${id}/report`));

  const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
  console.log(`\nResponse times against ${base}, ${repeats} run${repeats === 1 ? "" : "s"} each (median, slowest), milliseconds:\n`); // eslint-disable-line no-console
  for (const r of results) {
    const m = med(r.ms);
    const verdict = r.target === null ? "" : m <= r.target ? `  within ${r.target} ms` : `  OVER the ${r.target} ms target`;
    console.log(`  ${r.name.padEnd(70)} ${String(Math.round(m)).padStart(7)} ${String(Math.round(Math.max(...r.ms))).padStart(7)}${verdict}`); // eslint-disable-line no-console
  }
  console.log(`\nA throwaway account (${email}) and its property were left in the database; delete the account with DELETE /api/account to remove them.`); // eslint-disable-line no-console
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e); // eslint-disable-line no-console
  process.exit(1);
});
