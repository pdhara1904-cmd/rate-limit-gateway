import { RateLimitStore } from "../stores/store.interface";
import { RateLimitResult } from "./tokenBucket";

export interface SlidingWindowConfig {
  maxRequests: number; // max requests allowed per window
  windowSeconds: number; // window length, e.g. 60 for "per minute"
}

/**
 * SLIDING WINDOW COUNTER ALGORITHM
 *
 * A simple FIXED window (e.g. "100 requests per calendar minute") has a
 * boundary bug: a client can send 100 requests at 0:59.9 and another 100
 * at 1:00.1 — 200 requests in a fraction of a second, even though the
 * limit is "100/minute". This implementation approximates a true sliding
 * window cheaply:
 *
 * We track a counter per fixed window (bucketed by current + previous
 * window), and weight the previous window's count by how much of it
 * still "overlaps" the trailing 60-second lookback from right now.
 *
 * estimated_count = current_window_count
 *                  + previous_window_count * (overlap fraction)
 *
 * This costs one INCR per request (cheap, O(1)) instead of storing a
 * timestamp per request (which gets expensive at high volume), while
 * avoiding the worst of the boundary-burst problem. This tradeoff —
 * exact correctness vs. memory/CPU cost — is exactly the kind of
 * discussion system design interviews look for.
 */
export class SlidingWindowLimiter {
  constructor(private store: RateLimitStore, private config: SlidingWindowConfig) {}

  private windowKey(key: string, windowIndex: number): string {
    return `${key}:w:${windowIndex}`;
  }

  async consume(key: string): Promise<RateLimitResult> {
    const { maxRequests, windowSeconds } = this.config;
    const nowMs = Date.now();
    const currentWindowIndex = Math.floor(nowMs / (windowSeconds * 1000));
    const previousWindowIndex = currentWindowIndex - 1;

    const currentKey = this.windowKey(key, currentWindowIndex);
    const previousKey = this.windowKey(key, previousWindowIndex);

    // How far are we into the current window? (0 = just started, 1 = about to roll over)
    const elapsedInWindowMs = nowMs % (windowSeconds * 1000);
    const percentageIntoCurrentWindow = elapsedInWindowMs / (windowSeconds * 1000);
    const overlapWithPreviousWindow = 1 - percentageIntoCurrentWindow;

    // Peek at both windows' counts WITHOUT incrementing anything yet.
    // We need the CURRENT window's count too — otherwise multiple requests
    // within the same window would each only check the previous window's
    // overlap and never see each other, letting unlimited requests through
    // in the current window (a bug an earlier version of this had).
    const previousBucket = await this.store.getBucket(previousKey);
    const previousCount = previousBucket ? previousBucket.tokens : 0; // reusing `tokens` field as a generic counter

    const currentBucket = await this.store.getBucket(currentKey);
    const currentCount = currentBucket ? currentBucket.tokens : 0;

    const estimatedCount = currentCount + previousCount * overlapWithPreviousWindow;

    if (estimatedCount >= maxRequests) {
      const retryAfterMs = Math.ceil((1 - percentageIntoCurrentWindow) * windowSeconds * 1000);
      return { allowed: false, remaining: 0, retryAfterMs };
    }

    const newCount = await this.store.incrementWithExpiry(currentKey, windowSeconds * 2);
    // Mirror the raw count into the bucket store so the NEXT window can read
    // this window's total as its "previous count" for the overlap calculation.
    await this.store.setBucket(currentKey, newCount, nowMs, windowSeconds * 2);

    return {
      allowed: true,
      remaining: Math.max(0, Math.floor(maxRequests - estimatedCount - 1)),
    };
  }
}
