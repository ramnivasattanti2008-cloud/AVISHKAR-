"use client";

import { useState } from "react";
import { api, describeError } from "@/lib/api";
import type { DemoWorld } from "@/lib/types";

/**
 * Adds the demo world to the signed-in account, or takes it out (spec sections 74 and 93). Each account gets its own copy;
 * everything in it is labelled DEMO DATA and kept apart from the owner's own properties.
 */
export function DemoWorldPanel({ world, onChange }: { world: DemoWorld; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const some = world.sites.some((s) => s.propertyId !== null);

  async function load() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api<{ created: number }>("/api/demo/world", { method: "POST" });
      setMessage({ tone: "ok", text: r.created ? `${r.created} demo propert${r.created === 1 ? "y was" : "ies were"} added. Open one to try the forecast, the plan and the what-if.` : "The demo world was already in your account; nothing was added." });
      onChange();
    } catch (e) {
      setMessage({ tone: "error", text: describeError(e) });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api<{ removed: number }>("/api/demo/world", { method: "DELETE" });
      setArmed(false);
      setMessage({ tone: "ok", text: `${r.removed} demo propert${r.removed === 1 ? "y was" : "ies were"} removed, with everything computed from them. Your own properties were not touched.` });
      onChange();
    } catch (e) {
      setMessage({ tone: "error", text: describeError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="demo-world" className="card mt-8 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="demo-world" className="text-lg font-semibold">Demo world</h2>
        <span className="badge" data-tone="demo">{world.label}</span>
      </div>
      <p className="mt-1 text-sm text-muted">
        Four invented properties in real places, to try everything before you have a meter file. Their readings and equipment are made
        up; the weather, the sun and the sourced tariffs are real. Everything computed from them is labelled DEMO, and they are never
        added up with your own properties.
      </p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {world.sites.map((s) => (
          <li key={s.key} className="rounded-md border border-[color:var(--border)] p-3 text-sm">
            <span className="font-semibold">{s.name}</span>
            <p className="mt-0.5 text-xs text-muted">{s.story}</p>
            <p className="mt-1 text-xs">{s.propertyId ? <>In your account{s.tariff ? `, on ${s.tariff}` : ""}.</> : "Not loaded."}</p>
          </li>
        ))}
      </ul>
      <details className="mt-3 text-xs text-muted">
        <summary className="cursor-pointer">What is invented and what is real</summary>
        <ul className="mt-2 list-disc pl-5">
          {world.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </details>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!world.loaded && (
          <button type="button" className="btn btn-primary" onClick={load} disabled={busy}>
            {busy ? "Adding…" : some ? "Add the missing demo properties" : "Add the demo properties"}
          </button>
        )}
        {some && !armed && (
          <button type="button" className="btn" onClick={() => setArmed(true)} disabled={busy}>Remove the demo properties</button>
        )}
        {some && armed && (
          <>
            <span className="text-sm">This deletes the demo properties and everything computed from them.</span>
            <button type="button" className="btn btn-primary" onClick={remove} disabled={busy}>Yes, remove them</button>
            <button type="button" className="btn" onClick={() => setArmed(false)} disabled={busy}>Keep them</button>
          </>
        )}
      </div>
      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={`mt-3 text-sm ${message.tone === "error" ? "text-[color:var(--tone-unavailable-fg)]" : ""}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}
