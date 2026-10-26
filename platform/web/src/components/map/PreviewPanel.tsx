"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, describeError } from "@/lib/api";
import { formatNumber, positionLabel } from "@/lib/format";
import type { Preview, Property } from "@/lib/types";
import { useAuth } from "../AuthProvider";
import { Measure, StatusBadge } from "../Provenance";
import type { PickedPlace } from "./SearchBox";

type Answer = { key: string; error: string } | { key: string; data: Preview };
type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: Preview };

/**
 * What the map shows the moment a point is chosen (spec section 59): real solar resource and weather for that spot, each
 * value labelled. Nothing is saved until the user asks. Capacity needs a roof outline, so it is not shown here.
 */
export function PreviewPanel({ place, onSaved }: { place: PickedPlace; onSaved?: (p: Property) => void }) {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [action, setAction] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const { user, loading } = useAuth();
  const router = useRouter();

  // The answer is stored with the place it belongs to; "loading" is simply "no answer for this place yet".
  const key = `${place.latitude},${place.longitude}`;
  useEffect(() => {
    const ctl = new AbortController();
    api<Preview>("/api/preview", { query: { latitude: place.latitude, longitude: place.longitude }, signal: ctl.signal })
      .then((data) => setAnswer({ key, data }))
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setAnswer({ key, error: describeError(e) });
      });
    return () => ctl.abort();
  }, [key, place.latitude, place.longitude]);
  const state: State = answer?.key !== key ? { kind: "loading" } : "error" in answer ? { kind: "error", message: answer.error } : { kind: "ready", data: answer.data };

  async function analyze() {
    setAction({ busy: true, error: null });
    try {
      const name = place.label?.split(",")[0]?.trim() || `Property at ${place.latitude.toFixed(4)}, ${place.longitude.toFixed(4)}`;
      const prop = await api<Property>("/api/properties", {
        method: "POST",
        body: { name: name.slice(0, 120), latitude: place.latitude, longitude: place.longitude, address: place.label?.slice(0, 300), positionSource: place.source, positionAccuracyM: place.accuracyM },
      });
      onSaved?.(prop);
      await api(`/api/properties/${prop.id}/analyze`, { method: "POST" });
      router.push(`/property/${prop.id}`);
    } catch (e) {
      setAction({ busy: false, error: describeError(e) });
    }
  }

  return (
    <section aria-label="Selected location" className="flex flex-col gap-3">
      <header>
        <h2 className="text-lg font-semibold">{place.label?.split(",")[0] ?? "Selected location"}</h2>
        <p className="num text-sm text-muted">
          {place.latitude.toFixed(5)}, {place.longitude.toFixed(5)}
        </p>
        <p className="mt-0.5 text-xs text-muted">{positionLabel(place.source, place.accuracyM)}</p>
        {place.label && <p className="mt-1 text-xs text-muted">{place.label}</p>}
      </header>

      {state.kind === "loading" && <p role="status" className="text-sm text-muted">Fetching real solar and weather data for this spot…</p>}
      {state.kind === "error" && (
        <p role="alert" className="rounded-md bg-[color:var(--tone-unavailable-bg)] p-3 text-sm text-[color:var(--tone-unavailable-fg)]">
          {state.message}
        </p>
      )}
      {state.kind === "ready" && <PreviewBody data={state.data} />}

      <div className="mt-1 border-t border-line pt-3">
        {loading ? null : user ? (
          <button type="button" className="btn btn-primary w-full" onClick={analyze} disabled={action.busy || state.kind === "loading"}>
            {action.busy ? "Building the Energy Twin…" : "Analyze this property"}
          </button>
        ) : (
          <p className="text-sm text-muted">
            <Link className="font-semibold text-accent underline" href="/login?next=/map">
              Sign in
            </Link>{" "}
            or{" "}
            <Link className="font-semibold text-accent underline" href="/register">
              create an account
            </Link>{" "}
            to save this property and build its Energy Twin.
          </p>
        )}
        {action.error && (
          <p role="alert" className="mt-2 text-sm text-[color:var(--tone-unavailable-fg)]">
            {action.error}
          </p>
        )}
        <p className="mt-2 text-xs text-muted">The analysis fetches the building outline, solar resource, weather and the latest satellite scene. It takes about ten seconds.</p>
      </div>
    </section>
  );
}

function PreviewBody({ data }: { data: Preview }) {
  return (
    <div className="divide-y divide-line">
      {data.warnings.map((w) => (
        <p key={w} className="py-2 text-sm text-[color:var(--tone-updated-fg)]">
          {w}
        </p>
      ))}
      <div>
        <h3 className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted">Solar</h3>
        <Measure label="Annual average irradiation" m={data.solar.annualGhiKwhM2Day} digits={2} />
        <Measure label="Yield per kWp installed, per day" m={data.solar.yieldKwhPerKwpDay} digits={2} />
        <Measure label="Expected yield per kWp, next 24 h" m={data.solar.forecastNext24hKwhPerKwp} digits={2} />
      </div>
      <div>
        <h3 className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted">Weather now</h3>
        <Measure label="Air temperature" m={data.weather.airTemperature} digits={1} />
        <Measure label="Cloud cover" m={data.weather.cloudCover} digits={0} />
        <Measure label="Solar irradiance" m={data.weather.globalHorizontalIrradiance} digits={0} />
      </div>
      <div className="py-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">Data completeness</span>
          <span className="flex items-center gap-2">
            <span className="num font-semibold">{formatNumber(data.confidence * 100)}%</span>
            <span className="badge" data-tone="reference">
              {data.dataQuality}
            </span>
          </span>
        </div>
        <p className="mt-1 text-xs text-muted">Share of the inputs a full Energy Twin needs that exist for this spot. It rises when you add a roof outline, consumption and a tariff.</p>
        {data.unavailable.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-sm text-muted">
            {data.unavailable.map((g) => (
              <li key={g.what}>
                <strong className="text-ink">{g.what}:</strong> {g.reason}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted">
          Sources:
          {data.sources.map((s) => (
            <span key={s.provider} className="inline-flex items-center gap-1">
              {s.provider}
              <StatusBadge status={s.ok ? (s.status as Preview["solar"]["annualGhiKwhM2Day"]["provenance"]["status"]) : "UNAVAILABLE"} />
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}
