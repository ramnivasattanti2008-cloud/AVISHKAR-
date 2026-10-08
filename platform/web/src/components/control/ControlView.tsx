"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, describeError } from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { Control, ControlProposal } from "@/lib/types";
import { useAuth } from "../AuthProvider";
import { PropertyTabs } from "../property/PropertyTabs";
import { usePropertyData } from "../property/usePropertyData";

const KIND: Record<ControlProposal["kind"], string> = {
  BATTERY_CHARGE: "Charge the battery",
  BATTERY_DISCHARGE: "Run the home from the battery",
  APPLIANCE_RUN: "Run an appliance",
  EV_CHARGE: "Charge the car",
};

/** The colour of each state: things done are calm, things stopped are marked, nothing is red unless it failed or was blocked. */
const TONE: Record<ControlProposal["state"], string> = {
  PROPOSED: "forecast",
  APPROVED: "live",
  APPLIED: "live",
  REJECTED: "estimated",
  WITHDRAWN: "estimated",
  EXPIRED: "estimated",
  ROLLED_BACK: "updated",
  FAILED: "unavailable",
  BLOCKED: "unavailable",
};

const ACTIONS = [
  { action: "approve", label: "Approve" },
  { action: "reject", label: "Reject" },
  { action: "withdraw", label: "Withdraw" },
  { action: "rollback", label: "Roll back" },
] as const;

function command(p: ControlProposal): string {
  const c = p.command;
  if (p.kind === "APPLIANCE_RUN") return `${c.name}, ${formatNumber(Number(c.runHours))} h, ${formatNumber(Number(c.kwh))} kWh`;
  return `${formatNumber(Number(c.kwh))} kWh at up to ${formatNumber(Number(c.peakKw))} kW`;
}

function ProposalCard({ p, busy, onAct }: { p: ControlProposal; busy: boolean; onAct: (id: string, action: (typeof ACTIONS)[number]["action"]) => void }) {
  const blockedWhy = ACTIONS.filter((a) => !p.can[a.action].allowed).map((a) => ({ a, why: p.can[a.action].reason }));
  return (
    <li className="card p-4" aria-label={`${KIND[p.kind]}, ${formatDateTime(p.startsAt)}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{KIND[p.kind]}</h3>
        <span className="badge" data-tone={TONE[p.state]}>{p.state.replace("_", " ")}</span>
      </div>
      <p className="num mt-1 text-sm">
        {formatDateTime(p.startsAt)} to {formatDateTime(p.endsAt)} · {command(p)}
      </p>
      <p className="mt-1 text-sm text-muted">Why: {p.reason}</p>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer">
          Safety checks: {p.safety.ok ? "all passed" : <strong>a limit is broken</strong>}
        </summary>
        <ul className="mt-1 list-disc pl-5">
          {p.safety.checks.map((c) => (
            <li key={c.check} className={c.ok ? "text-muted" : "font-medium text-[color:var(--tone-unavailable-fg)]"}>
              {c.ok ? "Passed" : "Broken"}: {c.check}. {c.detail}
            </li>
          ))}
        </ul>
      </details>
      {p.result && <p className="mt-2 text-sm">{p.result.message}</p>}
      {p.decidedAt && (
        <p className="mt-1 text-xs text-muted">
          {p.decidedBy ?? "The system"} {p.state === "EXPIRED" ? "let it expire" : `marked it ${p.state.toLowerCase().replace("_", " ")}`} {formatDateTime(p.decidedAt)}
          {p.decisionNote ? `: ${p.decisionNote}` : ""}.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {ACTIONS.filter((a) => p.can[a.action].allowed).map((a) => (
          <button key={a.action} type="button" className={`btn ${a.action === "approve" ? "btn-primary" : ""}`} disabled={busy} onClick={() => onAct(p.id, a.action)} aria-label={`${a.label}: ${KIND[p.kind]}, ${formatDateTime(p.startsAt)}`}>
            {a.label}
          </button>
        ))}
      </div>
      {/* No dead buttons without a reason: what cannot be done now is listed, with why. */}
      {blockedWhy.length > 0 && p.state !== "EXPIRED" && (
        <ul className="mt-2 list-none space-y-0.5 text-xs text-muted">
          {blockedWhy
            .filter((b) => (b.a.action === "approve" && (p.state === "PROPOSED" || p.state === "BLOCKED")) || (b.a.action === "rollback" && (p.state === "APPROVED" || p.state === "APPLIED")))
            .map((b) => (
              <li key={b.a.action}>
                {b.a.label}: {b.why}
              </li>
            ))}
        </ul>
      )}
    </li>
  );
}

/** What AVISHKAR may do for this property, the limits it keeps to, and the moves waiting for a decision (spec section 46). */
export function ControlView({ id }: { id: string }) {
  const { user, loading: authLoading } = useAuth();
  const { property, loading, error, notFound } = usePropertyData(id);
  const [control, setControl] = useState<Control | null>(null);
  const [mode, setMode] = useState<Control["mode"]>("RECOMMEND");
  const [maxCharge, setMaxCharge] = useState("");
  const [maxDischarge, setMaxDischarge] = useState("");
  const [minSoc, setMinSoc] = useState("");
  const [hours, setHours] = useState("24");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const ready = Boolean(user && property);

  const adopt = useCallback((c: Control) => {
    setControl(c);
    setMode(c.mode);
    setMaxCharge(c.limits.maxChargeKw === null ? "" : String(c.limits.maxChargeKw));
    setMaxDischarge(c.limits.maxDischargeKw === null ? "" : String(c.limits.maxDischargeKw));
    setMinSoc(c.limits.minSocPercent === null ? "" : String(c.limits.minSocPercent));
  }, []);

  useEffect(() => {
    if (!ready) return;
    let live = true;
    api<Control>(`/api/properties/${id}/control`)
      .then((c) => live && adopt(c))
      .catch((e) => live && setMessage({ tone: "error", text: describeError(e) }));
    return () => {
      live = false;
    };
  }, [id, ready, adopt]);

  const number = (text: string, what: string, min: number, max: number): number | null | "bad" => {
    if (text.trim() === "") return null;
    const v = Number(text);
    if (!(v >= min && v <= max) || (what.endsWith("kW") && v <= 0)) return "bad";
    return v;
  };

  async function save() {
    const c = number(maxCharge, "maximum charge power, kW", 0, 100_000);
    const d = number(maxDischarge, "maximum discharge power, kW", 0, 100_000);
    const s = number(minSoc, "lowest charge, %", 0, 100);
    if (c === "bad") return setMessage({ tone: "error", text: "The most charge power must be a number above 0, or left empty." });
    if (d === "bad") return setMessage({ tone: "error", text: "The most discharge power must be a number above 0, or left empty." });
    if (s === "bad") return setMessage({ tone: "error", text: "The lowest charge must be between 0 and 100 percent, or left empty." });
    const body: Record<string, unknown> = { mode, maxChargeKw: c, maxDischargeKw: d, minSocPercent: s };
    if (mode === "AUTOMATE") {
      const h = Number(hours);
      if (!(Number.isInteger(h) && h >= 1 && h <= 720)) return setMessage({ tone: "error", text: "Say how many whole hours your authorization lasts, from 1 to 720." });
      body.automateHours = h;
      body.confirmAutomate = confirm;
    }
    setBusy(true);
    setMessage(null);
    try {
      adopt(await api<Control>(`/api/properties/${id}/control`, { method: "PUT", body }));
      setMessage({ tone: "ok", text: "Saved." });
    } catch (e) {
      setMessage({ tone: "error", text: describeError(e) });
    } finally {
      setBusy(false);
    }
  }

  async function propose() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api<{ created: number; skipped: number; control: Control }>(`/api/properties/${id}/control/proposals`, { method: "POST" });
      adopt(r.control);
      setMessage({ tone: "ok", text: r.created === 0 && r.skipped > 0 ? `Nothing new: the ${r.skipped} move${r.skipped === 1 ? "" : "s"} of the latest plan ${r.skipped === 1 ? "is" : "are"} already listed.` : `${r.created} move${r.created === 1 ? "" : "s"} proposed from the latest plan${r.skipped ? `, ${r.skipped} already listed` : ""}.` });
    } catch (e) {
      setMessage({ tone: "error", text: describeError(e) });
    } finally {
      setBusy(false);
    }
  }

  async function act(proposalId: string, action: (typeof ACTIONS)[number]["action"]) {
    setBusy(true);
    setMessage(null);
    try {
      adopt(await api<Control>(`/api/properties/${id}/control/proposals/${proposalId}/${action}`, { method: "POST", body: {} }));
    } catch (e) {
      setMessage({ tone: "error", text: describeError(e) });
    } finally {
      setBusy(false);
    }
  }

  if (loading || authLoading) return <p role="status" className="p-6 text-sm text-muted">Loading…</p>;
  if (!user || notFound) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold">Property not found</h1>
        <p className="mt-3 text-muted">
          {user ? "This property does not exist or is not yours." : "Sign in to see control."}{" "}
          <Link className="font-semibold text-accent underline" href={user ? "/properties" : `/login?next=/property/${id}/control`}>
            {user ? "Back to your properties" : "Sign in"}
          </Link>
        </p>
      </div>
    );
  }
  if (error || !property) return <p role="alert" className="p-6 text-sm text-[color:var(--tone-unavailable-fg)]">{error ?? "Could not load the property."}</p>;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <header>
        <h1 className="text-2xl font-bold">{property.name}</h1>
        <p className="text-sm text-muted">How much AVISHKAR may do, the limits it keeps to, and the moves waiting for you</p>
      </header>
      <div className="mt-4"><PropertyTabs id={id} current="/control" demo={property.isDemo} /></div>

      {control && (
        <>
          <p role="note" className="mt-4 rounded-md p-3 text-sm" style={{ color: control.executor.available ? "var(--tone-live-fg)" : "var(--tone-updated-fg)", background: control.executor.available ? "var(--tone-live-bg)" : "var(--tone-updated-bg)" }}>
            <strong>{control.executor.available ? "A device is connected." : "No device is connected."}</strong> {control.executor.available ? control.executor.message : "AVISHKAR plans and explains. Approving a move records your decision and changes nothing, because there is nothing for it to act on."}
          </p>

          <section className="card mt-4 p-4" aria-labelledby="mode">
            <h2 id="mode" className="text-lg font-semibold">How much AVISHKAR may do</h2>
            <form
              className="mt-3"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <fieldset>
                <legend className="sr-only">Mode</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {control.modes.map((m) => (
                    <label key={m.mode} className={`flex gap-3 rounded-md border p-3 text-sm ${mode === m.mode ? "border-accent" : "border-line"} ${m.available ? "cursor-pointer" : "opacity-70"}`}>
                      <input type="radio" name="mode" value={m.mode} checked={mode === m.mode} disabled={!m.available} onChange={() => setMode(m.mode)} className="mt-1" />
                      <span>
                        <span className="block font-semibold">{m.label}</span>
                        <span className="block text-muted">{m.meaning}</span>
                        {m.unavailableReason && <span className="mt-1 block text-xs">{m.unavailableReason}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {mode === "AUTOMATE" && (
                <div className="mt-3 rounded-md border border-line p-3 text-sm">
                  <label htmlFor="ctl-hours" className="font-medium">Your authorization lasts, hours (at most 720)</label>
                  <input id="ctl-hours" className="field mt-1 max-w-40" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} />
                  <label className="mt-3 flex items-start gap-2">
                    <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-1" />
                    <span>I authorise AVISHKAR to make moves inside my safety limits without asking each time, until this ends. I can roll a move back, and every move is recorded.</span>
                  </label>
                </div>
              )}

              <h3 className="mt-4 text-sm font-semibold">Safety limits</h3>
              <p className="text-xs text-muted">A move that breaks one is blocked and cannot be approved. Leave empty to rely on the battery&apos;s own limits.</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-3">
                <div>
                  <label htmlFor="ctl-chg" className="text-sm font-medium">Most charge power, kW</label>
                  <input id="ctl-chg" className="field mt-1" inputMode="decimal" placeholder="the battery&apos;s own" value={maxCharge} onChange={(e) => setMaxCharge(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="ctl-dis" className="text-sm font-medium">Most discharge power, kW</label>
                  <input id="ctl-dis" className="field mt-1" inputMode="decimal" placeholder="the battery&apos;s own" value={maxDischarge} onChange={(e) => setMaxDischarge(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="ctl-soc" className="text-sm font-medium">Never below this charge, %</label>
                  <input id="ctl-soc" className="field mt-1" inputMode="decimal" placeholder="the battery&apos;s own" value={minSoc} onChange={(e) => setMinSoc(e.target.value)} />
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
                {control.updatedAt && <span className="text-xs text-muted">Last saved {formatDateTime(control.updatedAt)}</span>}
                {control.automateUntil && <span className="text-xs">Automate is authorised until {formatDateTime(control.automateUntil)}.</span>}
              </div>
            </form>
          </section>

          <section className="mt-4" aria-labelledby="moves">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="moves" className="text-lg font-semibold">Moves from the latest plan</h2>
              <button type="button" className="btn" onClick={propose} disabled={busy || control.mode === "OBSERVE"} aria-describedby={control.mode === "OBSERVE" ? "propose-why" : undefined}>
                Propose the plan&apos;s moves
              </button>
            </div>
            {control.mode === "OBSERVE" && <p id="propose-why" className="mt-1 text-sm text-muted">The mode is Observe: AVISHKAR proposes no moves. Choose Recommend or Approve above to see them.</p>}
            {control.proposals.length === 0 ? (
              <p className="card mt-3 p-4 text-sm text-muted">
                No moves yet. Make a plan on the <Link className="font-semibold text-accent underline" href={`/property/${id}/plan`}>Plan tab</Link>, then propose its moves here.
              </p>
            ) : (
              <ul className="mt-3 grid gap-3" aria-label="Proposed moves">
                {control.proposals.map((p) => <ProposalCard key={p.id} p={p} busy={busy} onAct={act} />)}
              </ul>
            )}
          </section>
        </>
      )}

      <div aria-live="polite" className="mt-3">
        {message && (
          <p role={message.tone === "error" ? "alert" : "status"} className={`text-sm ${message.tone === "error" ? "text-[color:var(--tone-unavailable-fg)]" : ""}`}>
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
