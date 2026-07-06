import { RateLimitStore } from "../stores/store.interface";

export interface TokenBucketConfig {
  capacity: number; // max tokens the bucket can hold (burst size)
  refillRatePerSecond: number; // tokens added per second
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs?: number;
}

/**
 * TOKEN BUCKET ALGORITHM
 *
 * Picture a bucket that holds up to `capacity` tokens. Every request costs
 * one token. Tokens refill continuously at `refillRatePerSecond`.
 * - If the bucket has a token, the request is allowed and a token is removed.
 * - If it's empty, the request is rejected until enough time has passed
 *   for a token to regenerate.
 *
 * Why this algorithm (vs a simple fixed counter)?
 * It naturally allows short BURSTS of traffic (up to `capacity`) while still
 * enforcing a steady average rate over time — which matches how real
 * clients behave (a user might fire 10 requests at once loading a page,
 * then go quiet). A fixed counter would either reject that legitimate burst
 * or allow an unlimited burst right at window boundaries (the "boundary
 * problem" — e.g. 100 requests at 0:59 and another 100 at 1:00, i.e. 200
 * requests in 2 seconds against a "100/minute" limit).
 *
 * We don't run a background timer to add tokens. Instead, we calculate how
 * many tokens WOULD have regenerated based on elapsed time, every time a
 * request comes in ("lazy refill"). This is simpler, needs no scheduler,
 * and works identically whether state lives in memory or Redis.
 */
export class TokenBucketLimiter {
  constructor(private store: RateLimitStore, private config: TokenBucketConfig) {}

  async consume(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    const existing = await this.store.getBucket(key);

    let tokens: number;
    let lastRefillMs: number;

    if (!existing) {
      // First request from this client: bucket starts full.
      tokens = this.config.capacity;
      lastRefillMs = now;
    } else {
      const elapsedSeconds = Math.max(0, (now - existing.lastRefillMs) / 1000);
      const refilled = elapsedSeconds * this.config.refillRatePerSecond;
      tokens = Math.min(this.config.capacity, existing.tokens + refilled);
      lastRefillMs = now;
    }

    if (tokens >= 1) {
      tokens -= 1;
      // TTL: long enough that an idle bucket naturally expires from storage
      // instead of accumulating forever.
      const ttl = Math.ceil(this.config.capacity / this.config.refillRatePerSecond) * 2 || 60;
      await this.store.setBucket(key, tokens, lastRefillMs, ttl);
      return { allowed: true, remaining: Math.floor(tokens) };
    }

    // Not enough tokens — tell the client how long until one is available.
    const tokensNeeded = 1 - tokens;
    const retryAfterMs = Math.ceil((tokensNeeded / this.config.refillRatePerSecond) * 1000);
    const ttl = Math.ceil(this.config.capacity / this.config.refillRatePerSecond) * 2 || 60;
    await this.store.setBucket(key, tokens, lastRefillMs, ttl);

    return { allowed: false, remaining: 0, retryAfterMs };
  }
}
