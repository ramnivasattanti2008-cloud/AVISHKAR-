/**
 * The Content-Security-Policy, made afresh for every request so it can carry a nonce (Next 16 calls this file `proxy.ts`;
 * it is what earlier versions called middleware).
 *
 * Next applies the nonce to its own script tags -- the framework runtime, each page's chunks and the inline scripts that
 * carry the data a page hydrates from -- by reading it out of the `Content-Security-Policy` header on the request. So the
 * nonce is set on the request headers as well as the response, and the layout reads it from `x-nonce` for the one inline
 * script of our own.
 *
 * This is why `src/lib/csp.ts` no longer lists a script hash: Next's hydration scripts differ per page and per build, and
 * a fixed hash list left the production app serving every page with HTTP 200 and no working JavaScript at all.
 *
 * Using a nonce means a page cannot be prerendered at build time, because there is no request to take a nonce from. The
 * root layout reads `headers()`, which puts every page on per-request rendering. Nothing here does server-side work worth
 * prerendering: each page fetches from /api in the browser.
 */
import { type NextRequest, NextResponse } from "next/server";
import { contentSecurityPolicy } from "./lib/csp";

const TILE_URLS = [process.env.NEXT_PUBLIC_MAP_TILE_URL, process.env.NEXT_PUBLIC_OSM_TILE_URL, process.env.NEXT_PUBLIC_SATELLITE_TILE_URL].filter(Boolean) as string[];

export function proxy(request: NextRequest): NextResponse {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = contentSecurityPolicy({
    development: process.env.NODE_ENV !== "production",
    tileUrl: TILE_URLS.length > 0 ? TILE_URLS : undefined,
    nonce,
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next reads the nonce from this header on the request while it renders.
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Every page. Not /api (proxied to the API, which sends its own headers), and not the build's own static files or
      // the favicon, which contain no script to govern.
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      // A prefetch from next/link fetches an RSC payload, not a document, so it needs no policy of its own.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
