"use client";

import Link from "next/link";
import { type ReactNode, useState } from "react";
import { api, describeError } from "@/lib/api";
import type { Appliance, Battery, Ev, SolarSystem } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { useAuth } from "../AuthProvider";
import { PropertyTabs } from "../property/PropertyTabs";
import { usePropertyData } from "../property/usePropertyData";
import { ApplianceCard, BatteryCard, EvCard, SolarCard } from "./AssetCards";
import { ApplianceForm, BatteryForm, EvForm, SolarForm } from "./AssetForms";

type Editing<T> = { mode: "none" } | { mode: "add" } | { mode: "edit"; item: T };

/** Everything the property has: batteries, solar systems, electric vehicles and appliances (spec sections 25 to 31). */
export function AssetsView({ id }: { id: string }) {
  const { user, loading: authLoading } = useAuth();
  const { property, loading, error, notFound } = usePropertyData(id);
  const ready = Boolean(user && property);
  const batteries = useApi<{ batteries: Battery[] }>(ready ? `/api/properties/${id}/batteries` : null);
  const solar = useApi<{ solarSystems: SolarSystem[] }>(ready ? `/api/properties/${id}/solar-systems` : null);
  const evs = useApi<{ evs: Ev[] }>(ready ? `/api/properties/${id}/evs` : null);
  const appliances = useApi<{ appliances: Appliance[] }>(ready ? `/api/properties/${id}/appliances` : null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading || authLoading) return <p role="status" className="p-6 text-sm text-muted">Loading…</p>;
  if (!user || notFound) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold">Property not found</h1>
        <p className="mt-3 text-muted">
          {user ? "This property does not exist or is not yours." : "Sign in to manage assets."}{" "}
          <Link className="font-semibold text-accent underline" href={user ? "/properties" : `/login?next=/property/${id}/assets`}>
            {user ? "Back to your properties" : "Sign in"}
          </Link>
        </p>
      </div>
    );
  }
  if (error || !property) return <p role="alert" className="p-6 text-sm text-[color:var(--tone-unavailable-fg)]">{error ?? "Could not load the property."}</p>;

  async function remove(kind: string, itemId: string, name: string, reload: () => void) {
    setBusy(true);
    setMessage(null);
    try {
      await api(`/api/properties/${id}/${kind}/${itemId}`, { method: "DELETE" });
      reload();
      setMessage({ tone: "ok", text: `${name} was deleted. Analyze the property again to bring the Energy Twin up to date.` });
    } catch (e) {
      setMessage({ tone: "error", text: describeError(e) });
    } finally {
      setBusy(false);
    }
  }

  const saved = (reload: () => void, setEditing: (e: Editing<never>) => void) => () => {
    reload();
    setEditing({ mode: "none" });
    setMessage({ tone: "ok", text: "Saved. Analyze the property again to bring the Energy Twin up to date." });
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <header>
        <h1 className="text-2xl font-bold">{property.name}</h1>
        <p className="text-sm text-muted">Batteries, solar, vehicles and appliances</p>
      </header>
      <div className="mt-4">
        <PropertyTabs id={id} current="/assets" />
      </div>
      <p className="mt-3 text-sm text-muted">
        What you enter here is what you say it is: AVISHKAR does not check it against the equipment. Anything you leave blank uses a labelled default, shown on the card. The Energy Twin records these the next time you analyze the property.
      </p>
      <div aria-live="polite" className="mt-3 min-h-6">
        {message && (
          <p role={message.tone === "error" ? "alert" : "status"} className={`rounded-md p-2 text-sm ${message.tone === "error" ? "bg-[color:var(--tone-unavailable-bg)] text-[color:var(--tone-unavailable-fg)]" : "bg-[color:var(--tone-live-bg)] text-[color:var(--tone-live-fg)]"}`}>
            {message.text}
          </p>
        )}
      </div>

      <div className="mt-2 grid gap-6 lg:grid-cols-2">
        <Section
          title="Batteries"
          empty="No battery entered. Without one the planner can only shift loads, not store solar."
          addLabel="Add a battery"
          state={batteries}
          items={batteries.data?.batteries}
          form={(editing, done, cancel) => <BatteryForm propertyId={id} initial={editing.mode === "edit" ? editing.item : undefined} onSaved={done} onCancel={cancel} />}
          card={(b, actions) => <BatteryCard key={b.id} b={b} actions={actions} />}
          kind="batteries"
          onSaved={saved}
          onDelete={remove}
          busy={busy}
        />
        <Section
          title="Solar systems"
          empty="No solar system entered. Add an installed one to forecast its output, or a planned one to test."
          addLabel="Add a solar system"
          state={solar}
          items={solar.data?.solarSystems}
          form={(editing, done, cancel) => <SolarForm propertyId={id} initial={editing.mode === "edit" ? editing.item : undefined} onSaved={done} onCancel={cancel} />}
          card={(s, actions) => <SolarCard key={s.id} s={s} actions={actions} />}
          kind="solar-systems"
          onSaved={saved}
          onDelete={remove}
          busy={busy}
        />
        <Section
          title="Electric vehicles"
          empty="No electric vehicle entered. Add one so charging can be placed in the cheapest or sunniest hours."
          addLabel="Add an electric vehicle"
          state={evs}
          items={evs.data?.evs}
          form={(editing, done, cancel) => <EvForm propertyId={id} initial={editing.mode === "edit" ? editing.item : undefined} onSaved={done} onCancel={cancel} />}
          card={(e, actions) => <EvCard key={e.id} e={e} actions={actions} />}
          kind="evs"
          onSaved={saved}
          onDelete={remove}
          busy={busy}
        />
        <Section
          title="Appliances"
          empty="No appliances entered. Add them, and mark the critical ones (fridge, medical equipment, router): the optimiser keeps those running in an outage."
          addLabel="Add an appliance"
          state={appliances}
          items={appliances.data?.appliances}
          form={(editing, done, cancel) => <ApplianceForm propertyId={id} initial={editing.mode === "edit" ? editing.item : undefined} onSaved={done} onCancel={cancel} />}
          card={(a, actions) => <ApplianceCard key={a.id} a={a} actions={actions} />}
          kind="appliances"
          onSaved={saved}
          onDelete={remove}
          busy={busy}
        />
      </div>
    </div>
  );
}

interface SectionProps<T extends { id: string; name: string }> {
  title: string;
  empty: string;
  addLabel: string;
  state: { error: string | null; loading: boolean; reload(): void; data: unknown };
  items: T[] | undefined;
  kind: string;
  form(editing: Editing<T>, done: () => void, cancel: () => void): ReactNode;
  card(item: T, actions: ReactNode): ReactNode;
  onSaved(reload: () => void, setEditing: (e: Editing<never>) => void): () => void;
  onDelete(kind: string, itemId: string, name: string, reload: () => void): void;
  busy: boolean;
}

function Section<T extends { id: string; name: string }>({ title, empty, addLabel, state, items, kind, form, card, onSaved, onDelete, busy }: SectionProps<T>) {
  const [editing, setEditing] = useState<Editing<T>>({ mode: "none" });
  return (
    <section aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {editing.mode === "none" && (
          <button type="button" className="btn" onClick={() => setEditing({ mode: "add" })}>
            {addLabel}
          </button>
        )}
      </div>
      {editing.mode !== "none" && form(editing, onSaved(state.reload, setEditing as (e: Editing<never>) => void), () => setEditing({ mode: "none" }))}
      <div className="mt-3 flex flex-col gap-3">
        {state.error && <p role="alert" className="text-sm text-[color:var(--tone-unavailable-fg)]">{state.error}</p>}
        {!items && !state.error && <p role="status" className="text-sm text-muted">Loading…</p>}
        {items?.length === 0 && editing.mode === "none" && <p className="card p-3 text-sm text-muted">{empty}</p>}
        {items?.map((item) =>
          card(
            item,
            <>
              <button type="button" className="btn" onClick={() => setEditing({ mode: "edit", item })} disabled={busy} aria-label={`Change ${item.name}`}>
                Change
              </button>
              <button type="button" className="btn" onClick={() => onDelete(kind, item.id, item.name, state.reload)} disabled={busy} aria-label={`Delete ${item.name}`}>
                Delete
              </button>
            </>,
          ),
        )}
      </div>
    </section>
  );
}
