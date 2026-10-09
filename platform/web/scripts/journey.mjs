/**
 * An end-to-end journey over HTTP through a RUNNING web app: the browser's path, not the API's.
 *
 *   pnpm -C platform/web journey [http://127.0.0.1:3000] [--no-providers]
 *
 * Everything goes through the web origin and its /api proxy, with the session cookie and the CSRF token handled the way a browser
 * handles them, so it exercises what neither the component tests (which stub fetch) nor the API tests (which inject into Fastify)
 * can: the proxy, the cookies, the CSRF check, the real routes and the real database behind them.
 *
 * `--no-providers` stops before the steps that would call the public weather, solar and map services. CI uses it: this project does
 * not call live providers from CI (they are rate-limited and would make the build flaky), so the forecast, plan and Copilot steps
 * are run by hand against a local stack instead. The script says which steps it skipped and why, so a green run is never mistaken
 * for a fuller one than it was.
 *
 * It creates a throwaway account and deletes it at the end, leaving nothing behind.
 */
const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith("--")) ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const withProviders = !args.includes("--no-providers");

const jar = new Map();
let skipped = 0;
const log = (s) => console.log(s); // eslint-disable-line no-console

function remember(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    const name = pair.slice(0, i);
    const value = pair.slice(i + 1);
    if (value === "" || /expires=thu, 01 jan 1970/i.test(c)) jar.delete(name);
    else jar.set(name, value);
  }
}

async function call(method, path, body, accept = "application/json") {
  const headers = { accept, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && jar.has("avk_csrf")) headers["x-csrf-token"] = jar.get("avk_csrf");
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  remember(res);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON: a page or the report */
  }
  return { status: res.status, headers: res.headers, text, json };
}

function check(what, ok, detail = "") {
  if (!ok) {
    log(`FAIL  ${what}${detail ? `: ${detail}` : ""}`);
    process.exit(1);
  }
  log(`ok    ${what}`);
}

/** Readings generated here with a known pattern, so the journey needs nobody's meter data. */
function meterCsv(days = 70) {
  const p2 = (n) => String(n).padStart(2, "0");
  const lines = ["timestamp,Energy (kWh)"];
  const midnight = new Date(Date.now() + 5.5 * 3600e3);
  midnight.setUTCHours(0, 0, 0, 0);
  for (let d = days; d >= 1; d--) {
    for (let h = 0; h < 24; h++) {
      const t = new Date(midnight.getTime() - d * 86400e3 + h * 3600e3);
      const kw = h >= 18 && h < 23 ? 1.5 : h >= 7 && h < 17 ? 0.45 : 0.3;
      lines.push(`${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}T${p2(h)}:00:00+05:30,${kw.toFixed(3)}`);
    }
  }
  return lines.join("\n");
}

log(`Journey through ${base}${withProviders ? "" : " (--no-providers: the steps that would call the public services are skipped)"}\n`);

// ---- the pages a visitor sees before signing in
for (const path of ["/", "/login", "/register"]) {
  const r = await call("GET", path, undefined, "text/html");
  check(`GET ${path} is a page`, r.status === 200 && /<html/i.test(r.text), `HTTP ${r.status}`);
}

// ---- a throwaway account, through the proxy
const email = `journey-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.invalid`;
const password = `j-${crypto.randomUUID()}-Aa1`;
const reg = await call("POST", "/api/auth/register", { email, password, displayName: "Journey" });
check("register through /api", reg.status === 201 && reg.json?.user?.email === email, `HTTP ${reg.status} ${reg.text.slice(0, 160)}`);
check("the session cookie is first-party and the CSRF cookie is set", jar.has("avk_session") && jar.has("avk_csrf"), [...jar.keys()].join(","));

const noCsrf = await fetch(`${base}/api/properties`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie: `avk_session=${jar.get("avk_session")}` },
  body: JSON.stringify({ name: "No CSRF", latitude: 12.9, longitude: 77.6, positionSource: "manual" }),
});
check("a write without the CSRF header is refused", noCsrf.status === 403, `HTTP ${noCsrf.status}`);

// ---- a property, by coordinates, so no geocoder is needed
const prop = await call("POST", "/api/properties", { name: "Journey house", latitude: 12.9784, longitude: 77.6408, positionSource: "manual" });
check("create a property", prop.status === 201 && typeof prop.json?.id === "string", `HTTP ${prop.status} ${prop.text.slice(0, 160)}`);
const id = prop.json.id;

// ---- meter readings, and the Energy DNA built from them
const imported = await call("POST", `/api/properties/${id}/energy/imports`, { csv: meterCsv(), filename: "journey-generated.csv" });
check("import meter readings", imported.status === 201 && imported.json?.import?.accepted === 1680, `HTTP ${imported.status} ${imported.text.slice(0, 200)}`);
check("nothing was refused or repaired", imported.json.import.rejected === 0 && imported.json.import.duplicates === 0);
const summary = await call("GET", `/api/properties/${id}/energy`);
check("an Energy DNA is built from complete days", summary.json?.dna?.period?.completeDays >= 60, JSON.stringify(summary.json?.dna?.period ?? {}).slice(0, 160));

// ---- a tariff the owner enters, and the equipment
const tariff = await call("POST", "/api/tariffs", {
  name: "Journey rates (typed, not a sourced order)",
  consumerType: "RESIDENTIAL",
  touBlocks: [{ startHour: 0, endHour: 7, rate: 4.5 }, { startHour: 7, endHour: 18, rate: 7 }, { startHour: 18, endHour: 24, rate: 10 }],
  exportRate: 3,
  source: "typed by the end-to-end journey; not from a bill",
});
check("create a tariff", tariff.status === 201, `HTTP ${tariff.status} ${tariff.text.slice(0, 160)}`);
check("choose it for the property", (await call("PUT", `/api/properties/${id}/tariff`, { tariffPlanId: tariff.json.id })).status === 200);
check("add a solar system", (await call("POST", `/api/properties/${id}/solar-systems`, { name: "Roof", capacityKwp: 3, tiltDeg: 13, azimuthDeg: 180 })).status === 201);
check("add a battery", (await call("POST", `/api/properties/${id}/batteries`, { name: "Wall", capacityKwh: 8, maxChargeKw: 4, maxDischargeKw: 4 })).status === 201);
check("mark a critical appliance", (await call("POST", `/api/properties/${id}/appliances`, { name: "Fridge", kind: "refrigerator", priority: "CRITICAL", ratedPowerW: 350 })).status === 201);

// ---- the property's own pages render for its owner
for (const path of ["", "/today", "/meter-data", "/assets", "/tariff", "/plan", "/health", "/futures"]) {
  const r = await call("GET", `/property/${id}${path}`, undefined, "text/html");
  check(`GET /property/{id}${path || ""} is a page`, r.status === 200 && /<html/i.test(r.text), `HTTP ${r.status}`);
}

// ---- another account must not see it
const mine = new Map(jar); // both cookies: the CSRF token belongs to the session that was given it
jar.clear();
const otherPassword = `j-${crypto.randomUUID()}-Aa1`;
const other = await call("POST", "/api/auth/register", { email: `journey-other-${Date.now()}@example.invalid`, password: otherPassword });
check("register a second account", other.status === 201);
const peek = await call("GET", `/api/properties/${id}`);
check("the other account cannot see the property", peek.status === 404, `HTTP ${peek.status}`);
const theirs = new Map(jar);

// ---- back to the owner
jar.clear();
for (const [k, v] of mine) jar.set(k, v);

if (withProviders) {
  const solar = await call("GET", `/api/properties/${id}/solar-forecast`);
  check("a solar forecast is made", solar.status === 200 && Array.isArray(solar.json?.hours?.value), `HTTP ${solar.status} ${solar.text.slice(0, 200)}`);
  const load = await call("GET", `/api/properties/${id}/load-forecast`);
  check("a load forecast is made from the readings", load.status === 200, `HTTP ${load.status}`);

  const plan = await call("POST", `/api/properties/${id}/plan`, {});
  check("a plan is made", plan.status === 201, `HTTP ${plan.status} ${plan.text.slice(0, 200)}`);
  check("the plan passed the planner's own check", plan.json?.validation?.valid === true, JSON.stringify(plan.json?.validation ?? {}));
  check("the plan reports a cost against no control", typeof plan.json?.result?.value?.netCostInr === "number" && typeof plan.json.result.value.baselineNetCostInr === "number");

  const ask = await call("POST", `/api/properties/${id}/copilot/ask`, { question: "How much will I save?" });
  check("the Copilot answers from a tool result", ask.status === 200 && ask.json?.status === "ANSWERED" && ask.json.citations.length > 0, `HTTP ${ask.status} ${ask.text.slice(0, 200)}`);
  check("every citation points at a tool result that is there", ask.json.citations.every((c) => ask.json.toolResults.some((t) => t.id === c.toolResultId)));
} else {
  skipped += 2;
  log("skip  the forecast, plan and Copilot steps: they call the public weather and solar services, which this project does not call from CI");
}

// ---- take the data out, then delete the account
const report = await call("GET", `/api/properties/${id}/report`, undefined, "text/markdown");
check("download the property's report", report.status === 200 && report.text.includes("Journey house") && report.text.length > 1000, `HTTP ${report.status}, ${report.text.length} bytes`);
check("the report is offered as a file", /attachment; filename=/.test(report.headers.get("content-disposition") ?? ""), report.headers.get("content-disposition") ?? "none");

const exported = await call("GET", "/api/account/export");
check("export everything held about the account", exported.status === 200 && exported.json?.user?.email === email, `HTTP ${exported.status}`);
check("the export carries what was entered", exported.json.holdings?.properties?.[0]?.equipment?.batteries?.length === 1 && exported.json.holdings.properties[0].meterReadings.count === 1680);
check("the export holds no other account's data", !JSON.stringify(exported.json).includes("journey-other-"));

const wrong = await call("DELETE", "/api/account", { password: "not-the-password" });
check("deletion needs the right password", wrong.status === 401, `HTTP ${wrong.status}`);
const gone = await call("DELETE", "/api/account", { password });
check("delete the account", gone.status === 204, `HTTP ${gone.status}`);
check("the session is over", (await call("GET", "/api/auth/me")).status === 401);

// ---- and clean up the second account as well
jar.clear();
for (const [k, v] of theirs) jar.set(k, v);
const d = await call("DELETE", "/api/account", { password: otherPassword });
check("delete the second account too, so the journey leaves nothing behind", d.status === 204, `HTTP ${d.status}`);

log(`\nAll good.${skipped > 0 ? ` ${skipped} group(s) of steps were skipped and named above.` : ""}`);
