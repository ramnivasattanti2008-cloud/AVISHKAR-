/**
 * A smoke test of a RUNNING production build of the web app (`next start`), for CI and for a deploy: the things that only break in a
 * production build, which neither the component tests nor `next build` notice. It needs no API: it fetches pages and static files.
 *
 *   pnpm -C platform/web build && pnpm -C platform/web start &   then   pnpm -C platform/web smoke [http://127.0.0.1:3000]
 *
 * It exists because a production build once drew no map at all: the map library finds its worker by file name, the bundler renamed
 * the file, and the worker was a 404. Nothing but a browser or a request for that file would have said so.
 */
const base = (process.argv[2] ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const failures = [];
const ok = (what) => console.log(`ok    ${what}`); // eslint-disable-line no-console
const bad = (what, why) => {
  failures.push(`${what}: ${why}`);
  console.log(`FAIL  ${what}: ${why}`); // eslint-disable-line no-console
};

async function get(path) {
  const res = await fetch(base + path, { redirect: "manual" });
  return { res, body: await res.text() };
}

async function check(what, fn) {
  try {
    const why = await fn();
    why ? bad(what, why) : ok(what);
  } catch (e) {
    bad(what, e instanceof Error ? e.message : String(e));
  }
}

for (const path of ["/", "/map", "/login", "/register", "/system", "/properties", "/community", "/city", "/account"]) {
  await check(`GET ${path} answers 200 with a page`, async () => {
    const { res, body } = await get(path);
    if (res.status !== 200) return `HTTP ${res.status}`;
    if (!/<html/i.test(body)) return "not an HTML page";
    return null;
  });
}

await check("the map's worker and its shared chunk are served as JavaScript, at the names the library asks for", async () => {
  for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
    const { res, body } = await get(`/maplibre/${f}`);
    if (res.status !== 200) return `${f}: HTTP ${res.status}`;
    if (!/javascript/.test(res.headers.get("content-type") ?? "")) return `${f}: content type ${res.headers.get("content-type")}`;
    if (body.length < 10_000) return `${f}: only ${body.length} bytes`;
  }
  return null;
});

await check("the security headers are sent, with the policy that lets the map take tiles and nothing else load code", async () => {
  const { res } = await get("/map");
  const csp = res.headers.get("content-security-policy") ?? "";
  if (!csp.includes("default-src 'self'")) return "no content-security-policy";
  if (!csp.includes("worker-src 'self' blob:")) return "the policy does not allow the map's worker";
  if (!csp.includes("tile.openstreetmap.org")) return "the policy does not allow the map's tiles";
  if (!csp.includes("frame-ancestors 'none'")) return "the page can be framed";
  if (res.headers.get("x-content-type-options") !== "nosniff") return "no nosniff";
  if (res.headers.get("x-powered-by")) return "x-powered-by is sent";
  return null;
});

await check("an unknown page is a 404, not a blank 200", async () => {
  const { res } = await get("/no-such-page-here");
  return res.status === 404 ? null : `HTTP ${res.status}`;
});

console.log(failures.length ? `\n${failures.length} problem${failures.length === 1 ? "" : "s"}.` : "\nAll good."); // eslint-disable-line no-console
process.exit(failures.length ? 1 : 0);
