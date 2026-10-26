"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, describeError } from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { AdminAudit, AdminJobs, AdminOverview } from "@/lib/types";
import { useAuth } from "../AuthProvider";

const VALIDITY_TONE: Record<string, string> = { WITHIN: "live", OPEN_ENDED: "updated", EXPIRED: "unavailable", NOT_YET_EFFECTIVE: "estimated", UNKNOWN: "estimated" };
const RUN_TONE = { OK: "live", FAILED: "unavailable", RUNNING: "forecast", SKIPPED: "estimated" } as const;
const PROVIDER_TONE = { healthy: "live", degraded: "updated", down: "unavailable", unknown: "estimated" } as const;

function Count({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num text-lg font-semibold">{typeof value === "number" ? formatNumber(value) : value}</dd>
      {hint && <dd className="text-xs text-muted">{hint}</dd>}
    </div>
  );
}

function dueText(seconds: number): string {
  if (seconds <= 0) return "due now";
  if (seconds < 90) return `in ${seconds} s`;
  if (seconds < 90 * 60) return `in ${Math.round(seconds / 60)} min`;
  return `in ${Math.round(seconds / 3600)} h`;
}

/** What an administrator sees (spec section 92): health, catalogue, models, jobs and the audit log. Counts, never anyone's readings. */
export function AdminView() {
  const { user, loading } = useAuth();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [jobs, setJobs] = useState<AdminJobs | null>(null);
  const [audit, setAudit] = useState<AdminAudit | null>(null);
  const [filter, setFilter] = useState("");
  const [applied, setApplied] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const admin = user?.role === "ADMIN";

  const loadAudit = useCallback((action: string, before?: string, append?: AdminAudit) => {
    return api<AdminAudit>("/api/admin/audit", { query: { limit: 25, action: action || undefined, before } }).then((a) => setAudit(append ? { entries: [...append.entries, ...a.entries], next: a.next } : a));
  }, []);

  useEffect(() => {
    if (!admin) return;
    let live = true;
    Promise.all([api<AdminOverview>("/api/admin/overview"), api<AdminJobs>("/api/admin/jobs"), api<AdminAudit>("/api/admin/audit", { query: { limit: 25 } })])
      .then(([o, j, a]) => {
        if (!live) return;
        setOverview(o);
        setJobs(j);
        setAudit(a);
      })
      .catch((e) => live && setError(describeError(e)));
    return () => {
      live = false;
    };
  }, [admin]);

  async function runJob(name: string) {
    setBusy(name);
    setMessage(null);
    setError(null);
    try {
      const r = await api<{ status: string; error: string | null }>(`/api/admin/jobs/${name}/run`, { method: "POST" });
      setMessage(r.status === "OK" ? `${name} ran.` : r.status === "SKIPPED" ? `${name} was already running, so nothing was started.` : `${name} failed: ${r.error}`);
      setJobs(await api<AdminJobs>("/api/admin/jobs"));
      await loadAudit(applied);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p role="status" className="p-6 text-sm text-muted">Loading…</p>;
  if (!user) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold">Admin</h1>
        <p className="mt-3 text-muted">
          <Link className="font-semibold text-accent underline" href="/login?next=/admin">Sign in</Link> to continue.
        </p>
      </div>
    );
  }
  if (!admin) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold">Admin</h1>
        <p role="alert" className="mt-3 text-muted">This page is for administrators. Your account is not one, and there is no way to become one from the web: it is granted from the command line by whoever runs this server.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <h1 className="text-2xl font-bold">Admin</h1>
      <p className="text-sm text-muted">Health of the data, the catalogue, the models and the providers; the background jobs; the audit log. Counts only: no one&apos;s readings, equipment or plans appear here, and everything you do here is recorded.</p>
      <div aria-live="polite" className="mt-3">
        {error && <p role="alert" className="text-sm text-[color:var(--tone-unavailable-fg)]">{error}</p>}
        {message && <p role="status" className="text-sm">{message}</p>}
      </div>

      {overview && (
        <>
          <section className="card mt-4 p-4" aria-labelledby="adm-data">
            <h2 id="adm-data" className="text-lg font-semibold">Accounts and data</h2>
            <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
              <Count label="Accounts" value={overview.users.total} hint={`${overview.users.admins} administrator${overview.users.admins === 1 ? "" : "s"}, ${overview.users.joinedLast7Days} new this week`} />
              <Count label="Properties" value={overview.properties.total} hint={`${overview.properties.demo} demo`} />
              <Count label="With meter data" value={overview.properties.withMeterData} />
              <Count label="With a tariff" value={overview.properties.withTariff} />
              <Count label="With solar" value={overview.properties.withSolar} />
              <Count label="With a battery" value={overview.properties.withBattery} />
              <Count label="Meter data gone quiet" value={overview.dataHealth.meterDataStale} hint="newest reading over two days old" />
              <Count label="Forecasts awaiting a score" value={overview.dataHealth.forecastsAwaitingScore} />
              <Count label="Forecasts scored" value={overview.dataHealth.forecastsScored} hint={`${overview.dataHealth.forecastsNotScorable} not scorable`} />
              <Count label="On an expired tariff" value={overview.dataHealth.propertiesOnExpiredTariff} hint="properties" />
            </dl>
          </section>

          <section className="card mt-4 p-4" aria-labelledby="adm-prov">
            <h2 id="adm-prov" className="text-lg font-semibold">Providers, last hour</h2>
            <div className="overflow-x-auto">
              <table className="mt-2 w-full text-sm">
                <caption className="sr-only">Outside providers and how their calls went in the last hour</caption>
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th scope="col" className="py-1 pr-3 font-medium">Provider</th>
                    <th scope="col" className="py-1 pr-3 font-medium">State</th>
                    <th scope="col" className="py-1 pr-3 font-medium">Calls</th>
                    <th scope="col" className="py-1 pr-3 font-medium">Failed</th>
                    <th scope="col" className="py-1 pr-3 font-medium">Slowest 5%</th>
                    <th scope="col" className="py-1 font-medium">Last error</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.providers.map((p) => (
                    <tr key={p.provider} className="border-t border-line align-top">
                      <th scope="row" className="py-1.5 pr-3 text-left font-normal">{p.provider}</th>
                      <td className="pr-3"><span className="badge" data-tone={PROVIDER_TONE[p.state]}>{p.state}</span></td>
                      <td className="num pr-3">{p.calls}</td>
                      <td className="num pr-3">{p.failures}</td>
                      <td className="num pr-3">{p.p95Ms === null ? "—" : `${formatNumber(p.p95Ms)} ms`}</td>
                      <td>{p.lastError ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card mt-4 p-4" aria-labelledby="adm-models">
            <h2 id="adm-models" className="text-lg font-semibold">Models</h2>
            <p className="mt-1 text-sm">
              Planning engine:{" "}
              <span className="badge" data-tone={overview.models.engine.state === "healthy" ? "live" : overview.models.engine.state === "down" ? "unavailable" : "estimated"}>{overview.models.engine.state.replace("_", " ")}</span>{" "}
              {overview.models.engine.version && <span className="num">version {overview.models.engine.version}, {overview.models.engine.solver}</span>}
              {overview.models.engine.error && <span> {overview.models.engine.error}</span>}
            </p>
            <div className="overflow-x-auto">
              <table className="mt-2 w-full text-sm">
                <caption className="sr-only">Stored forecasts by kind, model and engine version</caption>
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th scope="col" className="py-1 pr-3 font-medium">Forecast</th>
                    <th scope="col" className="py-1 pr-3 font-medium">Model</th>
                    <th scope="col" className="py-1 pr-3 font-medium">Engine version</th>
                    <th scope="col" className="py-1 font-medium">Stored</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.models.forecastRuns.map((f) => (
                    <tr key={`${f.kind}${f.model}${f.engineVersion}`} className="border-t border-line">
                      <th scope="row" className="py-1.5 pr-3 text-left font-normal">{f.kind}</th>
                      <td className="pr-3">{f.model}</td>
                      <td className="num pr-3">{f.engineVersion}</td>
                      <td className="num">{formatNumber(f.runs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-sm text-muted">Plans by engine version: {Object.entries(overview.models.planRunsByEngineVersion).map(([v, n]) => `${v}: ${n}`).join(", ") || "none yet"}.</p>
          </section>

          <section className="card mt-4 p-4" aria-labelledby="adm-cat">
            <h2 id="adm-cat" className="text-lg font-semibold">Tariff and policy catalogue</h2>
            <p className="mt-1 text-sm text-muted">Loaded from files that name their source and the date they were read. An order whose period has ended is flagged, not hidden.</p>
            <div className="overflow-x-auto">
              <table className="mt-2 w-full text-sm">
                <caption className="sr-only">Curated tariff plans with their validity and source</caption>
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th scope="col" className="py-1 pr-3 font-medium">Plan</th>
                    <th scope="col" className="py-1 pr-3 font-medium">Validity</th>
                    <th scope="col" className="py-1 pr-3 font-medium">Source</th>
                    <th scope="col" className="py-1 pr-3 font-medium">Checked</th>
                    <th scope="col" className="py-1 font-medium">Properties</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.catalogue.tariffs.map((t) => (
                    <tr key={t.id} className="border-t border-line align-top">
                      <th scope="row" className="py-1.5 pr-3 text-left font-normal">{t.name}</th>
                      <td className="pr-3"><span className="badge" data-tone={VALIDITY_TONE[t.validity] ?? "estimated"} title={t.validityMessage}>{t.validity.replace("_", " ")}</span></td>
                      <td className="pr-3">{t.sourceUrl ? <a className="text-accent underline" href={t.sourceUrl} rel="noreferrer noopener">{t.source}</a> : t.source}</td>
                      <td className="pr-3">{t.verifiedAt ? formatDateTime(t.verifiedAt) : "—"}</td>
                      <td className="num">{t.propertiesUsing}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="mt-3 list-disc pl-5 text-sm" aria-label="Policy rules">
              {overview.catalogue.policyRules.map((r) => (
                <li key={r.id}>
                  {r.program}, {r.ruleKey} ({r.region}, {r.appliesTo}): {r.source}
                  {r.verifiedAt ? `, checked ${formatDateTime(r.verifiedAt)}` : ""}
                </li>
              ))}
            </ul>
          </section>

          <section className="card mt-4 p-4" aria-labelledby="adm-use">
            <h2 id="adm-use" className="text-lg font-semibold">Used in the last 7 days</h2>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3 lg:grid-cols-4">
              {Object.entries(overview.usageLast7Days).map(([a, n]) => (
                <div key={a} className="flex justify-between gap-2 border-b border-line py-1">
                  <dt className="truncate">{a}</dt>
                  <dd className="num font-semibold">{formatNumber(n)}</dd>
                </div>
              ))}
            </dl>
          </section>
        </>
      )}

      {jobs && (
        <section className="card mt-4 p-4" aria-labelledby="adm-jobs">
          <h2 id="adm-jobs" className="text-lg font-semibold">Background jobs</h2>
          <p className="mt-1 text-sm text-muted">
            {jobs.schedulerEnabled ? "This server checks once a minute what is due." : "The scheduler is off on this server (JOBS_ENABLED is not true), so jobs run only when started here."}
          </p>
          <ul className="mt-3 grid gap-3">
            {jobs.jobs.map((j) => (
              <li key={j.name} className="rounded-md border border-line p-3" aria-label={j.name}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{j.name}</h3>
                  <button type="button" className="btn" disabled={busy !== null} onClick={() => void runJob(j.name)} aria-label={`Run ${j.name} now`}>
                    {busy === j.name ? "Running…" : "Run now"}
                  </button>
                </div>
                <p className="text-sm text-muted">{j.description}</p>
                <p className="mt-1 text-xs text-muted">Every {formatNumber(j.everyMinutes)} min, retried after {formatNumber(j.retryMinutes)} min on failure. Next: {dueText(j.dueInSeconds)}.</p>
                {j.recent.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-sm" aria-label={`Recent runs of ${j.name}`}>
                    {j.recent.map((r) => (
                      <li key={r.id}>
                        <span className="badge" data-tone={RUN_TONE[r.status]}>{r.status}</span> {formatDateTime(r.startedAt)} {r.trigger === "MANUAL" ? "(by hand)" : ""}
                        {r.seconds !== null ? ` · ${r.seconds} s` : ""}
                        {r.summary ? ` · ${Object.entries(r.summary).map(([k, v]) => `${k} ${String(v)}`).join(", ")}` : ""}
                        {r.error ? ` · ${r.error}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-muted">Never run.</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {audit && (
        <section className="card mt-4 p-4" aria-labelledby="adm-audit">
          <h2 id="adm-audit" className="text-lg font-semibold">Audit log</h2>
          <form
            className="mt-2 flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setApplied(filter.trim());
              void loadAudit(filter.trim()).catch((err) => setError(describeError(err)));
            }}
          >
            <div>
              <label htmlFor="adm-filter" className="text-sm font-medium">Actions that start with</label>
              <input id="adm-filter" className="field mt-1" value={filter} placeholder="plan, admin, control…" onChange={(e) => setFilter(e.target.value)} />
            </div>
            <button type="submit" className="btn">Filter</button>
          </form>
          <div className="overflow-x-auto">
            <table className="mt-3 w-full text-sm">
              <caption className="sr-only">The audit log, newest first</caption>
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th scope="col" className="py-1 pr-3 font-medium">When</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Action</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Who</th>
                  <th scope="col" className="py-1 pr-3 font-medium">What</th>
                  <th scope="col" className="py-1 font-medium">From</th>
                </tr>
              </thead>
              <tbody>
                {audit.entries.map((e) => (
                  <tr key={e.id} className="border-t border-line align-top">
                    <td className="num whitespace-nowrap pr-3">{formatDateTime(e.createdAt)}</td>
                    <th scope="row" className="pr-3 text-left font-normal">{e.action}</th>
                    <td className="pr-3">{e.user ?? "the system"}</td>
                    <td className="pr-3">{e.entityType ? `${e.entityType} ${e.entityId ?? ""}` : "—"}</td>
                    <td className="num">{e.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {audit.entries.length === 0 && <p className="mt-2 text-sm text-muted">Nothing matches.</p>}
          {audit.next && (
            <button type="button" className="btn mt-3" onClick={() => void loadAudit(applied, audit.next ?? undefined, audit).catch((err) => setError(describeError(err)))}>
              Older entries
            </button>
          )}
        </section>
      )}
    </div>
  );
}
