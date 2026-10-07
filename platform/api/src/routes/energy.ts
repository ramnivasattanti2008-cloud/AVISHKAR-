import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { ownProperty } from "../assets/service.js";
import { audit } from "../audit.js";
import { requireUser } from "../auth/hooks.js";
import { AppError } from "../errors.js";
import { EnergyDnaSchema, EnergySummarySchema, ImportInput, ImportResultSchema, ImportSchema } from "../energy/schemas.js";
import { deleteImport, energySummary, importMeterData, latestDna, listImports, toDnaDto } from "../energy/service.js";
import { evaluateDueForecasts } from "../forecast/evaluate.js";
import { ErrorResponse } from "../schemas.js";

const P = z.object({ id: z.uuid() });
const PI = z.object({ id: z.uuid(), importId: z.uuid() });

export const energyRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db } = deps;
  const auth = { preHandler: requireUser };
  const errs = { 400: ErrorResponse, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse };

  app.post(
    "/api/properties/:id/energy/imports",
    {
      ...auth,
      // A year of 15-minute readings is about 1.5 MB of text; the limit allows several years. Uploads are also rate-limited.
      bodyLimit: 25_000_000,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["energy"],
        summary: "Import a meter file (CSV)",
        description:
          "Needs a timestamp column and one usage column. The unit is read from the header (kWh, Wh, kW, W); when the header does not say, you must state it, because a wrong guess is wrong by a factor of four. Nothing is repaired or filled: rows that fail a check are counted under a reason, and gaps stay gaps. Timestamps are the start of each interval; without an offset they are India Standard Time. The same file cannot be imported twice. Afterwards the Energy DNA is rebuilt.",
        params: P,
        body: ImportInput,
        response: { 201: ImportResultSchema, 409: ErrorResponse, ...errs },
      },
    },
    async (req, reply) => {
      const r = await importMeterData(db, req.user!.id, req.params.id, req.body, deps.now());
      // new readings may cover hours that stored forecasts were made for: score them (best effort; the import has succeeded)
      await evaluateDueForecasts(db, req.params.id, deps.now()).catch((e: unknown) => req.log.warn({ err: e }, "scoring stored forecasts failed"));
      await audit(db, { userId: req.user!.id, action: "energy.import", entityType: "property", entityId: req.params.id, requestId: req.id, ip: req.ip, detail: { importId: r.import.id, accepted: r.import.accepted, rejected: r.import.rejected } });
      reply.code(201);
      return r;
    },
  );

  app.get(
    "/api/properties/:id/energy",
    { ...auth, schema: { tags: ["energy"], summary: "What meter data a property has", description: "Coverage, local-day totals (partial days are marked), the imports, and the Energy DNA when there is enough data.", params: P, response: { 200: EnergySummarySchema, ...errs } } },
    async (req) => energySummary(db, req.user!.id, req.params.id),
  );

  app.get("/api/properties/:id/energy/imports", { ...auth, schema: { tags: ["energy"], summary: "Meter files imported for a property", params: P, response: { 200: z.object({ imports: z.array(ImportSchema) }), ...errs } } }, async (req) => ({
    imports: await listImports(db, req.user!.id, req.params.id),
  }));

  app.delete(
    "/api/properties/:id/energy/imports/:importId",
    { ...auth, schema: { tags: ["energy"], summary: "Delete an import and its readings", description: "Removes every reading the file brought and rebuilds the Energy DNA from what remains.", params: PI, response: { 204: z.null(), ...errs } } },
    async (req, reply) => {
      await deleteImport(db, req.user!.id, req.params.id, req.params.importId, deps.now());
      await audit(db, { userId: req.user!.id, action: "energy.import.delete", entityType: "property", entityId: req.params.id, requestId: req.id, ip: req.ip, detail: { importId: req.params.importId } });
      reply.code(204);
      return null;
    },
  );

  app.get(
    "/api/properties/:id/energy-dna",
    { ...auth, schema: { tags: ["energy"], summary: "The Energy DNA of a property", description: "A fingerprint of how it uses electricity, from its own readings only. 404 with the reason when there is not yet enough data.", params: P, response: { 200: EnergyDnaSchema, ...errs } } },
    async (req) => {
      await ownProperty(db, req.user!.id, req.params.id);
      const dna = await latestDna(db, req.params.id);
      if (!dna) {
        const s = await energySummary(db, req.user!.id, req.params.id);
        throw new AppError("NOT_FOUND", s.dnaUnavailableReason ?? "No Energy DNA yet.");
      }
      return toDnaDto(dna);
    },
  );
};
