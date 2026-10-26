"use client";

import { type ReactNode, useId } from "react";

/** A fraction (0.95) as the percent a person types (95), without floating-point noise. */
export const toPct = (f: number | null | undefined): string => (f === null || f === undefined ? "" : String(Math.round(f * 10_000) / 100));

/** The percent typed (95) as a fraction (0.95); null when blank, NaN when not a number so the server refuses it. */
export const fromPct = (s: string): number | null => (s.trim() === "" ? null : Number(s) / 100);

/** A number typed; null when blank, NaN when not a number so the server refuses it with its own explanation. */
export const num = (s: string): number | null => (s.trim() === "" ? null : Number(s));

export const str = (v: string | number | null | undefined): string => (v === null || v === undefined ? "" : String(v));

interface FieldProps {
  label: string;
  value: string;
  onChange(v: string): void;
  hint?: string;
  required?: boolean;
  type?: "text" | "number" | "time" | "date";
  placeholder?: string;
  list?: string;
  className?: string;
}

export function Field({ label, value, onChange, hint, required, type = "text", placeholder, list, className }: FieldProps) {
  const id = useId();
  return (
    <div className={`text-sm ${className ?? ""}`}>
      <label htmlFor={id} className="text-muted">
        {label}
        {required ? "" : " (optional)"}
      </label>
      <input
        id={id}
        className="field mt-1"
        type={type === "number" ? "text" : type}
        inputMode={type === "number" ? "decimal" : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        list={list}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-0.5 text-xs text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

export function SelectField({ label, value, onChange, options, hint, className }: { label: string; value: string; onChange(v: string): void; options: { value: string; label: string }[]; hint?: string; className?: string }) {
  const id = useId();
  return (
    <div className={`text-sm ${className ?? ""}`}>
      <label htmlFor={id} className="text-muted">
        {label}
      </label>
      <select id={id} className="field mt-1" value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={hint ? `${id}-hint` : undefined}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && (
        <p id={`${id}-hint`} className="mt-0.5 text-xs text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

export function FormShell({ title, children, onSubmit, onCancel, busy, error, submitLabel }: { title: string; children: ReactNode; onSubmit(): void; onCancel(): void; busy: boolean; error: string | null; submitLabel: string }) {
  return (
    <form
      className="card mt-3 grid gap-3 p-4 sm:grid-cols-2"
      aria-label={title}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <h3 className="text-sm font-semibold sm:col-span-2">{title}</h3>
      {children}
      {error && (
        <p role="alert" className="rounded-md bg-[color:var(--tone-unavailable-bg)] p-2 text-sm text-[color:var(--tone-unavailable-fg)] sm:col-span-2">
          {error}
        </p>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export const STATUS_OPTIONS = [
  { value: "EXISTING" as const, label: "Installed and in use" },
  { value: "PLANNED" as const, label: "Planned (used in what-if runs only)" },
];
