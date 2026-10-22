/**
 * The security headers the web app sends (spec section 51). The page may load code only from its own origin, talk only to its own
 * origin and the map tile servers, and not be framed. In production the page loads no inline scripts at all: the one inline script
 * (the theme picker) is replaced by a SHA-256 hash, so Next's own hydration scripts are the only scripts and they carry their own
 * nonce. Inline styles remain allowed because Next injects per-page <style> elements for CSS that cannot be moved to a file.
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

export function contentSecurityPolicy(opts: { development: boolean; tileUrl?: string }): string {
  const customOrigin = tileOrigin(opts.tileUrl);
  const tiles = [...TILE_HOSTS, ...(customOrigin ? [customOrigin] : [])];
  const uniq = [...new Set(tiles)].join(" ");
  const fontSources = ["'self'", "data:", ...(customOrigin ? [customOrigin] : [])].join(" ");

  return [
    "default-src 'self'",
    `script-src 'self'${opts.development ? " 'unsafe-inline' 'unsafe-eval'" : " 'sha256-CziUIgdwQiAXOHBEaXV2OraoUnQkXqcY/0vH3bIKftk='"}`,
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

export function securityHeaders(opts: { development: boolean; tileUrl?: string }): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(opts) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // the position is used only when someone presses 'Locate me'; nothing else here needs a sensor
    { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=(), payment=()" },
  ];
}
