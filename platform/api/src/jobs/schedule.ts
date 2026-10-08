/**
 * When a background job is due (spec section 71). Pure: the clock and the history are inputs.
 *
 * A job runs when it has never run, or when its interval has passed since the last time it STARTED (not finished: a job that takes
 * ten minutes on a one-hour interval still runs hourly). A job that failed is retried after a shorter wait, so an outage of a
 * provider does not leave the data stale for a whole interval, and does not hammer it either.
 */

export interface JobSchedule {
  /** How often the job runs when it succeeds. */
  everyMs: number;
  /** How long to wait before trying again after a failure. */
  retryMs: number;
}

export interface LastRun {
  startedAt: Date;
  status: "RUNNING" | "OK" | "FAILED" | "SKIPPED";
}

/** A run that has been RUNNING for longer than this is assumed to have died with its process, and no longer blocks the next one. */
export const STALE_RUNNING_MS = 30 * 60_000;

export function isDue(s: JobSchedule, last: LastRun | null, now: Date): boolean {
  if (!last) return true;
  const age = now.getTime() - last.startedAt.getTime();
  switch (last.status) {
    case "RUNNING":
      return age >= STALE_RUNNING_MS;
    case "FAILED":
      return age >= s.retryMs;
    default:
      return age >= s.everyMs;
  }
}

/** Milliseconds until the job is next due, never negative: for the admin page ("next run in about 12 minutes"). */
export function dueIn(s: JobSchedule, last: LastRun | null, now: Date): number {
  if (isDue(s, last, now)) return 0;
  const wait = last!.status === "FAILED" ? s.retryMs : last!.status === "RUNNING" ? STALE_RUNNING_MS : s.everyMs;
  return Math.max(0, last!.startedAt.getTime() + wait - now.getTime());
}
