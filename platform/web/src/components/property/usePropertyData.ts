"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api, describeError } from "@/lib/api";
import type { Property, Twin } from "@/lib/types";

export interface PropertyData {
  property: Property | null;
  twin: Twin | null;
  loading: boolean;
  error: string | null;
  /** 401 or 404: the property is not visible to this visitor. */
  notFound: boolean;
  reload(): void;
  setTwin(t: Twin): void;
}

interface Loaded {
  property: Property | null;
  twin: Twin | null;
  error: string | null;
  notFound: boolean;
}

async function load(id: string): Promise<Loaded> {
  try {
    const property = await api<Property>(`/api/properties/${id}`);
    try {
      return { property, twin: await api<Twin>(`/api/properties/${id}/twin`), error: null, notFound: false };
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return { property, twin: null, error: null, notFound: false }; // no twin yet is normal
      throw e;
    }
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 401)) return { property: null, twin: null, error: null, notFound: true };
    return { property: null, twin: null, error: describeError(e), notFound: false };
  }
}

/** Loads a property and its latest Energy Twin. State is only set from the async result, never synchronously in the effect. */
export function usePropertyData(id: string): PropertyData {
  const [state, setState] = useState<{ id: string; version: number; data: Loaded } | null>(null);
  const [version, setVersion] = useState(0);
  const [twinOverride, setTwinOverride] = useState<Twin | null>(null);

  useEffect(() => {
    let live = true;
    void load(id).then((data) => {
      if (!live) return;
      setState({ id, version, data });
      setTwinOverride(null);
    });
    return () => {
      live = false;
    };
  }, [id, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const current = state?.id === id ? state.data : null;
  return {
    property: current?.property ?? null,
    twin: twinOverride ?? current?.twin ?? null,
    loading: current === null,
    error: current?.error ?? null,
    notFound: current?.notFound ?? false,
    reload,
    setTwin: setTwinOverride,
  };
}
