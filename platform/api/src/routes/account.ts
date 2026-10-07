import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { audit } from "../audit.js";
import { clearSessionCookies, requireUser } from "../auth/hooks.js";
import { verifyPassword } from "../auth/password.js";
import { sha256 } from "../auth/sessions.js";
import { AppError } from "../errors.js";
import { listProperties } from "../properties/service.js";
import { ErrorResponse, PropertySchema, UserSchema } from "../schemas.js";

const ExportResponse = z.object({
  exportedAt: z.string(),
  user: UserSchema.extend({ createdAt: z.string() }),
  properties: z.array(PropertySchema),
  activeSessions: z.number(),
  auditLog: z.array(z.object({ action: z.string(), entityType: z.string().nullable(), entityId: z.string().nullable(), createdAt: z.string() })),
});

export const accountRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db, config } = deps;
  const policy = { navicEnabled: config.NAVIC_RECEIVER_ENABLED };

  // Everything the platform holds about the signed-in user (spec section 50: export mechanism).
  app.get(
    "/api/account/export",
    { preHandler: requireUser, schema: { tags: ["account"], summary: "Download all of your data", response: { 200: ExportResponse, 401: ErrorResponse } } },
    async (req) => {
      const userId = req.user!.id;
      const [user, properties, sessions, audits] = await Promise.all([
        db.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true, displayName: true, role: true, createdAt: true } }),
        listProperties(db, userId, policy, 200),
        db.session.count({ where: { userId, revokedAt: null, expiresAt: { gt: deps.now() } } }),
        db.auditLog.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, take: 1000, select: { action: true, entityType: true, entityId: true, createdAt: true } }),
      ]);
      await audit(db, { userId, action: "account.export", requestId: req.id, ip: req.ip });
      return {
        exportedAt: deps.now().toISOString(),
        user: { ...user, createdAt: user.createdAt.toISOString() },
        properties,
        activeSessions: sessions,
        auditLog: audits.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
      };
    },
  );

  // Real deletion, not a flag: sessions and properties go with the account; audit rows keep only an anonymous marker.
  app.delete(
    "/api/account",
    {
      preHandler: requireUser,
      schema: {
        tags: ["account"],
        summary: "Permanently delete your account and data",
        body: z.object({ password: z.string().min(1).max(256) }),
        response: { 204: z.null(), 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      const u = await db.user.findUniqueOrThrow({ where: { id: req.user!.id } });
      if (!(await verifyPassword(u.passwordHash, req.body.password))) throw new AppError("INVALID_CREDENTIALS", "Password is incorrect.");
      await audit(db, { userId: u.id, action: "account.delete", entityType: "user", entityId: sha256(u.id), requestId: req.id, ip: req.ip });
      await db.user.delete({ where: { id: u.id } });
      clearSessionCookies(reply, config);
      reply.code(204);
      return null;
    },
  );
};
