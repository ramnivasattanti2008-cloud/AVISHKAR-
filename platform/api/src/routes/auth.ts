import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { audit } from "../audit.js";
import { clearSessionCookies, requireUser, setSessionCookies } from "../auth/hooks.js";
import { checkPasswordPolicy, dummyHash, hashPassword, verifyPassword } from "../auth/password.js";
import { csrfTokenFor, createSession, revokeSession } from "../auth/sessions.js";
import { AppError } from "../errors.js";
import { ErrorResponse, UserSchema } from "../schemas.js";

const Email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const Credentials = z.object({ email: Email, password: z.string().min(1).max(256) });
const Register = Credentials.extend({ displayName: z.string().trim().min(1).max(80).optional() });
const AuthResponse = z.object({ user: UserSchema, csrfToken: z.string(), expiresAt: z.string() });

const AUTH_LIMIT = { rateLimit: { max: 10, timeWindow: "1 minute" } };

export const authRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const { config, db } = deps;
  const logErr = (e: unknown) => app.log.error({ err: e }, "audit write failed");

  app.post(
    "/api/auth/register",
    {
      config: { csrf: false, ...AUTH_LIMIT },
      schema: { tags: ["auth"], summary: "Create an account and sign in", body: Register, response: { 201: AuthResponse, 400: ErrorResponse, 409: ErrorResponse } },
    },
    async (req, reply) => {
      const { email, password, displayName } = req.body;
      const policy = checkPasswordPolicy(password, email);
      if (!policy.ok) throw new AppError("VALIDATION_FAILED", `Password ${policy.problems.join(", ")}.`, { field: "password", problems: policy.problems });
      if (await db.user.findUnique({ where: { email } })) throw new AppError("EMAIL_TAKEN", "An account with this email already exists.");
      const user = await db.user.create({ data: { email, passwordHash: await hashPassword(password), displayName } });
      const s = await createSession(db, user.id, config.SESSION_TTL_HOURS, req.headers["user-agent"], deps.now());
      const csrfToken = setSessionCookies(reply, config, s.token, s.tokenHash, s.expiresAt);
      await audit(db, { userId: user.id, action: "auth.register", entityType: "user", entityId: user.id, requestId: req.id, ip: req.ip }, logErr);
      reply.code(201);
      return { user: { id: user.id, email: user.email, role: user.role, displayName: user.displayName }, csrfToken, expiresAt: s.expiresAt.toISOString() };
    },
  );

  app.post(
    "/api/auth/login",
    {
      config: { csrf: false, ...AUTH_LIMIT },
      schema: { tags: ["auth"], summary: "Sign in", body: Credentials, response: { 200: AuthResponse, 401: ErrorResponse } },
    },
    async (req, reply) => {
      const { email, password } = req.body;
      const user = await db.user.findUnique({ where: { email } });
      // Always verify against a real hash so an unknown email takes as long as a wrong password.
      const ok = await verifyPassword(user && !user.deletedAt ? user.passwordHash : await dummyHash(), password);
      if (!user || user.deletedAt || !ok) {
        await audit(db, { userId: null, action: "auth.login_failed", requestId: req.id, ip: req.ip, detail: { known: Boolean(user) } }, logErr);
        throw new AppError("INVALID_CREDENTIALS", "Email or password is incorrect.");
      }
      const s = await createSession(db, user.id, config.SESSION_TTL_HOURS, req.headers["user-agent"], deps.now());
      const csrfToken = setSessionCookies(reply, config, s.token, s.tokenHash, s.expiresAt);
      await audit(db, { userId: user.id, action: "auth.login", entityType: "user", entityId: user.id, requestId: req.id, ip: req.ip }, logErr);
      return { user: { id: user.id, email: user.email, role: user.role, displayName: user.displayName }, csrfToken, expiresAt: s.expiresAt.toISOString() };
    },
  );

  app.post(
    "/api/auth/logout",
    { preHandler: requireUser, schema: { tags: ["auth"], summary: "Sign out", response: { 204: z.null(), 401: ErrorResponse, 403: ErrorResponse } } },
    async (req, reply) => {
      if (req.sessionTokenHash) await revokeSession(db, req.sessionTokenHash, deps.now());
      clearSessionCookies(reply, config);
      await audit(db, { userId: req.user!.id, action: "auth.logout", requestId: req.id, ip: req.ip }, logErr);
      reply.code(204);
      return null;
    },
  );

  app.get(
    "/api/auth/me",
    { schema: { tags: ["auth"], summary: "The signed-in user, or 401", response: { 200: z.object({ user: UserSchema, csrfToken: z.string() }), 401: ErrorResponse } } },
    async (req) => {
      if (!req.user || !req.sessionTokenHash) throw new AppError("UNAUTHENTICATED", "Not signed in.");
      return { user: req.user, csrfToken: csrfTokenFor(config.SESSION_SECRET, req.sessionTokenHash) };
    },
  );
};
