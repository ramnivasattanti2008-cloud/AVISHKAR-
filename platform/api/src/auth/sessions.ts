import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "../db.js";
import type { Role } from "../generated/prisma/client.js";

export const SESSION_COOKIE = "avk_session";
export const CSRF_COOKIE = "avk_csrf";
export const CSRF_HEADER = "x-csrf-token";

export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

/** The cookie token is 32 random bytes; only its SHA-256 is stored, so a database leak does not yield sessions. */
export const newToken = (): string => randomBytes(32).toString("base64url");

/** CSRF token bound to the session: HMAC(secret, tokenHash). Recomputed per request, nothing extra to store. */
export const csrfTokenFor = (secret: string, sessionTokenHash: string): string =>
  createHmac("sha256", secret).update(sessionTokenHash).digest("base64url");

export function csrfMatches(secret: string, sessionTokenHash: string, presented: string | undefined): boolean {
  if (!presented) return false;
  const expected = Buffer.from(csrfTokenFor(secret, sessionTokenHash));
  const got = Buffer.from(presented);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  displayName: string | null;
}

export interface IssuedSession {
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

export async function createSession(db: Db, userId: string, ttlHours: number, userAgent?: string, now = new Date()): Promise<IssuedSession> {
  const token = newToken();
  const tokenHash = sha256(token);
  const expiresAt = new Date(now.getTime() + ttlHours * 3_600_000);
  await db.session.create({ data: { userId, tokenHash, expiresAt, userAgent: userAgent?.slice(0, 300) } });
  return { token, tokenHash, expiresAt };
}

/** Resolve a cookie token to its user, or null when unknown, expired, revoked, or the account was deleted. */
export async function lookupSession(db: Db, token: string, now = new Date()): Promise<{ user: SessionUser; tokenHash: string } | null> {
  const tokenHash = sha256(token);
  const s = await db.session.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!s || s.revokedAt || s.expiresAt <= now || s.user.deletedAt) return null;
  return { tokenHash, user: { id: s.user.id, email: s.user.email, role: s.user.role, displayName: s.user.displayName } };
}

export async function revokeSession(db: Db, tokenHash: string, now = new Date()): Promise<void> {
  await db.session.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: now } });
}

export async function revokeAllSessions(db: Db, userId: string, now = new Date()): Promise<number> {
  const r = await db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
  return r.count;
}
