"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, describeError } from "@/lib/api";
import { formatNumber, positionLabel } from "@/lib/format";
import type { Property, Twin } from "@/lib/types";
import { useAuth } from "../AuthProvider";

interface PropertyFullData {
  property: Property;
  twin: Twin | null;
}

export function PropertyComparisonView() {
  const { user, loading: authLoading } = useAuth();
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailedData, setDetailedData] = useState<Record<string, PropertyFullData>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let live = true;
    api<{ properties: Property[] }>("/api/properties")
      .then((res) => {
        if (!live) return;
        setProperties(res.properties);
        if (res.properties.length >= 2 && res.properties[0] && res.properties[1]) {
          setSelectedIds([res.properties[0].id, res.properties[1].id]);
        } else if (res.properties.length === 1 && res.properties[0]) {
          setSelectedIds([res.properties[0].id]);
        }
      })
      .catch((err) => live && setError(describeError(err)));
    return () => {
      live = false;
    };
  }, [user]);

  // Load detailed twin for selected properties
  useEffect(() => {
    if (selectedIds.length === 0) return;
    let live = true;

    Promise.all(
      selectedIds.map(async (id) => {
        const prop = properties?.find((p) => p.id === id);
        if (!prop) return null;
        try {
          const twinRes = await api<Twin>(`/api/properties/${id}/twin`).catch(() => null);
          return { id, data: { property: prop, twin: twinRes } };
        } catch {
          return { id, data: { property: prop, twin: null } };
        }
      }),
    ).then((results) => {
      if (!live) return;
      const map: Record<string, PropertyFullData> = {};
      for (const r of results) {
        if (r) map[r.id] = r.data;
      }
      setDetailedData(map);
    });

    return () => {
      live = false;
    };
  }, [selectedIds, properties]);

  function toggleProperty(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  if (authLoading) return <p role="status" className="p-6 text-sm text-muted">Loading…</p>;
  if (!user) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold">Property Comparison</h1>
        <p className="mt-3 text-muted">
          <Link className="font-semibold text-accent underline" href="/login?next=/properties/compare">Sign in</Link> to compare properties.
        </p>
      </div>
    );
  }

  const selectedList = selectedIds.map((id) => detailedData[id]).filter(Boolean) as PropertyFullData[];

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/properties" className="text-sm font-semibold text-accent hover:underline">
              ← Properties
            </Link>
          </div>
          <h1 className="mt-1 text-2xl font-bold">Property Comparison Matrix</h1>
          <p className="mt-1 text-sm text-muted">
            Side-by-side technical and financial comparison of solar potential, storage assets, and net-metering eligibility.
          </p>
        </div>
        <Link href="/map" className="btn btn-primary">
          Add on the map
        </Link>
      </div>

      {error && <p role="alert" className="mt-4 text-sm text-[color:var(--tone-unavailable-fg)]">{error}</p>}

      {/* Property Selector Bar */}
      {properties && properties.length > 0 && (
        <section className="card mt-6 p-4" aria-label="Select properties to compare">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">Select properties to include:</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {properties.map((p) => {
              const active = selectedIds.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggleProperty(p.id)}
                  className={`btn text-xs ${active ? "btn-primary font-medium" : "btn-neutral"}`}
                  aria-pressed={active}
                >
                  {active ? "✓ " : "+ "}
                  {p.name}
                  {p.isDemo ? " (DEMO)" : ""}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Comparison Matrix Table */}
      {selectedList.length === 0 ? (
        <p className="card mt-6 p-6 text-center text-sm text-muted">
          Select at least one property above to inspect and compare its parameters.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-surface/50">
          <table className="w-full text-left text-sm" aria-label="Property comparison table">
            <thead>
              <tr className="border-b border-line bg-surface/80">
                <th scope="col" className="p-4 font-semibold text-muted min-w-[200px]">Property Metric</th>
                {selectedList.map(({ property: p }) => (
                  <th key={p.id} scope="col" className="p-4 font-semibold min-w-[240px]">
                    <div className="flex items-center gap-2">
                      <span className="text-base text-ink">{p.name}</span>
                      {p.isDemo && <span className="badge" data-tone="demo">DEMO</span>}
                    </div>
                    <span className="num text-xs font-normal text-muted">
                      {p.latitude.toFixed(4)}, {p.longitude.toFixed(4)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {/* Location & Address */}
              <tr>
                <th scope="row" className="p-4 font-medium text-muted bg-surface/20">Address / Position Source</th>
                {selectedList.map(({ property: p }) => (
                  <td key={p.id} className="p-4 text-xs text-muted">
                    {p.address ?? positionLabel(p.position.source, p.position.accuracyM)}
                  </td>
                ))}
              </tr>

              {/* Roof Area & Geometry */}
              <tr>
                <th scope="row" className="p-4 font-medium text-muted bg-surface/20">Roof Outline & Usable Area</th>
                {selectedList.map(({ property: p, twin: t }) => (
                  <td key={p.id} className="p-4">
                    <span className="num font-semibold text-ink">
                      {t?.solar?.usableRoofAreaM2?.value ? `${Math.round(t.solar.usableRoofAreaM2.value)} m² usable` : "—"}
                    </span>
                    <p className="text-xs text-muted">
                      {p.geometry.status === "AVAILABLE" ? "Footprint stored" : "Point location only"}
                    </p>
                  </td>
                ))}
              </tr>

              {/* Solar Potential */}
              <tr>
                <th scope="row" className="p-4 font-medium text-muted bg-surface/20">Solar Potential & Daily Yield</th>
                {selectedList.map(({ property: p, twin: t }) => (
                  <td key={p.id} className="p-4">
                    <div className="num font-semibold text-amber-500">
                      {t?.solar?.capacityKwEstimate?.value ? `${t.solar.capacityKwEstimate.value.toFixed(1)} kWp potential` : "—"}
                    </div>
                    <p className="num text-xs text-muted">
                      {t?.solar?.estimatedDailyGenerationKwh?.value ? `~${formatNumber(t.solar.estimatedDailyGenerationKwh.value)} kWh/day yield` : "—"}
                    </p>
                  </td>
                ))}
              </tr>

              {/* Installed Solar Assets */}
              <tr>
                <th scope="row" className="p-4 font-medium text-muted bg-surface/20">Existing Solar Systems</th>
                {selectedList.map(({ property: p, twin: t }) => {
                  const s = t?.profiles?.solar?.value;
                  return (
                    <td key={p.id} className="p-4">
                      <span className="num font-semibold text-ink">
                        {s ? `${s.existingKwp.toFixed(1)} kWp installed` : "None installed"}
                      </span>
                    </td>
                  );
                })}
              </tr>

              {/* Installed Batteries */}
              <tr>
                <th scope="row" className="p-4 font-medium text-muted bg-surface/20">Battery Energy Storage (BESS)</th>
                {selectedList.map(({ property: p, twin: t }) => {
                  const b = t?.profiles?.battery?.value;
                  return (
                    <td key={p.id} className="p-4">
                      <span className="num font-semibold text-emerald-500">
                        {b ? `${b.totalCapacityKwh.toFixed(1)} kWh (${b.count} unit${b.count > 1 ? "s" : ""})` : "None installed"}
                      </span>
                    </td>
                  );
                })}
              </tr>

              {/* EV & Controllable Loads */}
              <tr>
                <th scope="row" className="p-4 font-medium text-muted bg-surface/20">EV & Schedulable Appliances</th>
                {selectedList.map(({ property: p, twin: t }) => {
                  const ev = t?.profiles?.ev?.value;
                  const app = t?.profiles?.appliances?.value;
                  return (
                    <td key={p.id} className="p-4 text-xs">
                      {ev ? `${ev.count} EV Charger (${ev.totalBatteryKwh} kWh)` : "No EV"}{", "}
                      {app ? `${app.count} managed appliances (${app.totalRatedKw} kW)` : "No smart appliances"}
                    </td>
                  );
                })}
              </tr>

              {/* Net-Metering Mode & Tariff */}
              <tr>
                <th scope="row" className="p-4 font-medium text-muted bg-surface/20">Utility Tariff & Metering</th>
                {selectedList.map(({ property: p, twin: t }) => {
                  const plan = t?.tariff?.value;
                  return (
                    <td key={p.id} className="p-4 text-xs">
                      {plan ? (
                        <>
                          <div className="font-semibold text-ink">{plan.name}</div>
                          <div className="text-muted">{plan.discom ?? "DISCOM"} · {plan.exportRateBasis}</div>
                        </>
                      ) : (
                        <span className="text-muted">No tariff assigned</span>
                      )}
                    </td>
                  );
                })}
              </tr>

              {/* Direct Navigation Links */}
              <tr>
                <th scope="row" className="p-4 font-medium text-muted bg-surface/20">Quick Navigation</th>
                {selectedList.map(({ property: p }) => (
                  <td key={p.id} className="p-4">
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      <Link href={`/property/${p.id}/today`} className="btn btn-neutral text-xs py-1 px-2">
                        Today
                      </Link>
                      <Link href={`/property/${p.id}/plan`} className="btn btn-neutral text-xs py-1 px-2">
                        Plan
                      </Link>
                      <Link href={`/property/${p.id}/planner`} className="btn btn-primary text-xs py-1 px-2">
                        Planner
                      </Link>
                    </div>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
