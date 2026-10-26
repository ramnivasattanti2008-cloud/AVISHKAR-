"use client";

import { useId, useRef, useState } from "react";
import { ApiError, api, describeError } from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { ImportResult } from "@/lib/types";

export const MAX_FILE_BYTES = 24_000_000;

const UNITS = ["kWh", "Wh", "kW", "W"] as const;
type Unit = (typeof UNITS)[number];

const REASONS: Record<string, string> = {
  bad_timestamp: "the time could not be read",
  missing_value: "the usage was empty",
  bad_value: "the usage was not a number",
  negative_value: "the usage was negative",
  implausible_value: "the usage was too large for a home or small business",
  future_timestamp: "the time was in the future",
  duplicate_in_file: "the same time appeared twice (the first was kept)",
};

/**
 * Upload a meter file. The server reads the unit from the column header; when the header does not say, the person must,
 * because a wrong guess is wrong by a factor of four. Afterwards the panel accounts for every row of the file.
 */
export function ImportPanel({ propertyId, onImported }: { propertyId: string; onImported: () => void }) {
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [unit, setUnit] = useState<"" | Unit>("");
  const [state, setState] = useState<{ busy: boolean; error: string | null; needsUnit: boolean; result: ImportResult | null }>({ busy: false, error: null, needsUnit: false, result: null });

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    if (file.size === 0) return setState({ busy: false, error: "That file is empty.", needsUnit: false, result: null });
    if (file.size > MAX_FILE_BYTES) return setState({ busy: false, error: `That file is ${(file.size / 1e6).toFixed(1)} MB; the limit is ${MAX_FILE_BYTES / 1e6} MB. Split it by year and import the parts.`, needsUnit: false, result: null });
    setState({ busy: true, error: null, needsUnit: false, result: null });
    try {
      const csv = await file.text();
      const result = await api<ImportResult>(`/api/properties/${propertyId}/energy/imports`, { method: "POST", body: { csv, filename: file.name, unit: unit || undefined } });
      setState({ busy: false, error: null, needsUnit: false, result });
      if (fileRef.current) fileRef.current.value = "";
      onImported();
    } catch (e) {
      setState({ busy: false, error: describeError(e), needsUnit: e instanceof ApiError && /does not say its unit/.test(e.message), result: null });
    }
  }

  const r = state.result?.import;
  return (
    <section className="card p-4" aria-label="Import a meter file">
      <h2 className="text-base font-semibold">Import a meter file</h2>
      <p className="mt-0.5 text-xs text-muted">
        A CSV with a timestamp column and one usage column, from your smart meter or your distribution company&rsquo;s portal. Readings stay in your account. Nothing is repaired or filled in: a gap stays a gap.
      </p>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          void upload();
        }}
      >
        <div className="text-sm">
          <label htmlFor={inputId} className="text-muted">
            File
          </label>
          <input id={inputId} ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" className="field mt-1" />
        </div>
        <div className="text-sm">
          <label htmlFor={`${inputId}-unit`} className="text-muted">
            Unit of the usage column
          </label>
          <select id={`${inputId}-unit`} className="field mt-1" value={unit} onChange={(e) => setUnit(e.target.value as "" | Unit)} aria-describedby={`${inputId}-unit-hint`}>
            <option value="">Read it from the column header</option>
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <p id={`${inputId}-unit-hint`} className="text-xs text-muted sm:col-span-2">
          kW or W is power, kWh or Wh is energy in each reading. If the header does not say, choose it here: AVISHKAR will not guess.
        </p>
        <div className="sm:col-span-2">
          <button type="submit" className="btn btn-primary" disabled={state.busy}>
            {state.busy ? "Importing…" : "Import"}
          </button>
        </div>
      </form>

      <div aria-live="polite">
        {state.error && (
          <p role="alert" className="mt-3 rounded-md bg-[color:var(--tone-unavailable-bg)] p-2 text-sm text-[color:var(--tone-unavailable-fg)]">
            {state.error}
            {state.needsUnit && <span className="mt-1 block">Choose the unit above and import again.</span>}
          </p>
        )}
        {r && (
          <div className="mt-3 rounded-md bg-[color:var(--tone-live-bg)] p-3 text-sm text-[color:var(--tone-live-fg)]">
            <p className="font-semibold">
              {r.filename ?? "The file"}: {formatNumber(r.accepted)} reading{r.accepted === 1 ? "" : "s"} stored.
            </p>
            <p className="mt-1">
              {formatNumber(r.rows)} rows in the file: {formatNumber(r.accepted)} stored, {formatNumber(r.rejected)} refused, {formatNumber(r.duplicates)} already there. Readings every {r.intervalMinutes} minutes, usage in {r.unit} (column “{r.usageColumn}”)
              {r.from && r.to ? `, ${formatDateTime(r.from)} to ${formatDateTime(r.to)}` : ""}.
            </p>
            {Object.keys(r.rejectedByReason).length > 0 && (
              <ul className="mt-2 list-disc pl-5">
                {Object.entries(r.rejectedByReason).map(([k, n]) => (
                  <li key={k}>
                    {formatNumber(n)}: {REASONS[k] ?? k}
                  </li>
                ))}
              </ul>
            )}
            {r.gaps.missingIntervals > 0 && (
              <p className="mt-2">
                {formatNumber(r.gaps.missingIntervals)} readings are missing between the first and the last; the longest gap is {formatNumber(Math.round(r.gaps.longestGapMinutes / 60))} h. They are left as gaps.
              </p>
            )}
            <ul className="mt-2 list-disc pl-5">
              {r.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            {state.result?.dnaUnavailableReason && <p className="mt-2 rounded bg-[color:var(--tone-updated-bg)] p-2 text-[color:var(--tone-updated-fg)]">No Energy DNA yet: {state.result.dnaUnavailableReason}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
