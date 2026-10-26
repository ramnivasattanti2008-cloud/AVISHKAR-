"use client";

import dynamic from "next/dynamic";

// MapLibre needs the browser: load it only there.
const MapExplorer = dynamic(() => import("@/components/map/MapExplorer"), {
  ssr: false,
  loading: () => (
    <p role="status" className="p-6 text-sm text-muted">
      Loading the map…
    </p>
  ),
});

export function MapClient() {
  return <MapExplorer />;
}
