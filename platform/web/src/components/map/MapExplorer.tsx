"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { BASEMAPS, type Basemap } from "@/lib/basemaps";
import type { Property } from "@/lib/types";
import { useAuth } from "../AuthProvider";
import MapCanvas from "./MapCanvas";
import { PreviewPanel } from "./PreviewPanel";
import { type PickedPlace, SearchBox } from "./SearchBox";

/** The map-first home of the product (spec section 5): search, click, locate or paste, and see real data at once. */
export default function MapExplorer() {
  const { user } = useAuth();
  const router = useRouter();
  const [basemap, setBasemap] = useState<Basemap["id"]>("standard");
  const [place, setPlace] = useState<PickedPlace | null>(null);
  const [fly, setFly] = useState<{ latitude: number; longitude: number; zoom?: number; key: number } | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);

  useEffect(() => {
    if (!user) return;
    let live = true;
    api<{ properties: Property[] }>("/api/properties")
      .then((r) => live && setProperties(r.properties))
      .catch(() => live && setProperties([]));
    return () => {
      live = false;
    };
  }, [user]);

  // Signed out means no pins, whatever was loaded before.
  const markers = useMemo(() => (user ? properties : []).map((p) => ({ id: p.id, latitude: p.latitude, longitude: p.longitude, label: p.name })), [user, properties]);

  function choose(p: PickedPlace, fromSearch: boolean) {
    setPlace(p);
    if (fromSearch) setFly({ latitude: p.latitude, longitude: p.longitude, zoom: p.source === "geocoded" ? 16 : 17, key: Date.now() });
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(340px,420px)_1fr]">
      <aside className="order-2 flex min-h-0 flex-col gap-4 overflow-y-auto border-line bg-surface p-4 lg:order-1 lg:border-r" aria-label="Search and details">
        <SearchBox onPick={(p) => choose(p, true)} />
        {place ? (
          <PreviewPanel place={place} onSaved={(p) => setProperties((cur) => [p, ...cur.filter((x) => x.id !== p.id)])} />
        ) : (
          <div className="card p-4 text-sm text-muted">
            <p className="font-semibold text-ink">Choose a place</p>
            <p className="mt-1">Search an address, paste coordinates, use your location, or click the map. AVISHKAR then shows the real solar resource and weather for that spot, with every value labelled as live, forecast, estimated or unavailable.</p>
            {user && properties.length > 0 && <p className="mt-2">Your saved properties are the green pins.</p>}
          </div>
        )}
      </aside>
      <div className="relative order-1 min-h-[52vh] lg:order-2 lg:min-h-0">
        <MapCanvas
          basemap={basemap}
          selection={place}
          markers={markers}
          flyTo={fly}
          onSelect={(p) => choose({ ...p, source: "map-click" }, false)}
          onMarkerClick={(id) => router.push(`/property/${id}`)}
        />
        <div className="absolute left-3 top-3 z-10 flex overflow-hidden rounded-lg border border-line bg-surface shadow" role="group" aria-label="Base layer">
          {BASEMAPS.map((b) => (
            <button key={b.id} type="button" className={`px-3 py-1.5 text-sm font-medium ${basemap === b.id ? "bg-accent text-accent-ink" : "hover:bg-surface2"}`} aria-pressed={basemap === b.id} onClick={() => setBasemap(b.id)}>
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
