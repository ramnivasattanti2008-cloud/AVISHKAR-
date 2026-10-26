import { STATUS, formatAge, formatDateTime, formatNumber } from "@/lib/format";
import type { DataStatus, Measured, Provenance } from "@/lib/types";

/** The label every value wears. It explains itself on hover and to screen readers. */
export function StatusBadge({ status }: { status: DataStatus }) {
  const m = STATUS[status];
  return (
    <span className="badge" data-tone={m.tone} title={m.meaning} aria-label={`${m.label}: ${m.meaning}`}>
      {m.label}
    </span>
  );
}

/** Where a value came from, when, how old it is and what to be careful about (spec sections 3 and 40). */
export function ProvenanceDetails({ p }: { p: Provenance }) {
  const when = p.observedAt ? `Observed ${formatDateTime(p.observedAt)}` : p.validFor ? `Valid for ${formatDateTime(p.validFor)}` : null;
  return (
    <details className="text-xs text-muted">
      <summary className="cursor-pointer select-none underline decoration-dotted underline-offset-2">source</summary>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <dt>Provider</dt>
        <dd className="text-ink">{p.provider}</dd>
        <dt>Source</dt>
        <dd className="text-ink">{p.source}</dd>
        {when && (
          <>
            <dt>Time</dt>
            <dd className="text-ink">{when}</dd>
          </>
        )}
        {p.ageSeconds !== undefined && (
          <>
            <dt>Age</dt>
            <dd className="text-ink num">{formatAge(p.ageSeconds)}</dd>
          </>
        )}
        <dt>Fetched</dt>
        <dd className="text-ink">{formatDateTime(p.generatedAt)}</dd>
        {p.confidence !== undefined && (
          <>
            <dt>Confidence</dt>
            <dd className="text-ink num">{Math.round(p.confidence * 100)}%</dd>
          </>
        )}
        <dt>Version</dt>
        <dd className="text-ink">{p.processingVersion}{p.modelVersion ? `, model ${p.modelVersion}` : ""}</dd>
      </dl>
      {p.notes.length > 0 && (
        <ul className="mt-1 list-disc pl-4">
          {p.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </details>
  );
}

/** A labelled value with its status, and its reason when there is no value. */
export function Measure({ label, m, digits }: { label: string; m: Measured<number>; digits?: number }) {
  const has = m.value !== null && m.provenance.status !== "UNAVAILABLE";
  const shown = has ? (digits === undefined ? formatNumber(m.value as number) : (m.value as number).toFixed(digits)) : "—";
  return (
    <div className="py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm text-muted">{label}</span>
        <span className="flex items-center gap-2">
          <span className="num text-base font-semibold" aria-label={has ? `${shown} ${m.unit ?? ""}` : "no value"}>
            {shown}
            {has && m.unit ? <span className="ml-1 text-sm font-normal text-muted">{m.unit}</span> : null}
          </span>
          <StatusBadge status={m.provenance.status} />
        </span>
      </div>
      {!has && m.provenance.notes[0] && <p className="mt-1 text-sm text-muted">{m.provenance.notes[0]}</p>}
      <div className="mt-0.5">
        <ProvenanceDetails p={m.provenance} />
      </div>
    </div>
  );
}
