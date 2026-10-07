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
