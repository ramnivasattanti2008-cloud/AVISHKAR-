"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { DemoWorldPanel } from "@/components/demo/DemoWorldPanel";
import { api, describeError } from "@/lib/api";
import { positionLabel } from "@/lib/format";
import type { DemoWorld, Property } from "@/lib/types";

function PropertyCard({ p }: { p: Property }) {
  return (
    <Link href={`/property/${p.id}`} className="card block p-4 hover:border-accent">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex items-center gap-2 font-semibold">
          {p.name}
          {p.isDemo && <span className="badge" data-tone="demo" title="An invented property in a real place">DEMO</span>}
        </span>
        <span className="num text-sm text-muted">{p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}</span>
      </div>
      {!p.isDemo && <p className="mt-1 text-xs text-muted">{positionLabel(p.position.source, p.position.accuracyM)}</p>}
      {p.isDemo && p.address && <p className="mt-1 text-xs text-muted">{p.address}</p>}
      <p className="mt-1 text-xs text-muted">{p.geometry.status === "AVAILABLE" ? `Roof outline stored (${Math.round(p.geometry.items[0]?.areaM2 ?? 0)} m²)` : "No roof outline yet"}</p>
    </Link>
  );
}

export function PropertiesView() {
  const { user, loading } = useAuth();
  const [items, setItems] = useState<Property[] | null>(null);
  const [world, setWorld] = useState<DemoWorld | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!user) return;
    let live = true;
    Promise.all([api<{ properties: Property[] }>("/api/properties"), api<DemoWorld>("/api/demo/world")])
      .then(([r, w]) => {
        if (!live) return;
        setItems(r.properties);
        setWorld(w);
      })
      .catch((e) => live && setError(describeError(e)));
    return () => {
      live = false;
    };
  }, [user, version]);

  if (loading) return <p role="status" className="p-6 text-sm text-muted">Loading…</p>;
  if (!user) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold">Your properties</h1>
        <p className="mt-3 text-muted">
          <Link className="font-semibold text-accent underline" href="/login?next=/properties">Sign in</Link> to see the properties you have saved.
        </p>
      </div>
    );
  }
  const own = items?.filter((p) => !p.isDemo) ?? [];
  const demo = items?.filter((p) => p.isDemo) ?? [];
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Your properties</h1>
        <Link href="/map" className="btn btn-primary">Add on the map</Link>
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-[color:var(--tone-unavailable-fg)]">{error}</p>}
      {items && own.length === 0 && <p className="card mt-6 p-5 text-muted">No properties of your own yet. Open the map, choose a place and select “Analyze this property”{world ? ", or try the demo world below" : ""}.</p>}
      {own.length > 0 && (
        <ul className="mt-6 grid gap-3" aria-label="Your own properties">
          {own.map((p) => <li key={p.id}><PropertyCard p={p} /></li>)}
        </ul>
      )}
      {demo.length > 0 && (
        <section aria-labelledby="demo-properties" className="mt-8">
          <h2 id="demo-properties" className="text-lg font-semibold">Demo properties</h2>
          <p className="mt-1 text-sm text-muted">Invented, and kept apart from your own: nothing here is added up with them.</p>
          <ul className="mt-3 grid gap-3" aria-label="Demo properties">
            {demo.map((p) => <li key={p.id}><PropertyCard p={p} /></li>)}
          </ul>
        </section>
      )}
      {world && <DemoWorldPanel world={world} onChange={reload} />}
    </div>
  );
}
