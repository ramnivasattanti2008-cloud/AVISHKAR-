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
 * It reads; it does not sign in or write anything, so it needs no account and leaves nothing behind.
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

await context.close();
await browser.close();

const tail = skips.length ? ` ${skips.length} check(s) could not run here and are named above.` : "";
console.log(failures.length ? `\n${failures.length} problem${failures.length === 1 ? "" : "s"}.${tail}` : `\nAll good.${tail}`); // eslint-disable-line no-console
process.exit(failures.length ? 1 : 0);
