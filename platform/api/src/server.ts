import { existsSync } from "node:fs";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db.js";
import { AnthropicAdapter } from "./copilot/llm.js";
import { buildEngine } from "./engine/index.js";
import { JobRunner, startScheduler } from "./jobs/runner.js";
import { DbCache } from "./providers/cache.js";
import { buildProviders } from "./providers/index.js";
import { DbRecorder } from "./providers/recorder.js";

/**
 * `.env` beside the API, as `.env.example` tells you to make and `platform/api/README`'s `pnpm dev` assumes. Only this
 * entry point reads it: the app factory takes its configuration as an argument, so nothing imported into a test is
 * affected by a file on disk. Variables already in the environment win, which is what a container or a start script
 * expects. `process.loadEnvFile` is Node's own reader, so there is no dependency to keep for it.
 */
function loadDotEnv(): void {
  if (!existsSync(".env")) return;
  try {
    process.loadEnvFile(".env");
  } catch (e) {
    console.error(`.env could not be read: ${e instanceof Error ? e.message : e}`); // eslint-disable-line no-console
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  const cache = new DbCache(db);
  const recorder = new DbRecorder(db, (e) => console.error("provider call telemetry failed", e)); // eslint-disable-line no-console
  const providers = buildProviders(config, { cache, recorder, db });
  const engine = buildEngine(config);
  const llm = config.ANTHROPIC_API_KEY ? new AnthropicAdapter({ apiKey: config.ANTHROPIC_API_KEY, model: config.COPILOT_MODEL }) : null;
  const jobs = new JobRunner({ db, providers, now: () => new Date() });
  const app = await buildApp({ config, db, providers, engine, llm, jobs, now: () => new Date() });
  const scheduler = config.JOBS_ENABLED ? startScheduler(jobs) : null;
  if (scheduler) app.log.info("background jobs are on: checking what is due once a minute");

  const stop = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    scheduler?.stop();
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
