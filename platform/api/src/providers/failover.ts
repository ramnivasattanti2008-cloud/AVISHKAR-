import { ProviderError } from "../errors.js";

export interface FailoverResult<T> {
  value: T;
  /** The provider that answered. */
  provider: string;
  /** Providers tried first and why each failed; surfaced to the user as a note (spec section 72). */
  failures: { provider: string; reason: string }[];
}

/** Try providers in order; the first that answers wins. If all fail, throw one error that lists every reason. */
export async function withFailover<P extends { readonly name: string }, T>(
  providers: P[],
  operation: string,
  call: (p: P) => Promise<T>,
): Promise<FailoverResult<T>> {
  const failures: { provider: string; reason: string }[] = [];
  for (const p of providers) {
    try {
      return { value: await call(p), provider: p.name, failures };
    } catch (e) {
      failures.push({ provider: p.name, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  const names = providers.map((p) => p.name).join(", ");
  throw new ProviderError(
    names || "none",
    operation,
    `All providers failed for ${operation}: ${failures.map((f) => `${f.provider}: ${f.reason}`).join("; ")}`,
  );
}
