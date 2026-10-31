/**
 * The security headers the web app sends (spec section 51). The page may load code only from its own origin, talk only to its own
 * origin and the map tile servers, and not be framed.
 *
 * Scripts run by **nonce**, which `src/proxy.ts` makes afresh for every request and Next then puts on its own script tags.
 * An earlier version listed one SHA-256 hash instead -- the hash of the theme script, which never changes. That could not
 * work, and the production app was not interactive because of it: Next's App Router writes the data a page hydrates from
 * into two further inline scripts whose contents differ per page and per build, so no fixed list of hashes can cover them.
 * The browser blocked them, React could not hydrate (error #412), and every page was dead while still answering HTTP 200.
 * `pnpm browser` is the check that sees this; `pnpm smoke` only sees that a policy was sent.
 *
 * `'strict-dynamic'` goes with the nonce: a script the browser trusted may load more scripts, which is how Next loads its
 * chunks, and `'self'` and any host list stop applying to scripts. Both are kept in the list anyway, for a browser too old
 * to know `'strict-dynamic'`.
 *
 * `style-src` keeps `'unsafe-inline'`: React writes `style` attributes for anything positioned from data (the charts, the
 * energy-flow bars), and a style attribute cannot carry a nonce. Injected CSS cannot run code, so this is a much smaller
 * thing to allow than an inline script.
 *
 * Kept free of imports so next.config.ts can use it.
 */

export const TILE_HOSTS = ["https://tile.openstreetmap.org", "https://server.arcgisonline.com", "https://*.tile.opentopomap.org"] as const;

/** The origin of a tile URL the deployment chose (NEXT_PUBLIC_OSM_TILE_URL / NEXT_PUBLIC_MAP_TILE_URL), so switching provider does not blank the map. */
export function tileOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.replace(/\{[a-z]\}/g, "x"));
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * The script sources for one request. With a nonce, only the scripts carrying it run, and `'strict-dynamic'` lets those
 * load the rest. Without one -- a response the proxy did not render, such as a static asset -- no inline script is
 * allowed at all, which is the safe answer for a file that has none.
 */
function scriptSrc(opts: { development: boolean; nonce?: string }): string {
  const parts = ["'self'"];
  if (opts.nonce) parts.push(`'nonce-${opts.nonce}'`, "'strict-dynamic'");
  // React uses eval in development to rebuild server stacks in the browser. Production needs none.
  if (opts.development) parts.push("'unsafe-eval'");
  return `script-src ${parts.join(" ")}`;
}

export function contentSecurityPolicy(opts: { development: boolean; tileUrl?: string | string[]; nonce?: string }): string {
  const urls = Array.isArray(opts.tileUrl) ? opts.tileUrl : opts.tileUrl ? [opts.tileUrl] : [];
  const customOrigins = urls.map(tileOrigin).filter((o): o is string => Boolean(o));
  const tiles = [...TILE_HOSTS, ...customOrigins];
  const uniq = [...new Set(tiles)].join(" ");
  const fontSources = ["'self'", "data:", ...customOrigins].join(" ");

  return [
    "default-src 'self'",
    scriptSrc(opts),
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${uniq}`,
    `connect-src 'self' ${uniq}${opts.development ? " ws:" : ""}`,
    "worker-src 'self' blob:",
    `font-src ${fontSources}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * The headers that do not depend on the request. The policy itself is not among them: it carries a per-request nonce, so
 * `src/proxy.ts` sets it. Two Content-Security-Policy headers on one response are both enforced, and a static one without
 * the nonce would block every script the nonced one allows, so next.config.ts must not send one as well.
 */
export function staticSecurityHeaders(): { key: string; value: string }[] {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // the position is used only when someone presses 'Locate me'; nothing else here needs a sensor
    { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=(), payment=()" },
  ];
}
