"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { SystemHealth } from "@/lib/types";

/** What each outside service feeds, in the owner's words. */
const FEEDS: Record<string, string> = {
  nominatim: "address search",
  "open-meteo": "weather and solar forecasts",
  "open-meteo-previous-runs": "forecast accuracy scores",
  "nasa-power": "the solar resource",
  overpass: "building outlines",
  "earth-search": "satellite scenes",
};

const RECHECK_MS = 120_000;

/** Plain sentences for what is not working right now, from the health check; empty when nothing is wrong. */
export function degradedLines(h: SystemHealth | null, unreachable: boolean): string[] {
  if (unreachable) return ["The AVISHKAR server is not answering, so nothing can be loaded or saved right now."];
  if (!h || h.status === "ok") return [];
  const out: string[] = [];
  if (h.database.state === "down") out.push("The database is not answering: nothing can be loaded or saved.");
  if (h.engine.state === "down") out.push("The planning engine is not answering: new plans and model forecasts are unavailable.");
  const bad = h.providers.filter((p) => p.state === "down" || p.state === "degraded");
  if (bad.length > 0) {
    const what = bad.map((p) => FEEDS[p.provider] ?? p.provider);
    out.push(`Failing recently: ${what.join(", ")}. Values from ${bad.length === 1 ? "it" : "them"} may be older than usual or missing, and are labelled so.`);
  }
  return out;
}

/**
 * A banner across every page when part of the system is down (spec sections 40 to 43: degraded mode). It reads the same health
 * check as the System page, from real recent calls, and says what is affected; it never hides values, it explains them.
 */
export function DegradedBanner() {
  const [state, setState] = useState<{ health: SystemHealth | null; unreachable: boolean }>({ health: null, unreachable: false });

  useEffect(() => {
    let live = true;
    const check = () =>
      api<SystemHealth>("/api/system/health")
        .then((h) => live && setState({ health: h, unreachable: false }))
        // a network failure or a 5xx from the proxy means the server itself is not answering
        .catch((e) => live && setState({ health: null, unreachable: !(e instanceof ApiError && e.status < 500) }));
    void check();
    const t = setInterval(check, RECHECK_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const lines = degradedLines(state.health, state.unreachable);
  if (lines.length === 0) return null;
  return (
    <div role="status" aria-label="Service status" className="border-b border-[color:var(--tone-updated-fg)] bg-[color:var(--tone-updated-bg)] px-4 py-2 text-sm text-[color:var(--tone-updated-fg)]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-semibold">Working with less than usual.</span>
        {lines.map((l) => (
          <span key={l}>{l}</span>
        ))}
        <Link href="/system" className="font-semibold underline">System status</Link>
      </div>
    </div>
  );
}
