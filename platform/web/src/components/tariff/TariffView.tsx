"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, describeError } from "@/lib/api";
import { STATES } from "@/lib/states";
import { CONSUMER_LABELS } from "@/lib/tariff";
import type { TariffList, TariffPlan, Twin } from "@/lib/types";
import { useAuth } from "../AuthProvider";
import { PropertyTabs } from "../property/PropertyTabs";
import { usePropertyData } from "../property/usePropertyData";
import { BillEstimator } from "./BillEstimator";
import { CustomTariffForm } from "./CustomTariffForm";
import { EligibilityPanel } from "./EligibilityPanel";
import { TariffCard } from "./TariffCard";

type Message = { tone: "ok" | "error"; text: string } | null;

/** Choose or enter the electricity tariff of a property, estimate a bill, and see the subsidy rules (spec sections 22 to 24). */
export function TariffView({ id }: { id: string }) {
  const { user, loading: authLoading } = useAuth();
  const { property, twin, loading, error, notFound, reload, setTwin } = usePropertyData(id);
  const [filters, setFilters] = useState({ state: "", consumerType: "" });
  const [refresh, setRefresh] = useState(0);
  const [catalogue, setCatalogue] = useState<{ key: string; plans: TariffPlan[] } | { key: string; error: string } | null>(null);
  const [chosen, setChosen] = useState<{ id: string; plan: TariffPlan } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const catalogueKey = `${user?.id ?? "anon"}|${filters.state}|${filters.consumerType}|${refresh}`;
  useEffect(() => {
    if (!user) return;
    let live = true;
    api<TariffList>("/api/tariffs", { query: { state: filters.state || undefined, consumerType: filters.consumerType || undefined } })
      .then((r) => live && setCatalogue({ key: catalogueKey, plans: r.tariffs }))
      .catch((e) => live && setCatalogue({ key: catalogueKey, error: describeError(e) }));
    return () => {
      live = false;
    };
  }, [user, filters.state, filters.consumerType, catalogueKey]);

  const planId = property?.tariffPlanId ?? null;
  useEffect(() => {
    if (!planId) return;
    let live = true;
    api<TariffPlan>(`/api/tariffs/${planId}`)
      .then((plan) => live && setChosen({ id: planId, plan }))
      .catch(() => live && setChosen(null));
    return () => {
      live = false;
    };
  }, [planId, refresh]);

  if (loading || authLoading) return <p role="status" className="p-6 text-sm text-muted">Loading…</p>;
  if (!user || notFound) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold">Property not found</h1>
        <p className="mt-3 text-muted">
          {user ? "This property does not exist or is not yours." : "Sign in to choose a tariff."}{" "}
          <Link className="font-semibold text-accent underline" href={user ? "/properties" : `/login?next=/property/${id}/tariff`}>
            {user ? "Back to your properties" : "Sign in"}
          </Link>
        </p>
      </div>
    );
  }
  if (error || !property) return <p role="alert" className="p-6 text-sm text-[color:var(--tone-unavailable-fg)]">{error ?? "Could not load the property."}</p>;

  const current = planId && chosen?.id === planId ? chosen.plan : null;
  const list = catalogue?.key === catalogueKey && "plans" in catalogue ? catalogue.plans : null;
  const listError = catalogue?.key === catalogueKey && "error" in catalogue ? catalogue.error : null;
  const twinTariffId = twin?.tariff.value?.planId ?? null;
  const twinOutOfDate = twin !== null && twinTariffId !== planId;

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ tone: "ok", text: await action() });
    } catch (e) {
      setMessage({ tone: "error", text: describeError(e) });
    } finally {
      setBusy(false);
    }
  }

  const choose = (plan: TariffPlan) =>
    run(async () => {
      await api(`/api/properties/${id}/tariff`, { method: "PUT", body: { tariffPlanId: plan.id } });
      await reload();
      return `${plan.name} is now the tariff of this property. Analyze again to record it in the Energy Twin.`;
    });

  const clear = () =>
    run(async () => {
      await api(`/api/properties/${id}/tariff`, { method: "DELETE" });
      setChosen(null);
      await reload();
      return "The tariff was removed from this property.";
    });

  const analyze = () =>
    run(async () => {
      setTwin(await api<Twin>(`/api/properties/${id}/analyze`, { method: "POST" }));
      await reload();
      return "A new Energy Twin version was built with this tariff.";
    });

  const remove = (plan: TariffPlan) =>
    run(async () => {
      await api(`/api/tariffs/${plan.id}`, { method: "DELETE" });
      setRefresh((n) => n + 1);
      await reload();
      return `${plan.name} was deleted.`;
    });

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <header>
        <h1 className="text-2xl font-bold">{property.name}</h1>
        <p className="text-sm text-muted">Electricity tariff and subsidy rules</p>
      </header>
      <div className="mt-4">
        <PropertyTabs id={id} current="/tariff" />
      </div>

      <div aria-live="polite" className="mt-3 min-h-6">
        {message && (
          <p role={message.tone === "error" ? "alert" : "status"} className={`rounded-md p-2 text-sm ${message.tone === "error" ? "bg-[color:var(--tone-unavailable-bg)] text-[color:var(--tone-unavailable-fg)]" : "bg-[color:var(--tone-live-bg)] text-[color:var(--tone-live-fg)]"}`}>
            {message.text}
          </p>
        )}
      </div>

      {twinOutOfDate && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md bg-[color:var(--tone-updated-bg)] p-3 text-sm text-[color:var(--tone-updated-fg)]">
          <span>{planId ? "The latest Energy Twin was built with a different tariff (or none)." : "The latest Energy Twin still records a tariff that is no longer chosen."} Analyze again to bring it up to date.</span>
          <button type="button" className="btn" onClick={analyze} disabled={busy}>
            {busy ? "Working…" : "Analyze again"}
          </button>
        </div>
      )}

      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          {current ? (
            <section aria-label="Tariff of this property">
              <h2 className="mb-2 text-base font-semibold">Tariff of this property</h2>
              <TariffCard
                plan={current}
                actions={
                  <button type="button" className="btn" onClick={clear} disabled={busy}>
                    Remove from this property
                  </button>
                }
              />
            </section>
          ) : (
            <section className="card p-4 text-sm" aria-label="No tariff chosen">
              <h2 className="text-base font-semibold">No tariff chosen yet</h2>
              <p className="mt-1 text-muted">AVISHKAR does not assume a tariff for you. Choose one from the catalogue, or enter the rates on your bill. Until then the Energy Twin lists the tariff as unavailable.</p>
            </section>
          )}
          {current && <BillEstimator plan={current} />}
          <EligibilityPanel suggestedKwp={twin?.solar.capacityKwEstimate.value ?? null} />
        </div>

        <div className="flex flex-col gap-4">
          <section aria-label="Tariff catalogue">
            <h2 className="text-base font-semibold">Choose a tariff</h2>
            <p className="mt-0.5 text-xs text-muted">Catalogue plans come from regulator orders and show their source and the period they cover. Tariffs change: compare with your latest bill.</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-sm">
                <span className="sr-only">State</span>
                <select className="field" value={filters.state} onChange={(e) => setFilters((f) => ({ ...f, state: e.target.value }))}>
                  <option value="">All states</option>
                  {STATES.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="sr-only">Consumer type</span>
                <select className="field" value={filters.consumerType} onChange={(e) => setFilters((f) => ({ ...f, consumerType: e.target.value }))}>
                  <option value="">All consumer types</option>
                  {Object.entries(CONSUMER_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-3 flex flex-col gap-3">
              {listError && <p role="alert" className="rounded-md bg-[color:var(--tone-unavailable-bg)] p-2 text-sm text-[color:var(--tone-unavailable-fg)]">{listError}</p>}
              {!list && !listError && <p role="status" className="text-sm text-muted">Loading tariffs…</p>}
              {list?.length === 0 && (
                <p className="card p-3 text-sm text-muted">
                  No catalogue tariff matches. The catalogue holds only orders that have been read and recorded with their source; it is small. Enter your own rates below.
                </p>
              )}
              {list?.map((p) => (
                <TariffCard
                  key={p.id}
                  plan={p}
                  compact
                  actions={
                    <>
                      <button type="button" className="btn btn-primary" onClick={() => choose(p)} disabled={busy || p.id === planId}>
                        {p.id === planId ? "Chosen for this property" : "Use for this property"}
                      </button>
                      {p.origin === "USER" && (
                        <button type="button" className="btn" onClick={() => remove(p)} disabled={busy}>
                          Delete
                        </button>
                      )}
                    </>
                  }
                />
              ))}
            </div>
          </section>

          <CustomTariffForm
            onCreated={(plan) => {
              setRefresh((n) => n + 1);
              void choose(plan);
            }}
          />
        </div>
      </div>
    </div>
  );
}
