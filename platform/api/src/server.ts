import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db.js";
import { buildEngine } from "./engine/index.js";
import { DbCache } from "./providers/cache.js";
import { buildProviders } from "./providers/index.js";
import { DbRecorder } from "./providers/recorder.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  const cache = new DbCache(db);
  const recorder = new DbRecorder(db, (e) => console.error("provider call telemetry failed", e)); // eslint-disable-line no-console
  const providers = buildProviders(config, { cache, recorder, db });
  const engine = buildEngine(config);
  const app = await buildApp({ config, db, providers, engine, now: () => new Date() });

  const stop = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    await db.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));

  await app.listen({ host: config.HOST, port: config.PORT });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e); // eslint-disable-line no-console
  process.exit(1);
});
