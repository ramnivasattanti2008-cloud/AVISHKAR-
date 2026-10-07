"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { api, describeError } from "@/lib/api";
import { formatDateTime, formatNumber, positionLabel } from "@/lib/format";
import type { Twin } from "@/lib/types";
import { useAuth } from "../AuthProvider";
import { Measure, StatusBadge } from "../Provenance";
import { PropertyTabs } from "./PropertyTabs";
import { usePropertyData } from "./usePropertyData";

const MapCanvas = dynamic(() => import("../map/MapCanvas"), { ssr: false, loading: () => <div className="h-full w-full bg-surface2" aria-hidden /> });

function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section className="card p-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      <div className="mt-2 divide-y divide-line">{children}</div>
    </section>
  );
}

export function PropertyView({ id }: { id: string }) {
  const { user, loading: authLoading } = useAuth();
  const { property, twin, loading, error, notFound, reload, setTwin } = usePropertyData(id);
  const [busy, setBusy] = useState<"analyze" | "outline" | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [drawing, setDrawing] = useState(false);

  const outlines = useMemo(() => property?.geometry.items.map((g) => ({ id: g.id, geojson: g.geojson })) ?? [], [property]);

  if (loading || authLoading) return <p role="status" className="p-6 text-sm text-muted">Loading property…</p>;
  if (!user || notFound) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold">Property not found</h1>
        <p className="mt-3 text-muted">
          {user ? "This property does not exist or is not yours." : "Sign in to see this property."}{" "}
          <Link className="font-semibold text-accent underline" href={user ? "/properties" : `/login?next=/property/${id}`}>
            {user ? "Back to your properties" : "Sign in"}
          </Link>
        </p>
      </div>
    );
  }
  if (error || !property) return <p role="alert" className="p-6 text-sm text-[color:var(--tone-unavailable-fg)]">{error ?? "Could not load the property."}</p>;

  async function analyze() {
    setBusy("analyze");
    setMessage(null);
    try {
      setTwin(await api<Twin>(`/api/properties/${id}/analyze`, { method: "POST" }));
      await reload();
      setMessage({ tone: "ok", text: "A new Energy Twin version was built from the latest real data." });
    } catch (e) {
      setMessage({ tone: "error", text: describeError(e) });
    } finally {
      setBusy(null);
    }
  }

  async function saveOutline(ring: [number, number][]) {
    setDrawing(false);
    setBusy("outline");
    setMessage(null);
    try {
      await api(`/api/properties/${id}/geometry`, { method: "POST", body: { ring } });
      await reload();
      setMessage({ tone: "ok", text: "Roof outline saved. Analyze again to use it in the capacity estimate." });
    } catch (e) {
      setMessage({ tone: "error", text: describeError(e) });
    } finally {
      setBusy(null);
    }
  }

  const p = property;
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{p.name}</h1>
          <p className="num text-sm text-muted">{p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}{p.address ? ` · ${p.address}` : ""}</p>
          <p className="mt-0.5 text-xs text-muted">{positionLabel(p.position.source, p.position.accuracyM)}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            {twin && (
              <span className="badge" data-tone={twin.dataQuality === "FULL" ? "live" : twin.dataQuality === "PARTIAL" ? "updated" : "unavailable"} title={twin.confidenceMeaning}>
                DATA {twin.dataQuality}
              </span>
            )}
            <button type="button" className="btn btn-primary" onClick={analyze} disabled={busy !== null}>
              {busy === "analyze" ? "Analyzing…" : twin ? "Analyze again" : "Analyze this property"}
            </button>
          </div>
          {twin && <span className="text-xs text-muted">Twin v{twin.version}, built {formatDateTime(twin.createdAt)}</span>}
        </div>
      </header>

      <div className="mt-4">
        <PropertyTabs id={id} current="" />
      </div>

      <div aria-live="polite" className="mt-3 min-h-6">
        {message && (
          <p role={message.tone === "error" ? "alert" : "status"} className={`rounded-md p-2 text-sm ${message.tone === "error" ? "bg-[color:var(--tone-unavailable-bg)] text-[color:var(--tone-unavailable-fg)]" : "bg-[color:var(--tone-live-bg)] text-[color:var(--tone-live-fg)]"}`}>
            {message.text}
          </p>
        )}
      </div>

      <div className="mt-2 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col gap-4">
          <section className="card overflow-hidden" aria-label="Location and roof outline">
            <div className="relative h-80">
              <MapCanvas
                basemap="satellite"
                selection={{ latitude: p.latitude, longitude: p.longitude }}
                outlines={outlines}
                flyTo={{ latitude: p.latitude, longitude: p.longitude, zoom: 18, key: 1 }}
                initialView={{ center: [p.longitude, p.latitude], zoom: 18 }}
                drawing={drawing}
                onDrawn={saveOutline}
                onDrawCancel={() => setDrawing(false)}
                label="Satellite map of the property with its roof outline"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <span className="text-muted">
                {p.geometry.status === "AVAILABLE"
                  ? `Outline: ${p.geometry.items.map((g) => `${g.kind === "USER_POLYGON" ? "drawn by you" : "OpenStreetMap"}, ${formatNumber(g.areaM2)} m²`).join("; ")}`
                  : p.geometry.message}
              </span>
              {drawing ? (
                <span className="flex items-center gap-2">
                  <span className="text-xs text-muted">Click each corner, double-click to finish, Esc to cancel.</span>
                  <button type="button" className="btn" onClick={() => setDrawing(false)}>Cancel</button>
                </span>
              ) : (
                <button type="button" className="btn" onClick={() => setDrawing(true)} disabled={busy !== null}>
                  {busy === "outline" ? "Saving…" : "Draw roof outline"}
                </button>
              )}
            </div>
          </section>
          {p.warnings.concat(twin?.warnings ?? []).map((w) => (
            <p key={w} className="rounded-md bg-[color:var(--tone-updated-bg)] p-3 text-sm text-[color:var(--tone-updated-fg)]">{w}</p>
          ))}
        </div>

        {twin ? <TwinPanels twin={twin} /> : (
          <section className="card p-5 text-sm text-muted">
            <h2 className="text-base font-semibold text-ink">No Energy Twin yet</h2>
            <p className="mt-2">Select “Analyze this property” to build the first version from the building outline, solar resource, weather forecast and latest satellite scene. It takes about ten seconds.</p>
          </section>
        )}
      </div>
    </div>
  );
}

function TwinPanels({ twin }: { twin: Twin }) {
  const s = twin.solar;
  return (
    <div className="flex flex-col gap-4">
      <Section title="Solar potential" hint="Estimates show their working below; they are not measurements.">
        <Measure label="Roof area" m={twin.geometry.roofAreaM2} />
        <Measure label="Usable roof area" m={s.usableRoofAreaM2} />
        <Measure label="Estimated capacity" m={s.capacityKwEstimate} digits={1} />
        <Measure label="Estimated generation per day" m={s.estimatedDailyGenerationKwh} digits={1} />
        <Measure label="Yield per kWp, per day" m={s.yieldKwhPerKwpDay} digits={2} />
        <Measure label="Annual average irradiation" m={s.annualGhiKwhM2Day} digits={2} />
      </Section>
      <Section title="Next 24 hours" hint="From the hourly weather forecast.">
        <Measure label="Solar energy arriving" m={s.forecastNext24hGhiKwhM2} digits={2} />
        <Measure label="Expected yield per kWp" m={s.forecastNext24hKwhPerKwp} digits={2} />
      </Section>
      <Section title="Not known yet" hint="AVISHKAR does not guess these.">
        <Measure label="Daily consumption" m={twin.consumption.estimatedDailyLoadKwh} />
        <div className="py-2">
          <div className="flex items-center justify-between"><span className="text-sm text-muted">Electricity tariff</span><StatusBadge status={twin.tariff.provenance.status} /></div>
          <p className="mt-1 text-sm text-muted">{twin.tariff.provenance.notes[0]}</p>
        </div>
        <Measure label="Energy autonomy score" m={twin.energyAutonomyScore} />
      </Section>
      <Section title="Latest satellite scene">
        {twin.satellite.value ? (
          <div className="py-2 text-sm">
            <div className="flex items-center justify-between"><span>{twin.satellite.value.satellite} ({twin.satellite.value.sensor})</span><StatusBadge status={twin.satellite.provenance.status} /></div>
            <p className="mt-1 text-muted">Acquired {formatDateTime(twin.satellite.value.acquiredAt)}{twin.satellite.value.cloudPercent !== null ? `, ${Math.round(twin.satellite.value.cloudPercent)}% cloud over the scene` : ""}. {twin.satellite.value.processingStatus}.</p>
            <p className="mt-1 text-xs text-muted">The latest image, not a view of the present. A cloud-movement nowcast is unavailable: it needs satellite images minutes apart.</p>
          </div>
        ) : (
          <Measure label="Satellite scene" m={{ value: null, provenance: twin.satellite.provenance }} />
        )}
      </Section>
      <Section title="How complete is this twin?" hint={twin.confidenceMeaning}>
        <ul className="py-2 text-sm">
          {twin.confidenceBasis.map((b) => (
            <li key={b.item} className="flex items-center justify-between py-0.5">
              <span className={b.available ? "" : "text-muted"}>{b.item}</span>
              <span className="num text-xs text-muted">{b.available ? "available" : "missing"} · weight {Math.round(b.weight * 100)}%</span>
            </li>
          ))}
          <li className="mt-1 flex items-center justify-between border-t border-line pt-2 font-semibold"><span>Completeness</span><span className="num">{Math.round(twin.confidence * 100)}%</span></li>
        </ul>
      </Section>
      <Section title="Sources and assumptions">
        <ul className="py-2 text-sm">
          {twin.sources.map((x) => (
            <li key={x.provider + x.dataType} className="flex flex-wrap items-center justify-between gap-2 py-1">
              <span><strong>{x.provider}</strong> <span className="text-muted">{x.note}</span></span>
              <StatusBadge status={(x.ok ? x.status : "UNAVAILABLE") as Twin["solar"]["annualGhiKwhM2Day"]["provenance"]["status"]} />
            </li>
          ))}
        </ul>
        <ul className="py-2 text-sm">
          {twin.assumptions.map((a) => (
            <li key={a.key} className="py-1"><strong>{a.key.replaceAll("_", " ")}</strong> = <span className="num">{a.value}</span> {a.unit}<span className="block text-xs text-muted">{a.rationale}</span></li>
          ))}
        </ul>
        {twin.unavailable.length > 0 && (
          <ul className="py-2 text-sm text-muted">
            {twin.unavailable.map((g) => (<li key={g.what} className="py-1"><strong className="text-ink">{g.what}:</strong> {g.reason}</li>))}
          </ul>
        )}
      </Section>
    </div>
  );
}
