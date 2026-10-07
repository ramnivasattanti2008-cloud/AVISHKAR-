"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { api, describeError } from "@/lib/api";
import { positionLabel } from "@/lib/format";
import type { Property } from "@/lib/types";

export default function PropertiesPage() {
  const { user, loading } = useAuth();
  const [items, setItems] = useState<Property[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let live = true;
    api<{ properties: Property[] }>("/api/properties")
      .then((r) => live && setItems(r.properties))
      .catch((e) => live && setError(describeError(e)));
    return () => {
      live = false;
    };
  }, [user]);

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
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Your properties</h1>
        <Link href="/map" className="btn btn-primary">Add on the map</Link>
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-[color:var(--tone-unavailable-fg)]">{error}</p>}
      {items && items.length === 0 && <p className="card mt-6 p-5 text-muted">No properties yet. Open the map, choose a place and select “Analyze this property”.</p>}
      <ul className="mt-6 grid gap-3">
        {items?.map((p) => (
          <li key={p.id}>
            <Link href={`/property/${p.id}`} className="card block p-4 hover:border-accent">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">{p.name}</span>
                <span className="num text-sm text-muted">{p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}</span>
              </div>
              <p className="mt-1 text-xs text-muted">{positionLabel(p.position.source, p.position.accuracyM)}</p>
              <p className="mt-1 text-xs text-muted">{p.geometry.status === "AVAILABLE" ? `Roof outline stored (${Math.round(p.geometry.items[0]?.areaM2 ?? 0)} m²)` : "No roof outline yet"}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
