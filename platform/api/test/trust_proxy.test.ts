import { expect, it, describe } from "vitest";
import { loadConfig } from "../src/config.js";

describe("TRUST_PROXY parsing", () => {
  it("accepts numeric hop count", () => {
    const cfg = loadConfig({ NODE_ENV: "production", DATABASE_URL: "postgres://u:p@localhost:5432/db", SESSION_SECRET: "x".repeat(32), TRUST_PROXY: "1" });
    expect(cfg.TRUST_PROXY).toBe(1);
  });
  it("accepts true as boolean", () => {
    const cfg = loadConfig({ NODE_ENV: "production", DATABASE_URL: "postgres://u:p@localhost:5432/db", SESSION_SECRET: "x".repeat(32), TRUST_PROXY: "true" });
    expect(cfg.TRUST_PROXY).toBe(true);
  });
  it("accepts false as boolean", () => {
    const cfg = loadConfig({ NODE_ENV: "production", DATABASE_URL: "postgres://u:p@localhost:5432/db", SESSION_SECRET: "x".repeat(32), TRUST_PROXY: "false" });
    expect(cfg.TRUST_PROXY).toBe(false);
  });
  it("defaults to false when omitted", () => {
    const cfg = loadConfig({ NODE_ENV: "production", DATABASE_URL: "postgres://u:p@localhost:5432/db", SESSION_SECRET: "x".repeat(32) });
    expect(cfg.TRUST_PROXY).toBe(false);
  });
});
