"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Property } from "@/lib/types";
import { useAuth } from "./AuthProvider";

/** For someone signed in: a way straight to today for each of their properties. Nothing for a visitor, and nothing invented when there are none. */
export function HomeProperties() {
  const { user } = useAuth();
  const [items, setItems] = useState<Property[] | null>(null);

  useEffect(() => {
    if (!user) return;
    let live = true;
    api<{ properties: Property[] }>("/api/properties")
      .then((r) => live && setItems(r.properties))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [user]);

  if (!user || !items || items.length === 0) return null;
  return (
    <section className="mt-10" aria-labelledby="home-today">
      <h2 id="home-today" className="text-lg font-semibold">Your energy today</h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.slice(0, 6).map((p) => (
          <li key={p.id}>
            <Link href={`/property/${p.id}/today`} className="card block p-4 hover:border-accent">
              <span className="flex items-center gap-2 font-semibold">
                {p.name}
                {p.isDemo && <span className="badge" data-tone="demo">DEMO</span>}
              </span>
              <span className="mt-1 block text-sm text-muted">Generation, use, surplus, weather risk, backup, and what to do next</span>
            </Link>
          </li>
        ))}
      </ul>
      {items.length > 6 && <p className="mt-2 text-sm"><Link className="font-semibold text-accent underline" href="/properties">All {items.length} properties</Link></p>}
    </section>
  );
}
