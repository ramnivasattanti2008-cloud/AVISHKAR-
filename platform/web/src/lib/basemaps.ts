import type { StyleSpecification } from "maplibre-gl";

/**
 * Map provider abstraction (spec section 6): base layers are data, not code. Tile servers have usage policies: the public
 * OpenStreetMap tile server is fine for development and light use, and a production deployment should point
 * NEXT_PUBLIC_OSM_TILE_URL at its own or a commercial tile service. Satellite imagery is Esri World Imagery.
 */
export interface Basemap {
  id: "standard" | "satellite" | "terrain";
  label: string;
  tiles: string[];
  attribution: string;
  maxzoom: number;
}

const osm = process.env.NEXT_PUBLIC_OSM_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export const BASEMAPS: Basemap[] = [
  { id: "standard", label: "Standard", tiles: [osm], attribution: "© OpenStreetMap contributors", maxzoom: 19 },
  {
    id: "satellite",
    label: "Satellite",
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    attribution: "Imagery © Esri, Maxar, Earthstar Geographics and the GIS User Community",
    maxzoom: 19,
  },
  {
    id: "terrain",
    label: "Terrain",
    tiles: ["https://a.tile.opentopomap.org/{z}/{x}/{y}.png", "https://b.tile.opentopomap.org/{z}/{x}/{y}.png", "https://c.tile.opentopomap.org/{z}/{x}/{y}.png"],
    attribution: "© OpenStreetMap contributors, SRTM | Style © OpenTopoMap (CC-BY-SA)",
    maxzoom: 17,
  },
];

export function styleFor(basemap: Basemap): StyleSpecification {
  return {
    version: 8,
    sources: { base: { type: "raster", tiles: basemap.tiles, tileSize: 256, attribution: basemap.attribution, maxzoom: basemap.maxzoom } },
    layers: [{ id: "base", type: "raster", source: "base" }],
  };
}

/** India as the first view: a map-first product should open on something real, not on a dashboard. */
export const INITIAL_VIEW = { center: [78.5, 21.5] as [number, number], zoom: 4.2 };
