"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { api, describeError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { CopilotAnswer, CopilotTools, DataStatus } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { useAuth } from "../AuthProvider";
import { StatusBadge } from "../Provenance";
import { PropertyTabs } from "../property/PropertyTabs";
import { usePropertyData } from "../property/usePropertyData";

interface Turn {
  id: number;
  question: string;
  answer: CopilotAnswer | null;
  error: string | null;
}

/** [1] markers in an answer become buttons that open the result the sentence came from. */
function Paragraph({ text, open, onOpen }: { text: string; open: Set<number>; onOpen(marker: number): void }) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <p>
      {parts.map((part, i) => {
        const m = /^\[(\d+)\]$/.exec(part);
        if (!m) return <Fragment key={i}>{part}</Fragment>;
        const n = Number(m[1]);
        return (
          <button key={i} type="button" className="mx-0.5 align-super text-[0.7em] font-semibold text-accent underline" aria-pressed={open.has(n)} aria-label={`Show the data behind source ${n}`} onClick={() => onOpen(n)}>
            {n}
          </button>
        );
      })}
    </p>
  );
}

function Answer({ a }: { a: CopilotAnswer }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (n: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  const result = (marker: number) => {
    const c = a.citations.find((x) => x.marker === marker);
    return c ? a.toolResults.find((r) => r.id === c.toolResultId) : undefined;
  };
  return (
    <div className="mt-2 rounded-md border border-line p-3 text-sm">
      <div className="space-y-2">
        {a.paragraphs.map((p, i) => (
          <Paragraph key={i} text={p} open={open} onOpen={toggle} />
        ))}
      </div>
      {a.status === "NOT_UNDERSTOOD" && (
        <ul className="mt-2 list-disc pl-5 text-muted">
          {a.suggestions.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
      {a.notes.map((n) => (
        <p key={n} role="status" className="mt-2 rounded-md bg-[color:var(--tone-updated-bg)] p-2 text-[color:var(--tone-updated-fg)]">{n}</p>
      ))}
      {a.citations.length > 0 && (
        <div className="mt-3 space-y-2" aria-label="Supporting data">
          {[...open].sort().map((n) => {
            const r = result(n);
            if (!r) return null;
            return (
              <section key={n} className="rounded-md bg-surface2 p-2" aria-label={`Source ${n}: ${r.tool}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold">Source {n}: {r.tool}</h3>
                  {r.dataStatus && <StatusBadge status={r.dataStatus as DataStatus} />}
                </div>
                <p className="text-xs text-muted">Looked up {formatDateTime(r.calledAt)}</p>
                {r.status === "UNAVAILABLE" ? <p className="mt-1 text-xs">{r.unavailableReason}</p> : <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(r.output, null, 2)}</pre>}
              </section>
            );
          })}
          <p className="text-xs text-muted">Select a small number in the answer to see the data behind it.</p>
        </div>
      )}
      <p className="mt-2 text-xs text-muted">{a.generatedBy === "LANGUAGE_MODEL" ? "Worded by a language model; every number was checked against the results above." : "Written from fixed templates over the results; no language model."}</p>
    </div>
  );
}

/** Ask about the property. Every answer comes from the backend's own calculations and says where each figure came from (spec sections 44, 90, 91, 96). */
export function CopilotView({ id }: { id: string }) {
  const { user, loading: authLoading } = useAuth();
  const { property, loading, error, notFound } = usePropertyData(id);
  const ready = Boolean(user && property);
  const tools = useApi<CopilotTools>(ready ? "/api/copilot/tools" : null);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);

  if (loading || authLoading) return <p role="status" className="p-6 text-sm text-muted">Loading…</p>;
  if (!user || notFound) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold">Property not found</h1>
        <p className="mt-3 text-muted">
          {user ? "This property does not exist or is not yours." : "Sign in to ask questions."}{" "}
          <Link className="font-semibold text-accent underline" href={user ? "/properties" : `/login?next=/property/${id}/ask`}>
            {user ? "Back to your properties" : "Sign in"}
          </Link>
        </p>
      </div>
    );
  }
  if (error || !property) return <p role="alert" className="p-6 text-sm text-[color:var(--tone-unavailable-fg)]">{error ?? "Could not load the property."}</p>;

  async function send(q: string) {
    const text = q.trim();
    if (!text || busy) return;
    const turn: Turn = { id: Date.now() + Math.random(), question: text, answer: null, error: null };
    setTurns((t) => [...t, turn]);
    setQuestion("");
    setBusy(true);
    try {
      const answer = await api<CopilotAnswer>(`/api/properties/${id}/copilot/ask`, { method: "POST", body: { question: text } });
      setTurns((t) => t.map((x) => (x.id === turn.id ? { ...x, answer } : x)));
    } catch (e) {
      setTurns((t) => t.map((x) => (x.id === turn.id ? { ...x, error: describeError(e) } : x)));
    } finally {
      setBusy(false);
    }
  }

  const lm = tools.data?.languageModel === true;
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <header>
        <h1 className="text-2xl font-bold">{property.name}</h1>
        <p className="text-sm text-muted">Ask about your energy</p>
      </header>
      <div className="mt-4">
        <PropertyTabs id={id} current="/ask" demo={property?.isDemo} />
      </div>

      <section className="card mt-4 p-4" aria-label="How this works">
        <p className="text-sm">
          Answers come from AVISHKAR’s own calculations for this property: your tariff, forecasts, plan and equipment. Nothing is made up, and a figure it cannot find is reported as missing. Select the small number after a sentence to see the data it came from.
        </p>
        <p className="mt-2 text-xs text-muted">
          {tools.data ? (lm ? "A language model words the answers, and its wording is rejected if it states a number the calculations did not return." : "The answers are written from fixed templates: there is no language model.") : ""} Asking it to make a plan, or what adding solar or a battery would do, saves the result.
        </p>
        {tools.data && (
          <details className="mt-2 text-xs text-muted">
            <summary className="cursor-pointer select-none font-medium">What it can look at ({tools.data.tools.length} tools)</summary>
            <ul className="mt-1 list-disc pl-5">
              {tools.data.tools.map((t) => (
                <li key={t.name}>
                  <span className="font-medium text-ink">{t.name}</span>: {t.description}
                  {t.writes ? " (saves its result)" : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="mt-4" aria-label="Conversation" aria-live="polite">
        {turns.map((t) => (
          <div key={t.id} className="mb-4">
            <p className="inline-block rounded-md bg-accent px-3 py-1.5 text-sm text-accent-ink">{t.question}</p>
            {t.error && <p role="alert" className="mt-2 rounded-md bg-[color:var(--tone-unavailable-bg)] p-2 text-sm text-[color:var(--tone-unavailable-fg)]">{t.error}</p>}
            {!t.answer && !t.error && <p role="status" className="mt-2 text-sm text-muted">Looking it up…</p>}
            {t.answer && <Answer a={t.answer} />}
          </div>
        ))}
      </section>

      <section className="card mt-4 p-4" aria-label="Report">
        <h2 className="text-base font-semibold">Take it with you</h2>
        <p className="mt-1 text-sm text-muted">A report of everything held for this property: tariff, readings, equipment, the latest plan and what-if, and how the forecasts have done, each figure with its label. It is assembled from what is stored, and says where something is missing.</p>
        <a className="btn mt-2 inline-block" href={`/api/properties/${id}/report`} download>Download the report</a>
      </section>

      <form
        className="card mt-2 p-4"
        aria-label="Ask a question"
        onSubmit={(e) => {
          e.preventDefault();
          void send(question);
        }}
      >
        <label htmlFor="copilot-q" className="text-sm font-medium">Your question</label>
        <div className="mt-1 flex gap-2">
          <input id="copilot-q" className="field flex-1" value={question} maxLength={300} onChange={(e) => setQuestion(e.target.value)} placeholder="for example: how much will I save?" />
          <button type="submit" className="btn btn-primary" disabled={busy || question.trim() === ""}>{busy ? "Asking…" : "Ask"}</button>
        </div>
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Example questions">
          {(tools.data?.questions ?? []).map((q) => (
            <li key={q}>
              <button type="button" className="btn text-xs" disabled={busy} onClick={() => void send(q)}>{q}</button>
            </li>
          ))}
        </ul>
      </form>
    </div>
  );
}
