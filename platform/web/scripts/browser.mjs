/**
 * The checks only a real browser can make, against a RUNNING production build.
 *
 *   pnpm -C platform/web browser [http://127.0.0.1:3000]
 *
 * The HTTP journey (scripts/journey.mjs) proves the routes, the cookies and the data are right; it cannot see a page. This opens
 * Chromium and looks: does the map actually draw, does each page render its own content, and does anything throw while it does.
 * It exists because a production build once served every page with HTTP 200 and still showed no map at all — the bundler had
 * renamed the file MapLibre starts its worker from, and only a browser would ever have noticed.
 *
 * The first checks only read. The last ones make a throwaway account over HTTP (Playwright's request context shares the browser's
 * cookies), walk the pages a person actually works on, and delete the account again, so nothing is left behind. None of it needs the
 * public weather or solar services.
 */
import { chromium } from "playwright";

const base = (process.argv[2] ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const failures = [];
const skips = [];
const ok = (what) => console.log(`ok    ${what}`); // eslint-disable-line no-console
const bad = (what, why) => {
  failures.push(what);
  console.log(`FAIL  ${what}: ${why}`); // eslint-disable-line no-console
};
/** Not a pass. Printed, counted and named at the end, so a green run never hides a check that did not happen. */
const skip = (what, why) => {
  skips.push(what);
  console.log(`skip  ${what}: ${why}`); // eslint-disable-line no-console
};

/** Thrown by a check that cannot run here at all; it is reported as skipped rather than failed. */
class CannotRunHere extends Error {}

/** Noise a browser produces that says nothing about this app: a tile server refusing a request, an aborted fetch on navigation. */
const IGNORE = [/favicon/i, /net::ERR_ABORTED/, /tile\.openstreetmap|server\.arcgisonline|opentopomap/i, /Failed to load resource: the server responded with a status of 4\d\d/i];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

/** Open a page, collect everything it complains about, and run `check` on it. */
async function visit(path, what, check) {
  const page = await context.newPage();
  const problems = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !IGNORE.some((re) => re.test(m.text()))) problems.push(`console: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => problems.push(`uncaught: ${String(e).slice(0, 200)}`));
  try {
    const res = await page.goto(base + path, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (!res || res.status() !== 200) throw new Error(`HTTP ${res?.status()}`);
    await check(page);
    if (problems.length > 0) throw new Error(problems.join(" | "));
    ok(what);
  } catch (e) {
    if (e instanceof CannotRunHere) skip(what, e.message);
    else bad(what, e instanceof Error ? e.message : String(e));
  } finally {
    await page.close();
  }
}

// The map. Reading the canvas with readPixels is useless here: MapLibre does not preserve its drawing buffer, so a read outside
// the render loop is all zeros whether or not anything was drawn. What does tell the truth is a screenshot before and after a pan:
// a map that draws looks different afterwards, and a blank one looks exactly the same. The tile requests are counted too, so a
// failure says whether the tiles never arrived or the drawing never happened.
await visit("/map", "the map draws tiles in a real browser, and changes when it is panned", async (page) => {
  let tiles = 0;
  page.on("request", (r) => {
    if (/tile\.openstreetmap|server\.arcgisonline|opentopomap/i.test(r.url())) tiles++;
  });
  // A browser with no working WebGL cannot draw this map at all; that is the machine, not the app, so it is a skip and says so.
  const webgl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  });
  if (!webgl) throw new CannotRunHere("this browser has no WebGL, so no map of any kind could be drawn here");
  const canvas = page.locator("canvas.maplibregl-canvas");
  await canvas.waitFor({ state: "visible", timeout: 25_000 });
  await page.waitForTimeout(5000); // let the tiles arrive and paint
  const before = await canvas.screenshot();
  if (tiles === 0) throw new Error("the map asked for no tiles at all: it never started");
  const box = await canvas.boundingBox();
  if (!box || box.width < 200 || box.height < 200) throw new Error(`the canvas is ${box?.width}x${box?.height}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 160, box.y + box.height / 2 - 120, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(4000);
  const after = await canvas.screenshot();
  if (before.equals(after)) throw new Error(`the map looks identical after panning (${tiles} tile requests): nothing is being drawn`);
});

// Each public page renders its own content, with nothing thrown on the way.
for (const [path, heading] of [["/", /Your energy/i], ["/login", /Sign in/i], ["/register", /account/i], ["/system", /health|system/i], ["/community", /Community/i]]) {
  await visit(path, `GET ${path} renders in a browser`, async (page) => {
    await page.locator("h1").first().waitFor({ state: "visible", timeout: 15_000 });
    const text = await page.locator("main").innerText();
    if (!heading.test(text)) throw new Error(`the page does not read as expected: ${text.slice(0, 120).replace(/\s+/g, " ")}`);
  });
}

// A page behind sign-in must send the visitor to sign in, not break.
await visit("/account", "a page that needs an account asks a visitor to sign in", async (page) => {
  await page.locator("#main").getByRole("link", { name: "Sign in" }).waitFor({ state: "visible", timeout: 15_000 }); // the nav has one too
});

// The skip link is the first thing a keyboard reaches, and it goes to the content.
await visit("/", "the keyboard reaches the skip link first, and it points at the content", async (page) => {
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => ({ text: document.activeElement?.textContent?.trim() ?? "", href: document.activeElement?.getAttribute("href") ?? "" }));
  if (!/skip to content/i.test(focused.text)) throw new Error(`the first stop is "${focused.text}"`);
  if (focused.href !== "#main") throw new Error(`it points at ${focused.href}`);
  if ((await page.locator("#main").count()) !== 1) throw new Error("there is no #main for it to point at");
});

// Dark theme is a real theme, not a filter: the page's own background must change.
await visit("/", "the theme switch changes the page, and the choice survives a reload", async (page) => {
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const before = await bg();
  await page.getByRole("button", { name: /Switch to (dark|light) theme/ }).click();
  await page.waitForTimeout(400);
  const after = await bg();
  if (before === after) throw new Error(`the background stayed ${before}`);
  const chosen = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
  if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== chosen) throw new Error("the choice was forgotten on reload");
});

// ---------------------------------------------------------------- signed in
//
// The pages a person actually works on can only be reached with an account. Playwright's request context shares its cookies with
// the browser, so the account is made over HTTP and then the browser walks the pages as that person. Nothing here needs the public
// weather or solar services, so it runs in CI too; the account is deleted at the end.
const api = context.request;
const email = `browser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.invalid`;
const password = `b-${crypto.randomUUID()}-Aa1`;
const csrf = async () => (await context.cookies()).find((c) => c.name === "avk_csrf")?.value ?? "";
const post = async (path, data) => api.post(base + path, { data, headers: { "x-csrf-token": await csrf() } });

let signedIn = false;
let propertyId = "";
try {
  const reg = await api.post(`${base}/api/auth/register`, { data: { email, password, displayName: "Browser walk" } });
  if (!reg.ok()) throw new Error(`register: HTTP ${reg.status()}`);
  const prop = await post("/api/properties", { name: "Browser walk house", latitude: 12.9784, longitude: 77.6408, positionSource: "manual" });
  if (!prop.ok()) throw new Error(`property: HTTP ${prop.status()}`);
  propertyId = (await prop.json()).id;

  // readings generated here, so the pages have something real of the owner's to draw
  const p2 = (n) => String(n).padStart(2, "0");
  const lines = ["timestamp,Energy (kWh)"];
  const midnight = new Date(Date.now() + 5.5 * 3600e3);
  midnight.setUTCHours(0, 0, 0, 0);
  for (let d = 40; d >= 1; d--) {
    for (let h = 0; h < 24; h++) {
      const t = new Date(midnight.getTime() - d * 86400e3 + h * 3600e3);
      lines.push(`${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}T${p2(h)}:00:00+05:30,${(h >= 18 && h < 23 ? 1.4 : 0.4).toFixed(3)}`);
    }
  }
  const imported = await post(`/api/properties/${propertyId}/energy/imports`, { csv: lines.join("\n"), filename: "browser-walk-generated.csv" });
  if (!imported.ok()) throw new Error(`meter import: HTTP ${imported.status()}`);
  const battery = await post(`/api/properties/${propertyId}/batteries`, { name: "Wall", capacityKwh: 8, maxChargeKw: 4, maxDischargeKw: 4 });
  if (!battery.ok()) throw new Error(`battery: HTTP ${battery.status()}`);
  signedIn = true;
} catch (e) {
  bad("prepare an account for the signed-in walk", e instanceof Error ? e.message : String(e));
}

if (signedIn) {
  await visit("/properties", "signed in: your properties are listed", async (page) => {
    await page.getByRole("link", { name: /Browser walk house/ }).first().waitFor({ state: "visible", timeout: 15_000 });
  });

  await visit(`/property/${propertyId}/meter-data`, "signed in: the meter page draws the readings and the Energy DNA", async (page) => {
    await page.getByText(/960 readings/).first().waitFor({ state: "visible", timeout: 20_000 });
    await page.getByText(/Energy DNA/).first().waitFor({ state: "visible", timeout: 15_000 });
    const charts = await page.locator("main svg").count();
    if (charts === 0) throw new Error("no chart was drawn for the readings");
  });

  await visit(`/property/${propertyId}/assets`, "signed in: the equipment page shows what was entered and what is a default", async (page) => {
    await page.getByText("Wall").first().waitFor({ state: "visible", timeout: 15_000 });
    if ((await page.getByText("DEFAULT").count()) === 0) throw new Error("nothing is marked as a default, so the page is not saying which numbers are assumed");
  });

  await visit(`/property/${propertyId}/health`, "signed in: energy health says there is no plan yet rather than showing a score", async (page) => {
    await page.getByText(/There is no plan yet/).first().waitFor({ state: "visible", timeout: 20_000 });
    const text = await page.locator("main").innerText();
    if (/\d+\s*\/\s*100/.test(text)) throw new Error("a score out of 100 appeared where there is no plan to work one out from");
  });

  await visit(`/property/${propertyId}/futures`, "signed in: the futures page offers the days without claiming any", async (page) => {
    await page.getByRole("button", { name: "Run the futures" }).waitFor({ state: "visible", timeout: 15_000 });
    const text = await page.locator("main").innerText();
    if (!/not\s+predictions/i.test(text)) throw new Error("the page does not say the days are not predictions");
  });

  await visit("/properties/compare", "signed in: the property comparison view renders the portfolio matrix", async (page) => {
    await page.getByText(/Property Comparison Matrix/i).first().waitFor({ state: "visible", timeout: 15_000 });
  });

  await visit(`/property/${propertyId}/planner`, "signed in: the installation planner renders sizing and subsidy calculations", async (page) => {
    await page.getByText(/Installation Sizing & Investment Planner/i).first().waitFor({ state: "visible", timeout: 15_000 });
    await page.getByText(/MNRE Benchmark Model/i).first().waitFor({ state: "visible", timeout: 10_000 });
  });

  // Drawing a roof is the one thing in the product that can only be done with a mouse on a map, so it has never had a test.
  await visit(`/property/${propertyId}`, "signed in: a roof outline can be drawn on the map and is saved", async (page) => {
    const canvas = page.locator("canvas.maplibregl-canvas");
    await canvas.waitFor({ state: "visible", timeout: 25_000 });
    await page.getByRole("button", { name: "Draw roof outline" }).click();
    await page.getByText(/Click each corner, double-click to finish/).waitFor({ state: "visible", timeout: 10_000 });
    await page.waitForTimeout(3000); // the satellite tiles, so the clicks land on a map that has settled

    const box = await canvas.boundingBox();
    if (!box) throw new Error("the map has no box to click in");
    const at = (dx, dy) => ({ x: box.x + box.width / 2 + dx, y: box.y + box.height / 2 + dy });
    const corners = [at(-40, -30), at(40, -30), at(40, 30), at(-40, 30)];
    for (const c of corners) {
      await page.mouse.click(c.x, c.y);
      await page.waitForTimeout(250);
    }
    await page.mouse.dblclick(corners[0].x, corners[0].y); // finish where it began

    await page.getByText(/Roof outline saved/).waitFor({ state: "visible", timeout: 20_000 });
    await page.getByText(/drawn by you, [\d.,]+ m²/).waitFor({ state: "visible", timeout: 15_000 });

    // and the server really has it, with an area a rectangle of that size could have
    const got = await api.get(`${base}/api/properties/${propertyId}`);
    const body = await got.json();
    const mine = (body.geometry.items ?? []).filter((g) => g.kind === "USER_POLYGON");
    if (mine.length !== 1) throw new Error(`the server holds ${mine.length} drawn outlines`);
    if (!(mine[0].areaM2 > 1)) throw new Error(`the stored area is ${mine[0].areaM2} m²`);
  });

  const del = await api.delete(`${base}/api/account`, { data: { password }, headers: { "x-csrf-token": await csrf() } });
  if (del.status() === 204) ok("signed in: the account and everything under it are deleted again");
  else bad("signed in: delete the account again", `HTTP ${del.status()}`);
}

await context.close();
await browser.close();

const tail = skips.length ? ` ${skips.length} check(s) could not run here and are named above.` : "";
console.log(failures.length ? `\n${failures.length} problem${failures.length === 1 ? "" : "s"}.${tail}` : `\nAll good.${tail}`); // eslint-disable-line no-console
process.exit(failures.length ? 1 : 0);
