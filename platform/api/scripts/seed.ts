import { existsSync } from "node:fs";
import { createDb } from "../src/db.js";
import { seedReferenceData } from "../src/seed/reference.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");

const db = createDb(url);
try {
  const r = await seedReferenceData(db);
  console.log(`seeded ${r.tariffs.length} tariffs and ${r.policyRules.length} policy rules`); // eslint-disable-line no-console
  for (const k of [...r.tariffs, ...r.policyRules]) console.log(`  ${k}`); // eslint-disable-line no-console
} finally {
  await db.$disconnect();
}
