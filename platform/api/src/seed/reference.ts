/**
 * Loads the sourced reference data in the repository's data/ folder into the database: tariff orders (data/tariffs) and
 * policy rules (data/policy). Idempotent: rows carry a stable seed key, so running it again updates them in place. It refuses
 * a file that does not validate, so a typo in a data file stops the seed instead of loading nonsense. Nothing here is
 * invented: every number comes from a file that records its source.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Db } from "../db.js";
import type { Prisma } from "../generated/prisma/client.js";
import { validateShape } from "../tariff/engine.js";
import { CONSUMER_TYPES, EXPORT_RATE_BASES, FixedChargeSchema, METERING_MODES, STATE_CODES } from "../tariff/schemas.js";

export function defaultDataDir(): string {
  // platform/api/{src,dist}/seed -> repository root / data
  return process.env.SEED_DATA_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../data");
}

const isoDate = z.iso.date().nullable();

const TariffFile = z.object({
  name: z.string().min(1),
  source: z.string().min(10, "a tariff file must record its source"),
  tou_blocks: z.array(z.tuple([z.number(), z.number(), z.number()])).min(1),
  export_rate: z.number().nonnegative(),
  p2p_charges: z.number().nonnegative().optional(),
  shortfall_penalty: z.number().nonnegative().optional(),
  p2p_share: z.number().min(0).max(1).optional(),
  meta: z.object({
    state: z.enum(STATE_CODES),
    discom: z.string().nullable(),
    category: z.string().min(1),
    consumerType: z.enum(CONSUMER_TYPES),
    tariffYear: z.string().nullable(),
    effectiveFrom: isoDate,
    effectiveTo: isoDate,
    fixedCharge: FixedChargeSchema.nullable(),
    exportRateBasis: z.enum(EXPORT_RATE_BASES),
    meteringMode: z.enum(METERING_MODES),
    sourceUrl: z.string().nullable().optional(),
    notes: z.array(z.string()),
  }),
});

const PolicyFile = z.object({
  program: z.string().min(1),
  region: z.string().min(2),
  source: z.string().min(10),
  sourceUrl: z.string().nullable().optional(),
  verifiedAt: isoDate,
  effectiveFrom: isoDate,
  effectiveTo: isoDate,
  rules: z
    .array(z.object({ ruleKey: z.string().min(1), appliesTo: z.string().min(1), statedAs: z.string().optional(), notes: z.array(z.string()).default([]) }).loose())
    .min(1),
});

const date = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`) : null);

export interface SeedResult {
  tariffs: string[];
  policyRules: string[];
}

export async function seedReferenceData(db: Db, opts: { dataDir?: string } = {}): Promise<SeedResult> {
  const dir = opts.dataDir ?? defaultDataDir();
  const result: SeedResult = { tariffs: [], policyRules: [] };

  const tariffDir = path.join(dir, "tariffs");
  for (const file of readdirSync(tariffDir).filter((f) => f.endsWith(".json") && f !== "template.json").sort()) {
    const key = `curated:${path.basename(file, ".json")}`;
    const parsed = TariffFile.safeParse(JSON.parse(readFileSync(path.join(tariffDir, file), "utf8")));
    if (!parsed.success) throw new Error(`${file}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    const f = parsed.data;
    const touBlocks = f.tou_blocks.map(([startHour, endHour, rate]) => ({ startHour, endHour, rate }));
    const problems = validateShape({ touBlocks, slabs: null, fixedCharge: f.meta.fixedCharge });
    if (problems.length) throw new Error(`${file}: ${problems.join(" ")}`);
    const data = {
      name: f.name,
      state: f.meta.state,
      discom: f.meta.discom,
      category: f.meta.category,
      consumerType: f.meta.consumerType,
      touBlocks: touBlocks as unknown as Prisma.InputJsonValue,
      fixedChargeInr: f.meta.fixedCharge?.amountInr ?? null,
      fixedChargeBasis: f.meta.fixedCharge?.basis ?? null,
      exportRate: f.export_rate,
      exportRateBasis: f.meta.exportRateBasis,
      meteringMode: f.meta.meteringMode,
      source: f.source,
      sourceUrl: f.meta.sourceUrl ?? null,
      tariffYear: f.meta.tariffYear,
      effectiveFrom: date(f.meta.effectiveFrom),
      effectiveTo: date(f.meta.effectiveTo),
      notes: f.meta.notes as unknown as Prisma.InputJsonValue,
      extras: { p2pCharges: f.p2p_charges ?? null, shortfallPenalty: f.shortfall_penalty ?? null, p2pShare: f.p2p_share ?? null } as unknown as Prisma.InputJsonValue,
    };
    await db.tariffPlan.upsert({ where: { seedKey: key }, create: { seedKey: key, ...data }, update: data });
    result.tariffs.push(key);
  }

  const policyDir = path.join(dir, "policy");
  for (const file of readdirSync(policyDir).filter((f) => f.endsWith(".json")).sort()) {
    const parsed = PolicyFile.safeParse(JSON.parse(readFileSync(path.join(policyDir, file), "utf8")));
    if (!parsed.success) throw new Error(`${file}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    const p = parsed.data;
    for (const r of p.rules) {
      const { ruleKey, appliesTo, statedAs, notes, ...rule } = r;
      const key = `${p.program}:${ruleKey}:${p.region}`;
      const data = {
        program: p.program,
        ruleKey,
        region: p.region,
        appliesTo,
        rule: rule as unknown as Prisma.InputJsonValue,
        statedAs: statedAs ?? null,
        source: p.source,
        sourceUrl: p.sourceUrl ?? null,
        effectiveFrom: date(p.effectiveFrom),
        effectiveTo: date(p.effectiveTo),
        verifiedAt: p.verifiedAt ? new Date(`${p.verifiedAt}T00:00:00Z`) : null,
        notes: notes as unknown as Prisma.InputJsonValue,
      };
      await db.policyRule.upsert({ where: { seedKey: key }, create: { seedKey: key, ...data }, update: data });
      result.policyRules.push(key);
    }
  }
  return result;
}
