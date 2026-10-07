import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import Fastify, { type FastifyInstance } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { registerAuth } from "./auth/hooks.js";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { AppError } from "./errors.js";
import type { Providers } from "./providers/index.js";
import { accountRoutes } from "./routes/account.js";
import { assetRoutes } from "./routes/assets.js";
import { authRoutes } from "./routes/auth.js";
import { energyRoutes } from "./routes/energy.js";
import { geocodeRoutes } from "./routes/geocode.js";
import { healthRoutes } from "./routes/health.js";
import { policyRoutes } from "./routes/policy.js";
import { propertyRoutes } from "./routes/properties.js";
import { tariffRoutes } from "./routes/tariffs.js";
import { twinRoutes } from "./routes/twin.js";
import { weatherRoutes } from "./routes/weather.js";

export interface AppDeps {
  config: Config;
  db: Db;
  providers: Providers;
  /** Injected so tests control time; production uses the wall clock. */
  now: () => Date;
}

const REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config } = deps;
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: ["req.headers.cookie", "req.headers.authorization", "res.headers['set-cookie']"],
    },
    genReqId: (req) => {
      const h = req.headers["x-request-id"];
      return typeof h === "string" && REQUEST_ID.test(h) ? h : randomUUID();
    },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1_000_000,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet);
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "AVISHKAR API",
        version: "0.1.0",
        description:
          "Location-aware energy intelligence. Every provider-derived value is wrapped with its provenance (provider, time, status). Status LIVE is assigned only to fresh observations.",
      },
      tags: [
        { name: "auth", description: "Accounts and sessions" },
        { name: "account", description: "Export and delete your data" },
        { name: "properties", description: "Saved properties" },
        { name: "geocoding", description: "Address and place search" },
        { name: "weather", description: "Weather and irradiance with provenance" },
        { name: "twin", description: "Energy Twin: versioned snapshot of a property" },
        { name: "tariffs", description: "Electricity tariffs: catalogue from regulator orders, your own, and bill estimates" },
        { name: "energy", description: "Meter data you import, and the Energy DNA built from it" },
        { name: "assets", description: "What a property has: batteries, solar systems, electric vehicles, appliances and their logged runs" },
        { name: "policy", description: "Subsidy and net-metering rules as sourced configuration, and the eligibility calculator" },
        { name: "system", description: "Health" },
      ],
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  });

  app.addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", req.id);
  });

  registerAuth(app, { config, db: deps.db, now: deps.now });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ error: { code: "NOT_FOUND", message: `No route ${req.method} ${req.url.split("?")[0]}.`, requestId: req.id } });
  });

  app.setErrorHandler((err, req, reply) => {
    const requestId = req.id;
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_FAILED",
          // A rule we wrote ourselves (a custom refinement) already says everything in words; a plain type error needs its field.
          message: "The request is not valid: " + err.validation.map((v) => (v.keyword === "custom" ? v.message : `${v.instancePath || "(root)"} ${v.message}`)).join("; "),
          requestId,
          details: err.validation.map((v) => ({ path: v.instancePath, message: v.message })),
        },
      });
    }
    if (isResponseSerializationError(err)) {
      req.log.error({ err }, "response did not match its schema");
      return reply.code(500).send({ error: { code: "INTERNAL", message: "The server produced an invalid response.", requestId } });
    }
    if (err instanceof AppError) {
      if (err.status >= 500) req.log.warn({ err, ...(err.details as object | undefined) }, err.message);
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, requestId, details: err.details } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) {
      return reply.code(429).send({ error: { code: "RATE_LIMITED", message: "Too many requests. Please slow down and try again shortly.", requestId } });
    }
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: { code: "VALIDATION_FAILED", message: err instanceof Error ? err.message : "Bad request.", requestId } });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Something went wrong on our side.", requestId } });
  });

  app.get("/api/openapi.json", { schema: { hide: true } }, async () => app.swagger());

  await app.register(healthRoutes, { deps });
  await app.register(authRoutes, { deps });
  await app.register(accountRoutes, { deps });
  await app.register(geocodeRoutes, { deps });
  await app.register(propertyRoutes, { deps });
  await app.register(weatherRoutes, { deps });
  await app.register(twinRoutes, { deps });
  await app.register(tariffRoutes, { deps });
  await app.register(policyRoutes, { deps });
  await app.register(assetRoutes, { deps });
  await app.register(energyRoutes, { deps });
  return app;
}
