import type { NextConfig } from "next";
import { staticSecurityHeaders } from "./src/lib/csp";

/**
 * The browser only ever talks to this origin. /api/* is proxied to the AVISHKAR API, so session and CSRF cookies are
 * first-party and no CORS is needed. Set API_URL for a deployed API; the default is the local development server.
 */
const API_URL = process.env.API_URL ?? "http://127.0.0.1:8080";

const config: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
  async headers() {
    // The Content-Security-Policy is NOT here: it carries a per-request nonce, so src/proxy.ts sets it. A second,
    // nonce-less policy on the same response would also be enforced and would block every script the first one allows.
    return [{ source: "/:path*", headers: staticSecurityHeaders() }];
  },
};

export default config;
