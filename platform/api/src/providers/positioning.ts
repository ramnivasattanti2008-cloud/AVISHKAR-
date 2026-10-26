/**
 * PositioningProvider abstraction (spec section 4).
 *
 * AVISHKAR must say truthfully where a position came from. Browser geolocation is NOT NavIC and is never labelled as
 * such. A `navic` source is accepted only when a NavIC-capable receiver integration has been explicitly enabled; no
 * such hardware was available during development, so by default that source is refused rather than faked.
 */

export const POSITION_SOURCES = ["browser-geolocation", "manual", "map-click", "geocoded", "imported", "navic"] as const;
export type PositionSource = (typeof POSITION_SOURCES)[number];

export interface PositionSourceInfo {
  source: PositionSource;
  label: string;
  /** What this source can and cannot tell us. Shown next to the position. */
  note: string;
}

const INFO: Record<PositionSource, { label: string; note: string }> = {
  "browser-geolocation": {
    label: "Browser geolocation",
    note: "Position reported by the device through the browser. The browser does not say whether it came from GNSS, Wi-Fi or the network, so only the stated accuracy should be trusted.",
  },
  manual: { label: "Entered coordinates", note: "Typed or pasted by the user. Not verified against any device." },
  "map-click": { label: "Chosen on the map", note: "Picked by clicking the map; accuracy is that of the map and the click." },
  geocoded: { label: "Address lookup", note: "Coordinates returned by a geocoding provider for a typed address or place." },
  imported: { label: "Imported location", note: "Loaded from a file or another system; its accuracy is unknown." },
  navic: { label: "NavIC receiver", note: "Position from a NavIC-compatible receiver (positioning, navigation and timing only; it carries no weather data)." },
};

export function isPositionSource(s: string): s is PositionSource {
  return (POSITION_SOURCES as readonly string[]).includes(s);
}

export type PositionCheck = { ok: true; info: PositionSourceInfo } | { ok: false; reason: string };

/** Validate the declared source. `navicEnabled` mirrors configuration; it must only be true with real receiver support. */
export function checkPositionSource(source: string, opts: { navicEnabled: boolean }): PositionCheck {
  if (!isPositionSource(source)) return { ok: false, reason: `Unknown position source "${source}". Use one of: ${POSITION_SOURCES.join(", ")}.` };
  if (source === "navic" && !opts.navicEnabled) {
    return {
      ok: false,
      reason: "No NavIC receiver integration is enabled on this server, so a position cannot be labelled NavIC. Use browser-geolocation, manual or map-click.",
    };
  }
  return { ok: true, info: { source, ...INFO[source] } };
}

/** The line shown beside a position, for example "POSITION SOURCE: Browser geolocation, accuracy 12 m". */
export function describePosition(source: PositionSource, accuracyM?: number | null): string {
  const acc = accuracyM === undefined || accuracyM === null ? "accuracy not reported" : `accuracy ${Math.round(accuracyM)} m`;
  return `POSITION SOURCE: ${INFO[source].label}, ${acc}`;
}
