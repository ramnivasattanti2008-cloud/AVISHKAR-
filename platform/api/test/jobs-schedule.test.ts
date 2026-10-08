import { describe, expect, it } from "vitest";
import { STALE_RUNNING_MS, dueIn, isDue } from "../src/jobs/schedule.js";

const MIN = 60_000;
const S = { everyMs: 60 * MIN, retryMs: 10 * MIN };
const t0 = new Date("2026-10-08T10:00:00Z");
const after = (ms: number) => new Date(t0.getTime() + ms);

describe("isDue", () => {
  it("runs a job that has never run", () => {
    expect(isDue(S, null, t0)).toBe(true);
    expect(dueIn(S, null, t0)).toBe(0);
  });

  it("waits a whole interval after a success, counted from when it started", () => {
    const last = { startedAt: t0, status: "OK" as const };
    expect(isDue(S, last, after(59 * MIN + 59_000))).toBe(false);
    expect(isDue(S, last, after(60 * MIN))).toBe(true);
    expect(dueIn(S, last, after(45 * MIN))).toBe(15 * MIN);
  });

  it("retries a failure after the shorter wait, not after a whole interval", () => {
    const last = { startedAt: t0, status: "FAILED" as const };
    expect(isDue(S, last, after(9 * MIN))).toBe(false);
    expect(isDue(S, last, after(10 * MIN))).toBe(true);
    expect(dueIn(S, last, after(4 * MIN))).toBe(6 * MIN);
  });

  it("does not start a job that is still running, until it has been running so long that it must have died", () => {
    const last = { startedAt: t0, status: "RUNNING" as const };
    expect(isDue(S, last, after(2 * 60 * MIN))).toBe(true); // a long interval is not what decides this
    expect(isDue(S, last, after(STALE_RUNNING_MS - 1))).toBe(false);
    expect(isDue(S, last, after(STALE_RUNNING_MS))).toBe(true);
    expect(isDue({ everyMs: 5 * MIN, retryMs: MIN }, last, after(10 * MIN))).toBe(false); // a short interval does not pile runs up
  });

  it("treats a skipped run like a success: it did not do the work, but another process had it in hand", () => {
    expect(isDue(S, { startedAt: t0, status: "SKIPPED" }, after(30 * MIN))).toBe(false);
    expect(isDue(S, { startedAt: t0, status: "SKIPPED" }, after(60 * MIN))).toBe(true);
  });
});
