"use client";

import { useCallback, useEffect, useState } from "react";
import { api, describeError } from "./api";

export interface ApiState<T> {
  /** The latest answer for this path. While a reload is in flight the previous answer for the same path stays visible. */
  data: T | null;
  error: string | null;
  /** True until the first answer for this path. */
  loading: boolean;
  reload(): void;
}

interface Entry<T> {
  path: string;
  version: number;
  data: T | null;
  error: string | null;
}

/**
 * GET a path and keep the answer. State is only set from the async result (never synchronously in the effect), a path that
 * changes never shows the answer for the old one, and `reload()` refetches without blanking what is on screen.
 */
export function useApi<T>(path: string | null): ApiState<T> {
  const [entry, setEntry] = useState<Entry<T> | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!path) return;
    let live = true;
    api<T>(path)
      .then((data) => live && setEntry({ path, version, data, error: null }))
      .catch((e) => live && setEntry((prev) => ({ path, version, data: prev?.path === path ? prev.data : null, error: describeError(e) })));
    return () => {
      live = false;
    };
  }, [path, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const forThisPath = entry !== null && entry.path === path;
  return {
    data: forThisPath ? entry.data : null,
    error: forThisPath ? entry.error : null,
    loading: path !== null && !(forThisPath && entry.version === version),
    reload,
  };
}
