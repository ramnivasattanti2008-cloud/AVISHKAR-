"use client";

import { useEffect, useId, useState } from "react";
import { ApiError, api, describeError } from "@/lib/api";
import { parseCoordinates } from "@/lib/format";
import type { GeocodeResult, GeocodeSearch } from "@/lib/types";

export type PositionSource = "browser-geolocation" | "manual" | "map-click" | "geocoded";

export interface PickedPlace {
  latitude: number;
  longitude: number;
  source: PositionSource;
  label?: string;
  accuracyM?: number;
}

interface Searched {
  q: string;
  results?: GeocodeResult[];
  error?: string;
}

/**
 * Search an address or locality, paste coordinates, or use the current location (spec sections 5, 7). Typed text that is a
 * coordinate pair never calls the geocoder. Geolocation is reported as browser geolocation, never as NavIC (section 4).
 * The results and the busy state are derived from the typed text, so they can never describe a stale query.
 */
export function SearchBox({ onPick }: { onPick: (p: PickedPlace) => void }) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [searched, setSearched] = useState<Searched | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const listId = useId();

  const q = text.trim().replace(/\s+/g, " ");
  const searchable = q.length >= 3 && !parseCoordinates(q) && q !== picked;
  const current = searchable && searched?.q === q ? searched : null;
  const results = current?.results ?? null;
  const busy = searchable && current === null;
  const error = current?.error ?? geoError;

  useEffect(() => {
    if (!searchable) return;
    const ctl = new AbortController();
    // The geocoding provider allows about one request per second: wait until the user pauses typing.
    const t = setTimeout(async () => {
      try {
        const r = await api<GeocodeSearch>("/api/geocode/search", { query: { q, limit: 5 }, signal: ctl.signal });
        setSearched({ q, results: r.value ?? [] });
        setActive(-1);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setSearched({
          q,
          error: e instanceof ApiError && e.code === "PROVIDER_UNAVAILABLE" ? "The address search service is not answering right now. You can still click the map or paste coordinates." : describeError(e),
        });
      }
    }, 450);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q, searchable]);

  function pick(r: GeocodeResult) {
    onPick({ latitude: r.latitude, longitude: r.longitude, source: "geocoded", label: r.label });
    setText(r.label);
    setPicked(r.label.trim().replace(/\s+/g, " "));
  }

  function submit() {
    const coords = parseCoordinates(text);
    if (coords) {
      onPick({ ...coords, source: "manual" });
      return;
    }
    const chosen = results?.[active >= 0 ? active : 0];
    if (chosen) pick(chosen);
  }

  function locate() {
    setGeoError(null);
    if (!("geolocation" in navigator)) {
      setGeoError("This browser cannot report your location.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => onPick({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracyM: p.coords.accuracy, source: "browser-geolocation" }),
      (e) => setGeoError(e.code === e.PERMISSION_DENIED ? "Location permission was denied. Search for an address or click the map instead." : "Your location could not be determined."),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  const open = Boolean(results && results.length);
  return (
    <div className="relative">
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="sr-only" htmlFor={`${listId}-in`}>
          Search an address, a locality, or coordinates
        </label>
        <input
          id={`${listId}-in`}
          className="field"
          placeholder="Address, locality, or 12.9716, 77.5946"
          value={text}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            setGeoError(null);
          }}
          onKeyDown={(e) => {
            if (!open) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min((results?.length ?? 1) - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(-1, a - 1));
            } else if (e.key === "Escape") setPicked(q);
          }}
        />
        <button className="btn btn-primary" type="submit" disabled={!text.trim()}>
          Go
        </button>
        <button className="btn" type="button" onClick={locate} title="Use my current location">
          Locate me
        </button>
      </form>
      <div aria-live="polite" className="mt-1 min-h-5 text-xs text-muted">
        {busy ? (
          "Searching…"
        ) : error ? (
          <span role="alert" className="text-[color:var(--tone-unavailable-fg)]">
            {error}
          </span>
        ) : results && results.length === 0 ? (
          "No place found. Try a different spelling, or click the map."
        ) : null}
      </div>
      {open && (
        <ul id={listId} role="listbox" className="card absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-auto shadow-lg">
          {results!.map((r, i) => (
            <li
              key={`${r.latitude},${r.longitude},${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`cursor-pointer px-3 py-2 text-sm ${i === active ? "bg-surface2" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(r)}
            >
              <div className="font-medium">{r.label.split(",")[0]}</div>
              <div className="truncate text-xs text-muted">{r.label}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
