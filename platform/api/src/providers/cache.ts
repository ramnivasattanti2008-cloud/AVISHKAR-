import type { Db } from "../db.js";

export interface CacheRecord<T> {
  value: T;
  storedAt: Date;
  expiresAt: Date;
}

/** `get` returns expired entries too: callers decide whether an old value is better than none (stale-if-error). */
export interface Cache {
  get<T>(key: string): Promise<CacheRecord<T> | null>;
  set<T>(key: string, provider: string, value: T, ttlSeconds: number, now?: Date): Promise<void>;
}

export class MemoryCache implements Cache {
  private readonly m = new Map<string, CacheRecord<unknown>>();
  async get<T>(key: string): Promise<CacheRecord<T> | null> {
    return (this.m.get(key) as CacheRecord<T> | undefined) ?? null;
  }
  async set<T>(key: string, _provider: string, value: T, ttlSeconds: number, now = new Date()): Promise<void> {
    this.m.set(key, { value, storedAt: now, expiresAt: new Date(now.getTime() + ttlSeconds * 1000) });
  }
}

/** Shared across API instances and workers, and survives restarts (spec section 70). */
export class DbCache implements Cache {
  constructor(private readonly db: Db) {}
  async get<T>(key: string): Promise<CacheRecord<T> | null> {
    const r = await this.db.cacheEntry.findUnique({ where: { key } });
    return r ? { value: r.value as T, storedAt: r.storedAt, expiresAt: r.expiresAt } : null;
  }
  async set<T>(key: string, provider: string, value: T, ttlSeconds: number, now = new Date()): Promise<void> {
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const json = value as never;
    await this.db.cacheEntry.upsert({
      where: { key },
      create: { key, provider, value: json, storedAt: now, expiresAt },
      update: { provider, value: json, storedAt: now, expiresAt },
    });
  }
}

export interface Cached<T> {
  value: T;
  storedAt: Date;
  fromCache: boolean;
  /** True when the entry had expired and was served only because the provider failed. The UI must say so. */
  stale: boolean;
}

/**
 * Serve a fresh cache hit; otherwise fetch and store; if the fetch fails and an expired entry exists, serve that
 * marked stale rather than nothing (spec sections 42 and 72). With no entry the error propagates.
 */
export async function cachedFetch<T>(
  cache: Cache,
  key: string,
  provider: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
  now: () => Date = () => new Date(),
): Promise<Cached<T>> {
  const hit = await cache.get<T>(key);
  if (hit && hit.expiresAt > now()) return { value: hit.value, storedAt: hit.storedAt, fromCache: true, stale: false };
  try {
    const value = await fetcher();
    const at = now();
    await cache.set(key, provider, value, ttlSeconds, at);
    return { value, storedAt: at, fromCache: false, stale: false };
  } catch (err) {
    if (hit) return { value: hit.value, storedAt: hit.storedAt, fromCache: true, stale: true };
    throw err;
  }
}
