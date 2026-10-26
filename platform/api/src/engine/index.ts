import type { Config } from "../config.js";
import { AppError } from "../errors.js";
import { EngineClient } from "./client.js";

export { EngineClient } from "./client.js";

/** The engine client when ENGINE_URL is configured, otherwise null (plans and model forecasts are then UNAVAILABLE). */
export function buildEngine(config: Config, fetchImpl?: typeof fetch): EngineClient | null {
  if (!config.ENGINE_URL) return null;
  return new EngineClient({ baseUrl: config.ENGINE_URL, apiKey: config.ENGINE_API_KEY, timeoutMs: config.ENGINE_TIMEOUT_MS, fetchImpl });
}

/** The client, or the plain "not configured" error that routes return when there is none. */
export function requireEngine(engine: EngineClient | null): EngineClient {
  if (!engine) throw new AppError("ENGINE_UNAVAILABLE", "The planning engine is not configured on this server, so plans and model forecasts are unavailable.", { reason: "ENGINE_URL is not set" });
  return engine;
}
