/**
 * Every value computed for a demo property leaves the server labelled DEMO (spec sections 74 and 76). A forecast, a plan or a
 * saving built on invented readings and equipment is not a FORECAST or an ESTIMATE of anything real, whatever the code that
 * produced it calls it.
 *
 * What keeps its label: values an outside provider measured or forecast for the place (the weather and the sun are real there),
 * REFERENCE values from a sourced document (a tariff order), and UNAVAILABLE, which already says why there is no number.
 *
 * Applied to a whole response when the request is about a demo property, and to any part of a response that carries
 * `isDemo: true` (a demo property in a list, a simulation built on one). Pure, and it never mutates its input: provider results
 * are cached in memory and shared between requests.
 */
import { PROVIDER_NAMES } from "../providers/index.js";

const OUTSIDE = new Set<string>(PROVIDER_NAMES);
const KEEP = new Set(["REFERENCE", "UNAVAILABLE", "DEMO"]);

interface ProvenanceLike {
  status: string;
  provider: string;
  notes?: unknown;
}

function isProvenance(v: unknown): v is ProvenanceLike {
  return typeof v === "object" && v !== null && typeof (v as ProvenanceLike).status === "string" && typeof (v as ProvenanceLike).provider === "string";
}

function relabelProvenance(p: ProvenanceLike): ProvenanceLike {
  if (KEEP.has(p.status) || OUTSIDE.has(p.provider)) return p;
  const notes = Array.isArray(p.notes) ? p.notes : [];
  return { ...p, status: "DEMO", notes: [`DEMO DATA: computed as ${p.status} from the demo world's invented readings and equipment, not from a real property.`, ...notes] };
}

export function relabelDemo<T>(value: T, demo = false): T {
  return walk(value, demo) as T;
}

function walk(v: unknown, demo: boolean): unknown {
  if (Array.isArray(v)) {
    if (v.length === 0 || (typeof v[0] !== "object" && !Array.isArray(v[0]))) return v; // numbers, strings: nothing to label
    let out: unknown[] | null = null;
    for (let i = 0; i < v.length; i++) {
      const w = walk(v[i], demo);
      if (w !== v[i]) (out ??= v.slice())[i] = w;
    }
    return out ?? v;
  }
  if (typeof v !== "object" || v === null || v instanceof Date) return v;
  const o = v as Record<string, unknown>;
  const here = demo || o.isDemo === true;
  let out: Record<string, unknown> | null = null;
  for (const key of Object.keys(o)) {
    const child = o[key];
    const w = here && key === "provenance" && isProvenance(child) ? relabelProvenance(child) : walk(child, here);
    if (w !== child) (out ??= { ...o })[key] = w;
  }
  return out ?? v;
}
