"use client";

import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { ApiUser } from "@/lib/types";

interface AuthState {
  user: ApiUser | null;
  /** True until the first /api/auth/me answer, so pages do not flash a signed-out state to a signed-in user. */
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string, displayName?: string): Promise<void>;
  logout(): Promise<void>;
  /** Drop the signed-in user from this page without calling the server: for when the server has already ended the session (the account was deleted). */
  forget(): void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    api<{ user: ApiUser }>("/api/auth/me")
      .then((r) => live && setUser(r.user))
      .catch((e) => {
        if (!(e instanceof ApiError) || e.status !== 401) console.warn("session check failed", e);
        if (live) setUser(null);
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ user: ApiUser }>("/api/auth/login", { method: "POST", body: { email, password } });
    setUser(r.user);
  }, []);
  const register = useCallback(async (email: string, password: string, displayName?: string) => {
    const r = await api<{ user: ApiUser }>("/api/auth/register", { method: "POST", body: { email, password, displayName: displayName || undefined } });
    setUser(r.user);
  }, []);
  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
  }, []);

  const forget = useCallback(() => setUser(null), []);

  const value = useMemo(() => ({ user, loading, login, register, logout, forget }), [user, loading, login, register, logout, forget]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}
