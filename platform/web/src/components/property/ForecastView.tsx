"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, describeError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { WeatherReport } from "@/lib/types";
import { useAuth } from "../AuthProvider";
import { ProvenanceDetails, StatusBadge } from "../Provenance";
import { HourlyChart } from "./HourlyChart";
import { LoadForecastPanel, SolarForecastPanel } from "./ModelForecasts";
import { PropertyTabs } from "./PropertyTabs";

const CHARTS = [
  { key: "global_horizontal_irradiance", title: "Solar irradiance on a horizontal surface", unit: "W/m²" },
  { key: "cloud_cover", title: "Cloud cover", unit: "%" },
  { key: "air_temperature", title: "Air temperature", unit: "°C" },
  { key: "precipitation", title: "Precipitation", unit: "mm" },
  { key: "wind_speed", title: "Wind speed", unit: "m/s" },
] as const;

/** The provider's hourly forecast for the property, charted with its provenance (spec sections 13 and 88). */
export function ForecastView({ id }: { id: string }) {
  const { user, loading } = useAuth();
  const [report, setReport] = useState<WeatherReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let live = true;
    api<WeatherReport>(`/api/properties/${id}/weather`, { query: { days: 3 } })
      .then((r) => live && setReport(r))
      .catch((e) => live && setError(describeError(e)));
    return () => {
      live = false;
    };
  }, [id, user]);

  if (loading) return <p role="status" className="p-6 text-sm text-muted">Loading…</p>;
  if (!user) {
    return (
      <p className="p-6 text-sm text-muted">
        <Link className="font-semibold text-accent underline" href={`/login?next=/property/${id}/forecast`}>Sign in</Link> to see this property’s forecast.
      </p>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <h1 className="text-2xl font-bold">Forecast</h1>
      <div className="mt-3"><PropertyTabs id={id} current="/forecast" /></div>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SolarForecastPanel id={id} />
        <LoadForecastPanel id={id} />
      </div>
      <h2 className="mt-8 text-lg font-semibold">The weather behind it</h2>
      {error && <p role="alert" className="mt-4 rounded-md bg-[color:var(--tone-unavailable-bg)] p-3 text-sm text-[color:var(--tone-unavailable-fg)]">{error}</p>}
      {!report && !error && <p role="status" className="mt-4 text-sm text-muted">Fetching the real hourly forecast…</p>}
      {report && (
        <>
          {report.notes.map((n) => (<p key={n} role="status" className="mt-4 rounded-md bg-[color:var(--tone-updated-bg)] p-3 text-sm text-[color:var(--tone-updated-fg)]">{n}</p>))}
          <p className="mt-3 text-sm text-muted">
            Model data for the grid point {report.grid.latitude.toFixed(2)}, {report.grid.longitude.toFixed(2)}
            {report.elevationM !== null ? ` (${Math.round(report.elevationM)} m)` : ""}, fetched {formatDateTime(report.fetchedAt)}. Times are in your browser’s time zone. This is a weather model forecast, not a measurement.
          </p>
          {report.quality.length > 0 && (
            <p className="mt-2 text-sm text-muted">Removed by quality checks: {report.quality.map((q) => `${q.rejected} ${q.variable.replaceAll("_", " ")} point(s) (${q.reasons[0]})`).join("; ")}.</p>
          )}
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {CHARTS.map((c) => {
              const series = report.hourly[c.key];
              if (!series?.value) return null;
              return (
                <section key={c.key} className="card p-4" aria-label={c.title}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-base font-semibold">{c.title}</h2>
                    <StatusBadge status={series.provenance.status} />
                  </div>
                  <HourlyChart points={series.value} unit={c.unit} status={series.provenance.status} source={series.provenance.source} />
                  <ProvenanceDetails p={series.provenance} />
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
