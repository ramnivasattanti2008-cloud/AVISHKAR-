import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

const valid = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  SESSION_SECRET: "x".repeat(32),
};

describe("loadConfig", () => {
  it("applies defaults for providers and never invents secrets", () => {
    const c = loadConfig({ ...valid });
    expect(c.PORT).toBe(8080);
    expect(c.GEOCODING_PROVIDER).toBe("nominatim");
    expect(c.WEATHER_BASE_URL).toBe("https://api.open-meteo.com");
    expect(c.WEATHER_API_KEY).toBeUndefined();
    expect(c.cookieSecure).toBe(false);
  });

  it("keeps the background jobs off unless they are switched on, and accepts only true or false", () => {
    expect(loadConfig({ ...valid }).JOBS_ENABLED).toBe(false);
    expect(loadConfig({ ...valid, JOBS_ENABLED: "true" }).JOBS_ENABLED).toBe(true);
    expect(() => loadConfig({ ...valid, JOBS_ENABLED: "yes" })).toThrow(ConfigError);
  });

  it("makes cookies Secure in production unless explicitly overridden", () => {
    expect(loadConfig({ ...valid, NODE_ENV: "production" }).cookieSecure).toBe(true);
    expect(loadConfig({ ...valid, NODE_ENV: "production", COOKIE_SECURE: "false" }).cookieSecure).toBe(false);
  });

  it("refuses to start without a database or with a weak session secret, naming each problem", () => {
    try {
      loadConfig({ SESSION_SECRET: "short" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const msg = (e as ConfigError).message;
      expect(msg).toContain("DATABASE_URL");
      expect(msg).toContain("SESSION_SECRET");
    }
  });

  it("rejects an unknown provider and a malformed URL", () => {
    expect(() => loadConfig({ ...valid, GEOCODING_PROVIDER: "made-up" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...valid, WEATHER_BASE_URL: "not a url" })).toThrow(ConfigError);
  });
});

describe("a variable that is present but blank", () => {
  /** `.env.example` leaves every optional key blank, so copying it must not stop the service starting. */
  const base = { DATABASE_URL: "postgresql://u:p@localhost:5432/db", SESSION_SECRET: "x".repeat(32) };

  it("is treated as unset for an optional key", () => {
    const c = loadConfig({ ...base, ANTHROPIC_API_KEY: "", ENGINE_URL: "", ENGINE_API_KEY: "", WEATHER_API_KEY: "", COOKIE_SECURE: "" });
    expect(c.ANTHROPIC_API_KEY).toBeUndefined();
    expect(c.ENGINE_URL).toBeUndefined();
    expect(c.ENGINE_API_KEY).toBeUndefined();
    expect(c.WEATHER_API_KEY).toBeUndefined();
    // COOKIE_SECURE blank falls back to the NODE_ENV default rather than failing its enum.
    expect(c.cookieSecure).toBe(false);
  });

  it("is treated as unset for a key that has a default", () => {
    expect(loadConfig({ ...base, PORT: "", LOG_LEVEL: "", TRUST_PROXY: "" }).PORT).toBe(8080);
    expect(loadConfig({ ...base, LOG_LEVEL: "" }).LOG_LEVEL).toBe("info");
    expect(loadConfig({ ...base, TRUST_PROXY: "" }).TRUST_PROXY).toBe(false);
  });

  it("still fails for a required key, because blank is missing", () => {
    expect(() => loadConfig({ ...base, SESSION_SECRET: "" })).toThrow(/SESSION_SECRET/);
    expect(() => loadConfig({ ...base, DATABASE_URL: "   " })).toThrow(/DATABASE_URL/);
  });

  it("does not accept a value that is wrong rather than blank", () => {
    expect(() => loadConfig({ ...base, ANTHROPIC_API_KEY: "too-short" })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => loadConfig({ ...base, ENGINE_URL: "not-a-url" })).toThrow(/ENGINE_URL/);
  });

  it("accepts the shipped .env.example once a session secret and database are filled in", () => {
    const example = readFileSync("./.env.example", "utf8");
    const env: NodeJS.ProcessEnv = {};
    for (const line of example.split("\n")) {
      const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
      if (m) env[m[1]!] = m[2]!;
    }
    env.DATABASE_URL = base.DATABASE_URL;
    env.SESSION_SECRET = base.SESSION_SECRET;
    expect(() => loadConfig(env)).not.toThrow();
  });
});
