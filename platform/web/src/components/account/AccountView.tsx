"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, describeError } from "@/lib/api";
import { useAuth } from "../AuthProvider";

const KEPT = [
  "Your email, and a name if you gave one.",
  "A hash of your password, never the password itself.",
  "The properties you save, with their coordinates and any address, and the roof outline you drew or that was found.",
  "What you enter about them: equipment, tariffs, the meter readings you import, prices, the safety limits and decisions you make on the Control tab.",
  "What AVISHKAR works out from those: forecasts as they were issued, plans, what-ifs and the Energy Twin versions.",
  "An audit log of what you did: the kind of action, when, and the network address it came from. The Copilot's entries record the kind of question and the tools used, not the question's words.",
  "Two cookies, to keep you signed in and to protect your requests from forgery. No advertising, no analytics and no tracking scripts.",
];

const SENT = [
  { to: "The weather and solar-resource services (Open-Meteo, NASA POWER)", what: "The place of a property rounded to about a kilometre. Never your name, email or readings." },
  { to: "The place-search service (OpenStreetMap's Nominatim)", what: "The words you type into the search box, or the point you click when asking what is there." },
  { to: "The building-outline service (OpenStreetMap's Overpass)", what: "The exact point of a property, to find the building on it." },
  { to: "The satellite-scene service (Earth Search)", what: "The place of a property rounded to about a hundred metres." },
  { to: "The map tile servers (OpenStreetMap, Esri, OpenTopoMap)", what: "Your browser asks them for the map pictures of the area you look at, so they see your address as any website you load maps from does." },
  { to: "A language-model service, only if whoever runs this server has switched one on", what: "Your question and the results of the tools it used, which are figures about your property, so that it can be worded; the wording is dropped if it states a number that was not one of those figures. The Copilot says which wrote each answer." },
];

/** What AVISHKAR holds and sends out, and the two things the person can do about it: take it all, or have it all deleted (spec section 50). */
export function AccountView() {
  const { user, loading, forget } = useAuth();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (password.length === 0) return setError("Enter your password to delete the account.");
    setBusy(true);
    setError(null);
    try {
      await api("/api/account", { method: "DELETE", body: { password } });
      forget(); // the server has already ended the session and cleared its cookies
      router.push("/");
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  }

  if (loading) return <p role="status" className="p-6 text-sm text-muted">Loading…</p>;
  if (!user) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold">Your account and your data</h1>
        <p className="mt-3 text-muted">
          <Link className="font-semibold text-accent underline" href="/login?next=/account">Sign in</Link> to see your account.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold">Your account and your data</h1>
      <p className="mt-1 text-sm text-muted">
        Signed in as <span className="font-medium text-ink">{user.email}</span>
        {user.displayName ? ` (${user.displayName})` : ""}.
      </p>

      <section className="card mt-6 p-5" aria-labelledby="acct-kept">
        <h2 id="acct-kept" className="text-lg font-semibold">What AVISHKAR keeps about you</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          {KEPT.map((k) => <li key={k}>{k}</li>)}
        </ul>
        <p className="mt-3 text-sm text-muted">
          No other account can see any of it, and nothing here is sold. An administrator sees only counts of accounts and properties on the Admin page; whoever runs this server can
          still read its database, which this page cannot change. How long your data is kept is up to them: until you delete it, unless they say otherwise.
        </p>
      </section>

      <section className="card mt-4 p-5" aria-labelledby="acct-sent">
        <h2 id="acct-sent" className="text-lg font-semibold">What leaves AVISHKAR, and to whom</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {SENT.map((s) => (
            <li key={s.to}>
              <span className="font-medium">{s.to}.</span> {s.what}
            </li>
          ))}
        </ul>
      </section>

      <section className="card mt-4 p-5" aria-labelledby="acct-export">
        <h2 id="acct-export" className="text-lg font-semibold">Take your data</h2>
        <p className="mt-1 text-sm text-muted">
          One file, in JSON, with your details; your properties; the equipment you entered on each; the tariffs you entered and the safety limits you set; the meter files you
          imported (their names, how many readings each gave and were refused, and the dates they cover); how many readings, forecasts, plans and what-ifs are stored for each
          property; and your audit log (up to its first 1,000 entries). It does not repeat the readings themselves, which are your own file, or each plan and what-if, which are in
          the property&apos;s report.
        </p>
        <p className="mt-3">
          <a className="btn" href="/api/account/export" download="avishkar-my-data.json">Download my data</a>
        </p>
      </section>

      <section className="card mt-4 p-5" aria-labelledby="acct-delete">
        <h2 id="acct-delete" className="text-lg font-semibold">Delete your account</h2>
        <p className="mt-1 text-sm text-muted">
          This deletes your account and everything under it at once: properties, equipment, readings, tariffs you entered, forecasts, plans and decisions. It cannot be undone.
          The audit log cannot be edited by design, so its rows stay, but the link to your account and the network address are erased from them, and one row that carries
          neither records that an account was deleted. Copies in any backup that whoever runs this server keeps are theirs to describe.
        </p>
        {!armed ? (
          <button type="button" className="btn mt-3" onClick={() => setArmed(true)}>Delete my account…</button>
        ) : (
          <form
            className="mt-3 flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void remove();
            }}
          >
            <div>
              <label htmlFor="acct-pw" className="text-sm font-medium">Your password, to confirm</label>
              <input id="acct-pw" type="password" autoComplete="current-password" className="field mt-1" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Deleting…" : "Delete everything"}</button>
            <button type="button" className="btn" onClick={() => { setArmed(false); setPassword(""); setError(null); }} disabled={busy}>Keep my account</button>
          </form>
        )}
        <div aria-live="polite">{error && <p role="alert" className="mt-2 text-sm text-[color:var(--tone-unavailable-fg)]">{error}</p>}</div>
      </section>
    </div>
  );
}
