import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import type { Db } from "../db.js";
import { AppError } from "../errors.js";
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE, type SessionUser, csrfMatches, csrfTokenFor, lookupSession } from "./sessions.js";

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser | null;
    sessionTokenHash: string | null;
  }
  interface FastifyContextConfig {
    /** Set false on the few state-changing routes that run before a session exists (login, register). */
    csrf?: boolean;
  }
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function cookieOptions(config: Config, expires?: Date) {
  return { path: "/", secure: config.cookieSecure, sameSite: "lax" as const, expires };
}

export function setSessionCookies(reply: FastifyReply, config: Config, token: string, tokenHash: string, expiresAt: Date): string {
  const csrf = csrfTokenFor(config.SESSION_SECRET, tokenHash);
  reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions(config, expiresAt), httpOnly: true });
  // Readable by the web app so it can echo the value in a header (double-submit); useless without the session cookie.
  reply.setCookie(CSRF_COOKIE, csrf, { ...cookieOptions(config, expiresAt), httpOnly: false });
  return csrf;
}

export function clearSessionCookies(reply: FastifyReply, config: Config): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/", secure: config.cookieSecure, sameSite: "lax" });
  reply.clearCookie(CSRF_COOKIE, { path: "/", secure: config.cookieSecure, sameSite: "lax" });
}

/** Resolve the session cookie on every request and enforce the CSRF header on state-changing authenticated requests. */
export function registerAuth(app: FastifyInstance, deps: { config: Config; db: Db; now: () => Date }): void {
  app.decorateRequest("user", null);
  app.decorateRequest("sessionTokenHash", null);
  app.addHook("onRequest", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const found = await lookupSession(deps.db, token, deps.now());
    if (!found) {
      clearSessionCookies(reply, deps.config);
      return;
    }
    req.user = found.user;
    req.sessionTokenHash = found.tokenHash;
    if (UNSAFE.has(req.method) && req.routeOptions.config.csrf !== false) {
      const header = req.headers[CSRF_HEADER];
      if (!csrfMatches(deps.config.SESSION_SECRET, found.tokenHash, typeof header === "string" ? header : undefined)) {
        throw new AppError("CSRF_REJECTED", `Missing or invalid ${CSRF_HEADER} header.`);
      }
    }
  });
}

export async function requireUser(req: FastifyRequest): Promise<void> {
  if (!req.user) throw new AppError("UNAUTHENTICATED", "Sign in required.");
}

export async function requireAdmin(req: FastifyRequest): Promise<void> {
  if (!req.user) throw new AppError("UNAUTHENTICATED", "Sign in required.");
  if (req.user.role !== "ADMIN") throw new AppError("FORBIDDEN", "Administrator access required.");
}
