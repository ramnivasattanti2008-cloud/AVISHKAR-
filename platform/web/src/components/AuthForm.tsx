"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useState } from "react";
import { describeError } from "@/lib/api";
import { useAuth } from "./AuthProvider";

/** Only same-site paths are honoured as a post-login destination, so a crafted link cannot send a user elsewhere. */
export function safeNext(next: string | null): string {
  return next && /^\/(?!\/)[\w\-./?=&%]*$/.test(next) ? next : "/map";
}

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const { login, register } = useAuth();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await login(String(f.get("email")), String(f.get("password")));
      else await register(String(f.get("email")), String(f.get("password")), String(f.get("displayName") ?? "").trim());
      router.push(next);
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  }

  const isLogin = mode === "login";
  return (
    <div className="mx-auto w-full max-w-sm px-4 py-12">
      <h1 className="text-2xl font-bold">{isLogin ? "Sign in" : "Create your account"}</h1>
      <form onSubmit={submit} className="card mt-6 flex flex-col gap-4 p-5" noValidate>
        {!isLogin && (
          <label className="flex flex-col gap-1 text-sm font-medium">
            Name (optional)
            <input className="field" name="displayName" autoComplete="name" maxLength={80} />
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm font-medium">
          Email
          <input className="field" type="email" name="email" required autoComplete="email" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Password
          <input className="field" type="password" name="password" required minLength={isLogin ? 1 : 10} autoComplete={isLogin ? "current-password" : "new-password"} />
          {!isLogin && <span className="text-xs font-normal text-muted">At least 10 characters. A long phrase is better than a short complex one.</span>}
        </label>
        {error && (
          <p role="alert" className="rounded-md bg-[color:var(--tone-unavailable-bg)] p-2 text-sm text-[color:var(--tone-unavailable-fg)]">
            {error}
          </p>
        )}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Please wait…" : isLogin ? "Sign in" : "Create account"}
        </button>
      </form>
      <p className="mt-4 text-sm text-muted">
        {isLogin ? (
          <>
            New here?{" "}
            <Link className="font-semibold text-accent underline" href="/register">
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <Link className="font-semibold text-accent underline" href="/login">
              Sign in
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
