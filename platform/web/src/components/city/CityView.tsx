"use client";

import Link from "next/link";
import { useState } from "react";
import { api, describeError } from "@/lib/api";
import { BASEMAPS } from "@/lib/basemaps";
import { formatNumber } from "@/lib/format";
import type { CityEnergyMap, Property } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { useAuth } from "../AuthProvider";
import { ProvenanceDetails, StatusBadge } from "../Provenance";
import MapCanvas from "../map/MapCanvas";
import { SearchBox } from "../map/SearchBox";

const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A pale-to-deep ramp for the solar resource. Grey where there is no value, so an unread cell never looks like a low one. */
function shade(value: number | null, lowest: number, highest: number): string {
  if (value === null) return "#9ca3af";
  const t = highest > lowest ? (value - lowest) / (highest - lowest) : 0.5;
  const stops: [number, number, number][] = [[255, 237, 160], [254, 178, 76], [227, 109, 38]];
  const i = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
  const f = t * (stops.length - 1) - i;
  const mix = stops[i]!.map((c, k) => Math.round(c + (stops[i + 1]![k]! - c) * f));
  return `rgb(${mix.join(",")})`;
}

/** The city energy map (spec section 49): the solar resource over a square of a real place, your own properties in it, and what nobody can tell you. */
export function CityView() {
  const { user, loading: authLoading } = useAuth();
  const properties = useApi<{ properties: Property[] }>(user ? "/api/properties" : null);
  const [centre, setCentre] = useState<{ latitude: number; longitude: number; name: string } | null>(null);
  const [span, setSpan] = useState("12");
  const [cells, setCells] = useState("4");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CityEnergyMap | null>(null);
  const [view, setView] = useState<{ center: [number, number]; zoom: number } | null>(null);

  async function run(at: { latitude: number; longitude: number; name: string }) {
    const s = Number(span);
    const n = Number(cells);
    if (!(s >= 4 && s <= 60)) return setError("The square must be between 4 and 60 km across.");
    if (!(Number.isInteger(n) && n >= 2 && n <= 5)) return setError("There must be between 2 and 5 cells along each side.");
    if (s / n < 1.1) return setError("Cells must be at least 1.1 km across: the solar provider is asked about a point rounded to about a kilometre, so smaller cells would repeat one value.");
    setBusy(true);
    setError(null);
    setCentre(at);
    try {
      const r = await api<CityEnergyMap>("/api/city", { method: "POST", body: { latitude: at.latitude, longitude: at.longitude, spanKm: s, cellsPerSide: n } });
      setResult(r);
      setView({ center: [at.longitude, at.latitude], zoom: s <= 8 ? 12 : s <= 20 ? 11 : 10 });
    } catch (e) {
      setResult(null);
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  if (authLoading) return <p role="status" className="p-6 text-sm text-muted">Loading…</p>;
  if (!user) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold">City energy map</h1>
        <p className="mt-3 text-muted">
          <Link className="font-semibold text-accent underline" href="/login?next=/city">Sign in</Link> to draw a square over a place and see the sun it gets.
        </p>
      </div>
    );
  }

  const lowest = result?.solarSpread?.lowest ?? 0;
  const highest = result?.solarSpread?.highest ?? 1;
  const mapCells = (result?.cells ?? []).map((c) => ({ id: c.id, geojson: c.geojson, fill: shade(c.solar.value?.annualGhiKwhM2Day ?? null, lowest, highest), label: c.id }));
  const markers = (properties.data?.properties ?? []).map((p) => ({ id: p.id, latitude: p.latitude, longitude: p.longitude, label: p.name }));

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <h1 className="text-2xl font-bold">City energy map</h1>
      <p className="mt-1 text-sm text-muted">
        How much sun a place gets, cell by cell, from a 20-year climatology, with your own properties on it. What a city uses, stores or drives is not shown: AVISHKAR has no source for it, and
        a number without a source would be invented.
      </p>

      <section className="card mt-4 p-4" aria-labelledby="city-where">
        <h2 id="city-where" className="text-lg font-semibold">Choose a place</h2>
        <div className="mt-2">
          <SearchBox onPick={(p) => void run({ latitude: p.latitude, longitude: p.longitude, name: "label" in p && typeof p.label === "string" ? p.label : "the place you chose" })} />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div>
            <label htmlFor="city-span" className="text-sm font-medium">The square is, km across</label>
            <input id="city-span" className="field mt-1" inputMode="decimal" value={span} onChange={(e) => setSpan(e.target.value)} />
          </div>
          <div>
            <label htmlFor="city-cells" className="text-sm font-medium">Cells along each side</label>
            <input id="city-cells" className="field mt-1" inputMode="numeric" value={cells} onChange={(e) => setCells(e.target.value)} />
          </div>
          <button type="button" className="btn" disabled={busy || !centre} onClick={() => centre && void run(centre)}>
            {busy ? "Asking for each cell…" : "Draw it again"}
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">More cells do not mean more detail: the provider answers for a point rounded to about a kilometre, and the model behind it is coarser still.</p>
        <div aria-live="polite" className="mt-3">
          {busy && <p role="status" className="text-sm text-muted">Asking the solar provider for each cell…</p>}
          {error && <p role="alert" className="rounded-md bg-[color:var(--tone-unavailable-bg)] p-3 text-sm text-[color:var(--tone-unavailable-fg)]">{error}</p>}
        </div>
      </section>

      {result && (
        <>
          <section className="card mt-4 p-4" aria-labelledby="city-map">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="city-map" className="text-lg font-semibold">{result.label}</h2>
              <StatusBadge status={result.cells[0]?.solar.provenance.status ?? "UNAVAILABLE"} />
            </div>
            <p className="mt-1 text-sm text-muted">
              {formatNumber(result.grid.spanKm)} km across, {result.grid.cellsPerSide} × {result.grid.cellsPerSide} cells of {formatNumber(result.grid.cellKm)} km. Deeper colour is more sun over the year.
            </p>
            <div className="mt-3">
              <MapCanvas basemap={BASEMAPS[0]!.id} cells={mapCells} markers={markers} initialView={view ?? undefined} className="h-[420px] w-full rounded-md" label="The square, shaded by how much sun each cell gets over a year" />
            </div>
            {result.solarSpread && (
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                <span aria-hidden className="inline-block h-3 w-24 rounded-sm" style={{ background: `linear-gradient(to right, ${shade(result.solarSpread.lowest, result.solarSpread.lowest, result.solarSpread.highest)}, ${shade(result.solarSpread.highest, result.solarSpread.lowest, result.solarSpread.highest)})` }} />
                <span className="num">{formatNumber(result.solarSpread.lowest)} to {formatNumber(result.solarSpread.highest)} kWh/m² per day</span>
                <span className="text-muted">{result.solarSpread.note}</span>
              </div>
            )}
          </section>

          <section className="mt-4" aria-labelledby="city-cells">
            <h2 id="city-cells" className="text-lg font-semibold">Cell by cell</h2>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Each cell of the square: the sun over a year, its best and worst months, and your own properties in it</caption>
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th scope="col" className="py-1 pr-4 font-medium">Cell</th>
                    <th scope="col" className="py-1 pr-4 font-medium">Sun over the year</th>
                    <th scope="col" className="py-1 pr-4 font-medium">Best month</th>
                    <th scope="col" className="py-1 pr-4 font-medium">Worst month</th>
                    <th scope="col" className="py-1 font-medium">Your properties here</th>
                  </tr>
                </thead>
                <tbody className="num">
                  {result.cells.map((c) => (
                    <tr key={c.id} className="border-t border-line">
                      <th scope="row" className="py-1.5 pr-4 text-left font-normal">
                        <span aria-hidden className="mr-2 inline-block h-3 w-3 rounded-sm align-middle" style={{ background: shade(c.solar.value?.annualGhiKwhM2Day ?? null, lowest, highest) }} />
                        {c.id}
                      </th>
                      {c.solar.value ? (
                        <>
                          <td className="py-1.5 pr-4">{formatNumber(c.solar.value.annualGhiKwhM2Day)} kWh/m²/day</td>
                          <td className="py-1.5 pr-4">{MONTH[c.solar.value.bestMonth.month - 1]}, {formatNumber(c.solar.value.bestMonth.ghiKwhM2Day)}</td>
                          <td className="py-1.5 pr-4">{MONTH[c.solar.value.worstMonth.month - 1]}, {formatNumber(c.solar.value.worstMonth.ghiKwhM2Day)}</td>
                        </>
                      ) : (
                        <td className="py-1.5 pr-4 text-sm text-muted" colSpan={3}>{c.solar.provenance.notes.at(-1) ?? "No value."}</td>
                      )}
                      <td className="py-1.5">
                        {c.yours ? (
                          <>
                            <span className="font-semibold">{c.yours.names.join(", ")}</span>
                            <span className="text-muted">
                              {c.yours.solarKwp !== null && ` · ${formatNumber(c.yours.solarKwp)} kWp`}
                              {c.yours.batteryKwh !== null && ` · ${formatNumber(c.yours.batteryKwh)} kWh`}
                              {c.yours.evs > 0 && ` · ${c.yours.evs} vehicle(s)`}
                              {c.yours.meanDailyKwh !== null && ` · uses ${formatNumber(c.yours.meanDailyKwh)} kWh a day`}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2"><ProvenanceDetails p={result.cells[0]!.solar.provenance} /></div>
          </section>

          <section className="card mt-4 p-4" aria-labelledby="city-unknown">
            <h2 id="city-unknown" className="text-lg font-semibold">What this map does not tell you</h2>
            <ul className="mt-2 space-y-2 text-sm">
              {([["demand", "What the city uses"], ["storage", "Batteries in the city"], ["evs", "Electric vehicles"], ["flexibility", "Flexible demand"], ["energyRisk", "Energy risk"]] as const).map(([k, label]) => (
                <li key={k}>
                  <span className="badge mr-2" data-tone="unavailable">UNAVAILABLE</span>
                  <span className="font-medium">{label}.</span> <span className="text-muted">{result.cityWide[k].reason}</span>
                </li>
              ))}
            </ul>
          </section>

          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted">
            {result.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </>
      )}
    </div>
  );
}
