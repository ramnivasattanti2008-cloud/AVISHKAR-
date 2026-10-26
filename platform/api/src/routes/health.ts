import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { PROVIDER_NAMES } from "../providers/index.js";
import { providerHealth } from "../providers/recorder.js";

const ProviderHealthSchema = z.object({
  provider: z.string(),
  state: z.enum(["healthy", "degraded", "down", "unknown"]),
  calls: z.number(),
  failures: z.number(),
  p50Ms: z.number().nullable(),
  p95Ms: z.number().nullable(),
  lastSuccessAt: z.string().nullable(),
  lastErrorAt: z.string().nullable(),
  lastError: z.string().nullable(),
});

export const healthRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  app.get(
    "/api/health",
    { schema: { tags: ["system"], summary: "Liveness: the process is up", response: { 200: z.object({ status: z.literal("ok"), time: z.string() }) } } },
    async () => ({ status: "ok" as const, time: deps.now().toISOString() }),
  );

  // Spec section 69: honest system health. "unknown" means no recent traffic, which is not the same as healthy.
  app.get(
    "/api/system/health",
    {
      schema: {
        tags: ["system"],
        summary: "Database and external provider health, from real recent calls",
        response: {
          200: z.object({
            status: z.enum(["ok", "degraded"]),
            database: z.object({ state: z.enum(["healthy", "down"]), postgis: z.string().nullable(), latencyMs: z.number().nullable(), error: z.string().nullable() }),
            providers: z.array(ProviderHealthSchema),
            engine: z.object({ state: z.enum(["healthy", "down", "not_configured"]), version: z.string().nullable(), solver: z.string().nullable(), error: z.string().nullable() }),
            windowMinutes: z.number(),
            generatedAt: z.string(),
          }),
        },
      },
    },
    async () => {
      const t0 = Date.now();
      let database: { state: "healthy" | "down"; postgis: string | null; latencyMs: number | null; error: string | null };
      try {
        const r = await deps.db.$queryRaw<{ v: string }[]>`SELECT postgis_version() AS v`;
        database = { state: "healthy", postgis: r[0]?.v ?? null, latencyMs: Date.now() - t0, error: null };
      } catch (e) {
        database = { state: "down", postgis: null, latencyMs: null, error: e instanceof Error ? e.message.slice(0, 200) : "database error" };
      }
      const providers = database.state === "healthy" ? await providerHealth(deps.db, [...PROVIDER_NAMES], 15, deps.now()) : [];
      let engine: { state: "healthy" | "down" | "not_configured"; version: string | null; solver: string | null; error: string | null } = { state: "not_configured", version: null, solver: null, error: null };
      if (deps.engine) {
        try {
          const h = await deps.engine.health();
          engine = { state: "healthy", version: h.version, solver: `HiGHS ${h.highs}`, error: null };
        } catch (e) {
          engine = { state: "down", version: null, solver: null, error: e instanceof Error ? e.message.slice(0, 200) : "engine error" };
        }
      }
      const degraded = database.state === "down" || engine.state === "down" || providers.some((p) => p.state === "down" || p.state === "degraded");
      return { status: degraded ? ("degraded" as const) : ("ok" as const), database, providers, engine, windowMinutes: 15, generatedAt: deps.now().toISOString() };
    },
  );
};
