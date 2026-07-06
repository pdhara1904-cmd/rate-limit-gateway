import { RateLimitStore } from "./store.interface";

interface Counter {
  count: number;
  expiresAtMs: number;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
  expiresAtMs: number;
}

/**
 * In-memory implementation of RateLimitStore.
 * Good for local development and unit tests. NOT distributed —
 * each process has its own state, which is exactly the problem
 * the Redis-backed store solves.
 */
export class MemoryStore implements RateLimitStore {
  private counters = new Map<string, Counter>();
  private buckets = new Map<string, Bucket>();

  async incrementWithExpiry(key: string, windowSeconds: number): Promise<number> {
    const now = Date.now();
    const existing = this.counters.get(key);

    if (!existing || existing.expiresAtMs <= now) {
      this.counters.set(key, { count: 1, expiresAtMs: now + windowSeconds * 1000 });
      return 1;
    }

    existing.count += 1;
    return existing.count;
  }

  async getBucket(key: string) {
    const b = this.buckets.get(key);
    if (!b || b.expiresAtMs <= Date.now()) return null;
    return { tokens: b.tokens, lastRefillMs: b.lastRefillMs };
  }

  async setBucket(key: string, tokens: number, lastRefillMs: number, ttlSeconds: number) {
    this.buckets.set(key, {
      tokens,
      lastRefillMs,
      expiresAtMs: Date.now() + ttlSeconds * 1000,
    });
  }

  async close() {
    this.counters.clear();
    this.buckets.clear();
  }
}
