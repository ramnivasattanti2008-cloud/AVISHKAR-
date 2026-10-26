/**
 * Runs the background jobs (spec section 71) and keeps their history (`job_runs`). A run is written when it starts and finished when
 * it ends, so a process that dies mid-job leaves a RUNNING row that stops blocking after half an hour. Two processes (or a manual
 * run and a scheduled one) cannot start the same job at once: the check and the insert happen under a short database lock.
 */
import type { Prisma } from "../generated/prisma/client.js";
import { JOBS, JOB_TIMEOUT_MS, type JobContext, type JobDef } from "./registry.js";
import { STALE_RUNNING_MS, dueIn, isDue, type LastRun } from "./schedule.js";

export type JobRunDto = {
  id: string;
  job: string;
  trigger: "SCHEDULE" | "MANUAL";
  startedAt: string;
  finishedAt: string | null;
  status: "RUNNING" | "OK" | "FAILED" | "SKIPPED";
  seconds: number | null;
  summary: Record<string, unknown> | null;
  error: string | null;
};

const toDto = (r: { id: string; job: string; trigger: "SCHEDULE" | "MANUAL"; startedAt: Date; finishedAt: Date | null; status: JobRunDto["status"]; summary: unknown; error: string | null }): JobRunDto => ({
  id: r.id,
  job: r.job,
  trigger: r.trigger,
  startedAt: r.startedAt.toISOString(),
  finishedAt: r.finishedAt?.toISOString() ?? null,
  status: r.status,
  seconds: r.finishedAt ? Math.round(((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000) * 10) / 10 : null,
  summary: (r.summary as Record<string, unknown> | null) ?? null,
  error: r.error,
});

export interface RunnerDeps extends JobContext {
  defs?: JobDef[];
  /** How long a job may run before it is abandoned. Ten minutes unless a test says otherwise. */
  timeoutMs?: number;
  log?: { info(o: object, m: string): void; warn(o: object, m: string): void };
}

export class JobRunner {
  readonly defs: JobDef[];
  constructor(private readonly deps: RunnerDeps) {
    this.defs = deps.defs ?? JOBS;
  }

  private lastRunOf(name: string): Promise<{ startedAt: Date; status: LastRun["status"] } | null> {
    return this.deps.db.jobRun.findFirst({ where: { job: name, status: { not: "SKIPPED" } }, orderBy: { startedAt: "desc" }, select: { startedAt: true, status: true } });
  }

  /** The jobs that are due now, in the order they are listed. */
  async due(): Promise<JobDef[]> {
    const out: JobDef[] = [];
    for (const d of this.defs) if (isDue(d.schedule, await this.lastRunOf(d.name), this.deps.now())) out.push(d);
    return out;
  }

  /** Everything the admin page shows about each job. */
  async status() {
    const now = this.deps.now();
    return Promise.all(
      this.defs.map(async (d) => {
        const recent = await this.deps.db.jobRun.findMany({ where: { job: d.name }, orderBy: { startedAt: "desc" }, take: 5 });
        const last = await this.lastRunOf(d.name);
        return { name: d.name, description: d.description, everyMinutes: d.schedule.everyMs / 60_000, retryMinutes: d.schedule.retryMs / 60_000, dueInSeconds: Math.round(dueIn(d.schedule, last, now) / 1000), recent: recent.map(toDto) };
      }),
    );
  }

  /** Run every job that is due, one after another. A failing job does not stop the others. */
  async runDue(): Promise<JobRunDto[]> {
    const out: JobRunDto[] = [];
    for (const d of await this.due()) {
      const r = await this.run(d.name, "SCHEDULE", null);
      if (r) out.push(r);
    }
    return out;
  }

  /**
   * Start a run, unless the job is already running. A scheduled run that finds it running does nothing (that is the normal way for
   * two processes to share a schedule); a manual one is recorded as SKIPPED so the person who asked sees why nothing happened.
   */
  async run(name: string, trigger: "SCHEDULE" | "MANUAL", requestedBy: string | null): Promise<JobRunDto | null> {
    const def = this.defs.find((d) => d.name === name);
    if (!def) throw new Error(`No job is called ${name}.`);
    const { db } = this.deps;
    const started = this.deps.now();
    const row = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"job:" + name}))`;
      const last = await tx.jobRun.findFirst({ where: { job: name, status: "RUNNING" }, orderBy: { startedAt: "desc" } });
      if (last && started.getTime() - last.startedAt.getTime() < STALE_RUNNING_MS) {
        if (trigger === "SCHEDULE") return null;
        return tx.jobRun.create({ data: { job: name, trigger, startedAt: started, finishedAt: started, status: "SKIPPED", summary: { reason: "The job is already running." } as Prisma.InputJsonValue, requestedBy } });
      }
      return tx.jobRun.create({ data: { job: name, trigger, startedAt: started, status: "RUNNING", requestedBy } });
    });
    if (!row) return null;
    if (row.status === "SKIPPED") return toDto(row);

    let timer: NodeJS.Timeout | undefined;
    try {
      const summary = await Promise.race([
        def.run(this.deps),
        new Promise<never>((_, rej) => {
          const limit = this.deps.timeoutMs ?? JOB_TIMEOUT_MS;
          timer = setTimeout(() => rej(new Error(`The job took longer than ${limit >= 60_000 ? `${limit / 60_000} minutes` : `${limit / 1000} seconds`} and was abandoned.`)), limit);
        }),
      ]);
      const done = await db.jobRun.update({ where: { id: row.id }, data: { status: "OK", finishedAt: this.deps.now(), summary: summary as Prisma.InputJsonValue } });
      this.deps.log?.info({ job: name, summary }, "job finished");
      return toDto(done);
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 1000) || "The job failed.";
      const done = await db.jobRun.update({ where: { id: row.id }, data: { status: "FAILED", finishedAt: this.deps.now(), error: message } });
      this.deps.log?.warn({ job: name, error: message }, "job failed");
      return toDto(done);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/** Checks once a minute what is due. The timer does not keep the process alive; stop() ends it. */
export function startScheduler(runner: JobRunner, everyMs = 60_000): { stop(): void } {
  let running = false;
  const tick = async () => {
    if (running) return; // a slow pass is not started over
    running = true;
    try {
      await runner.runDue();
    } catch {
      // a failing check must not end the loop; each job already records its own failure
    } finally {
      running = false;
    }
  };
  const handle = setInterval(() => void tick(), everyMs);
  handle.unref();
  void tick();
  return { stop: () => clearInterval(handle) };
}
