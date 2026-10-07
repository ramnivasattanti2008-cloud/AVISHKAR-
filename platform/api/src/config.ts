import { z } from "zod";

/**
 * All configuration comes from environment variables (spec section 73). Nothing secret has a default.
 * Provider base URLs default to the public endpoints; keys are optional because the default providers need none.
 */
const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  /** HMAC key for CSRF tokens. At least 32 characters; generate with `openssl rand -base64 48`. */
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(24 * 14),
  /** Cookies are Secure by default in production; set false only for plain-http local development. */
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  CORS_ORIGIN: z.string().optional(),
  /** True only behind a reverse proxy you control, so req.ip (rate limiting, audit log) is the real client address. */
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  /** Identifies this application to public providers (Nominatim and Overpass require it). Include a contact. */
  PROVIDER_USER_AGENT: z
    .string()
    .min(10)
    .default("AVISHKAR/0.1 (+https://github.com/ramnivasattanti2008-cloud/AVISHKAR-)"),
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(10_000),

  GEOCODING_PROVIDER: z.enum(["nominatim"]).default("nominatim"),
  GEOCODING_BASE_URL: z.url().default("https://nominatim.openstreetmap.org"),

  WEATHER_PROVIDER: z.enum(["open-meteo"]).default("open-meteo"),
  WEATHER_BASE_URL: z.url().default("https://api.open-meteo.com"),
  WEATHER_ARCHIVE_BASE_URL: z.url().default("https://archive-api.open-meteo.com"),
  /** Day-ahead forecasts as they were issued for past hours, to measure how wrong the irradiance forecast usually is. */
  FORECAST_HISTORY_BASE_URL: z.url().default("https://previous-runs-api.open-meteo.com"),
  WEATHER_API_KEY: z.string().optional(),

  SOLAR_RESOURCE_PROVIDER: z.enum(["nasa-power"]).default("nasa-power"),
  SOLAR_RESOURCE_BASE_URL: z.url().default("https://power.larc.nasa.gov"),

  BUILDING_FOOTPRINT_PROVIDER: z.enum(["overpass"]).default("overpass"),
  BUILDING_FOOTPRINT_BASE_URL: z.url().default("https://overpass-api.de"),
  /** Comma-separated Overpass mirrors tried in order when the primary fails (it does, about one request in three at times). */
  BUILDING_FOOTPRINT_FALLBACK_URLS: z
    .string()
    .default("https://overpass.kumi.systems,https://overpass.private.coffee")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.url())),

  SATELLITE_PROVIDER: z.enum(["earth-search"]).default("earth-search"),
  SATELLITE_BASE_URL: z.url().default("https://earth-search.aws.element84.com/v1"),

  /**
   * Set true only when a real NavIC-capable receiver integration exists. Without it the API refuses to label any
   * position as NavIC (spec section 4); browser geolocation is never NavIC.
   */
  NAVIC_RECEIVER_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  /** Map tiles are consumed by the browser, so these are exposed to the web app, not used by the API. */
  MAP_PROVIDER: z.string().default("osm-raster"),

  /** The Python engine (planning, forecasting). Without it plans and model forecasts are UNAVAILABLE, and the API says so. */
  ENGINE_URL: z.url().optional(),
  /** Shared with the engine's ENGINE_API_KEY. At least 16 characters; required in production when ENGINE_URL is set. */
  ENGINE_API_KEY: z.string().min(16, "ENGINE_API_KEY must be at least 16 characters").optional(),
  /** Longer than the engine's own solver time limit (20 s by default, 120 s at most). */
  ENGINE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(60_000),
}).superRefine((v, ctx) => {
  if (v.NODE_ENV === "production" && v.ENGINE_URL && !v.ENGINE_API_KEY) {
    ctx.addIssue({ code: "custom", path: ["ENGINE_API_KEY"], message: "ENGINE_API_KEY is required in production when ENGINE_URL is set" });
  }
});

export type Config = z.infer<typeof Env> & { cookieSecure: boolean };

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid configuration:\n- ${issues.join("\n- ")}`);
    this.name = "ConfigError";
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
  }
  const cfg = parsed.data;
  return { ...cfg, cookieSecure: cfg.COOKIE_SECURE ?? cfg.NODE_ENV === "production" };
}
