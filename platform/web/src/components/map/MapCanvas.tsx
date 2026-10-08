"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MapLibreMap, Marker, NavigationControl, ScaleControl, setWorkerUrl, type GeoJSONSource, type MapMouseEvent } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { BASEMAPS, INITIAL_VIEW, type Basemap, styleFor } from "@/lib/basemaps";

// The worker files are copied to public/maplibre/ at build time (scripts/copy-maplibre-worker.mjs): the bundler renames assets, and
// MapLibre finds its worker by name. Without this the production build draws no map.
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

export interface MapMarker {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
}

export interface MapCanvasProps {
  basemap: Basemap["id"];
  selection?: { latitude: number; longitude: number } | null;
  /** Real markers only: stored properties of the signed-in user. Never decorative. */
  markers?: MapMarker[];
  outlines?: { id: string; geojson: unknown }[];
  flyTo?: { latitude: number; longitude: number; zoom?: number; key: number } | null;
  onSelect?: (p: { latitude: number; longitude: number }) => void;
  onMarkerClick?: (id: string) => void;
  /** While true, clicks add outline vertices; double-click finishes, Escape cancels. */
  drawing?: boolean;
  onDrawn?: (ring: [number, number][]) => void;
  onDrawCancel?: () => void;
  initialView?: { center: [number, number]; zoom: number };
  className?: string;
  label?: string;
}

const EMPTY = { type: "FeatureCollection" as const, features: [] as unknown[] };

function pin(color: string, label: string): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.setAttribute("aria-label", label);
  el.style.cssText = `width:18px;height:18px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 0 0 2px ${color},0 2px 6px rgba(0,0,0,.4);cursor:pointer;padding:0`;
  return el;
}

function setBase(map: MapLibreMap, id: Basemap["id"]) {
  const bm = BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0]!;
  if (map.getLayer("base")) map.removeLayer("base");
  if (map.getSource("base")) map.removeSource("base");
  map.addSource("base", { type: "raster", tiles: bm.tiles, tileSize: 256, attribution: bm.attribution, maxzoom: bm.maxzoom });
  const above = map.getStyle().layers.find((l) => l.id !== "base")?.id;
  map.addLayer({ id: "base", type: "raster", source: "base" }, above);
}

export default function MapCanvas(props: MapCanvasProps) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const selRef = useRef<Marker | null>(null);
  const markerRefs = useRef(new Map<string, Marker>());
  const loaded = useRef(false);
  const draft = useRef<[number, number][]>([]);
  // The latest callbacks, readable from map event handlers without re-binding them.
  const cb = useRef(props);
  useEffect(() => {
    cb.current = props;
  });

  useEffect(() => {
    if (!box.current) return;
    const view = props.initialView ?? INITIAL_VIEW;
    const map = new MapLibreMap({ container: box.current, style: styleFor(BASEMAPS.find((b) => b.id === props.basemap) ?? BASEMAPS[0]!), center: view.center, zoom: view.zoom, attributionControl: { compact: true } });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");

    map.on("load", () => {
      loaded.current = true;
      map.addSource("outlines", { type: "geojson", data: EMPTY as never });
      map.addLayer({ id: "outlines-fill", type: "fill", source: "outlines", paint: { "fill-color": "#0b6b57", "fill-opacity": 0.28 } });
      map.addLayer({ id: "outlines-line", type: "line", source: "outlines", paint: { "line-color": "#0b6b57", "line-width": 2.5 } });
      map.addSource("draft", { type: "geojson", data: EMPTY as never });
      map.addLayer({ id: "draft-line", type: "line", source: "draft", paint: { "line-color": "#d9480f", "line-width": 2.5, "line-dasharray": [2, 1] } });
      map.addLayer({ id: "draft-pts", type: "circle", source: "draft", filter: ["==", "$type", "Point"], paint: { "circle-radius": 5, "circle-color": "#d9480f", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
      if (cb.current.outlines) syncOutlines(map, cb.current.outlines);
    });

    const onClick = (e: MapMouseEvent) => {
      const p = cb.current;
      if (p.drawing) {
        draft.current.push([e.lngLat.lng, e.lngLat.lat]);
        drawDraft(map, draft.current);
        return;
      }
      p.onSelect?.({ latitude: e.lngLat.lat, longitude: e.lngLat.lng });
    };
    const onDbl = (e: MapMouseEvent) => {
      const p = cb.current;
      if (!p.drawing) return;
      e.preventDefault();
      const pts = draft.current.slice(0, -1); // a double-click also fired two single clicks; the second repeated the first
      if (pts.length >= 3) {
        p.onDrawn?.([...pts, pts[0]!]);
        draft.current = [];
        drawDraft(map, []);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && cb.current.drawing) {
        draft.current = [];
        drawDraft(map, []);
        cb.current.onDrawCancel?.();
      }
    };
    map.on("click", onClick);
    map.on("dblclick", onDbl);
    window.addEventListener("keydown", onKey);
    const markers = markerRefs.current;
    return () => {
      window.removeEventListener("keydown", onKey);
      markers.forEach((m) => m.remove());
      markers.clear();
      selRef.current?.remove();
      map.remove();
      mapRef.current = null;
      loaded.current = false;
    };
    // The map is created once; everything else is synced by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => setBase(map, props.basemap);
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [props.basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const sel = props.selection;
    if (!sel) {
      selRef.current?.remove();
      selRef.current = null;
      return;
    }
    if (!selRef.current) selRef.current = new Marker({ element: pin("#d9480f", "Selected location") }).setLngLat([sel.longitude, sel.latitude]).addTo(map);
    else selRef.current.setLngLat([sel.longitude, sel.latitude]);
  }, [props.selection]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const want = new Map((props.markers ?? []).map((m) => [m.id, m]));
    for (const [id, marker] of markerRefs.current) {
      if (!want.has(id)) {
        marker.remove();
        markerRefs.current.delete(id);
      }
    }
    for (const m of want.values()) {
      const existing = markerRefs.current.get(m.id);
      if (existing) existing.setLngLat([m.longitude, m.latitude]);
      else {
        const el = pin("#0b6b57", `Saved property: ${m.label}`);
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          cb.current.onMarkerClick?.(m.id);
        });
        markerRefs.current.set(m.id, new Marker({ element: el }).setLngLat([m.longitude, m.latitude]).addTo(map));
      }
    }
  }, [props.markers]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && loaded.current && props.outlines) syncOutlines(map, props.outlines);
  }, [props.outlines]);

  useEffect(() => {
    const f = props.flyTo;
    if (f && mapRef.current) mapRef.current.flyTo({ center: [f.longitude, f.latitude], zoom: f.zoom ?? 15, essential: true });
  }, [props.flyTo]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (props.drawing) map.doubleClickZoom.disable();
    else {
      map.doubleClickZoom.enable();
      draft.current = [];
      if (loaded.current) drawDraft(map, []);
    }
    map.getCanvas().style.cursor = props.drawing ? "crosshair" : "";
  }, [props.drawing]);

  return <div ref={box} className={props.className ?? "h-full w-full"} role="application" aria-label={props.label ?? "Map. Click a place to see its solar resource and weather."} />;
}

function syncOutlines(map: MapLibreMap, outlines: { id: string; geojson: unknown }[]) {
  const src = map.getSource("outlines") as GeoJSONSource | undefined;
  src?.setData({ type: "FeatureCollection", features: outlines.map((o) => ({ type: "Feature", id: o.id, properties: { id: o.id }, geometry: o.geojson })) } as never);
}

function drawDraft(map: MapLibreMap, pts: [number, number][]) {
  const src = map.getSource("draft") as GeoJSONSource | undefined;
  const features: unknown[] = pts.map((p) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: p } }));
  if (pts.length >= 2) features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [...pts, ...(pts.length >= 3 ? [pts[0]!] : [])] } });
  src?.setData({ type: "FeatureCollection", features } as never);
}
