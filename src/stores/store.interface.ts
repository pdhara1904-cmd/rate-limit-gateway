/**
 * A RateLimitStore is where limiter state actually lives.
 *
 * Why this abstraction matters:
 * - In-memory store: fast, zero setup, great for local dev/tests.
 * - Redis store: shared state across MULTIPLE gateway instances.
 *
 * If you rate-limit in memory only, and you run 5 copies of this gateway
 * behind a load balancer, each instance thinks it has its own quota —
 * a client could get 5x the intended rate by hitting different instances.
 * Redis fixes this by giving every instance one shared source of truth.
 *
 * This is the single most important design decision in the whole project,
 * and exactly the kind of thing interviewers ask about in system design rounds.
 */
export interface RateLimitStore {
  /**
   * Atomically increment a counter for `key` and set its expiry (in seconds)
   * if it doesn't already have one. Returns the new count.
   * Used by the sliding window counter algorithm.
   */
  incrementWithExpiry(key: string, windowSeconds: number): Promise<number>;

  /**
   * Get the current token bucket state for `key`, or null if it doesn't exist yet.
   */
  getBucket(key: string): Promise<{ tokens: number; lastRefillMs: number } | null>;

  /**
   * Persist token bucket state for `key`, with a TTL so idle buckets get cleaned up.
   */
  setBucket(
    key: string,
    tokens: number,
    lastRefillMs: number,
    ttlSeconds: number
  ): Promise<void>;

  /** Clean shutdown (close connections etc). */
  close(): Promise<void>;
}
