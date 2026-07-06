import { Request, Response, NextFunction } from "express";
import { TokenBucketLimiter } from "../limiters/tokenBucket";
import { SlidingWindowLimiter } from "../limiters/slidingWindowCounter";

type Limiter = TokenBucketLimiter | SlidingWindowLimiter;

/**
 * Express middleware that enforces the rate limit before a request
 * is allowed to reach the proxy/backend.
 *
 * Keying strategy: by default we key on IP address (simulating "per client"
 * limiting). In a real product you'd usually key on API key or user ID —
 * IP is a reasonable stand-in for a portfolio project and is easy to test.
 *
 * Sets standard rate-limit response headers so any client (or the load
 * test tool) can introspect its own quota, same as real APIs like GitHub's.
 */
export function rateLimitMiddleware(limiter: Limiter) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const clientKey = `ratelimit:${req.ip}`;

    try {
      const result = await limiter.consume(clientKey);

      res.setHeader("X-RateLimit-Remaining", result.remaining.toString());

      if (!result.allowed) {
        if (result.retryAfterMs) {
          res.setHeader("Retry-After", Math.ceil(result.retryAfterMs / 1000).toString());
        }
        return res.status(429).json({
          error: "Too Many Requests",
          message: "Rate limit exceeded. Please slow down.",
          retryAfterMs: result.retryAfterMs,
        });
      }

      next();
    } catch (err) {
      // Fail-open: if the rate limit store itself is down (e.g. Redis outage),
      // we choose to let traffic through rather than take the whole API down.
      // This is a deliberate design tradeoff worth mentioning in interviews:
      // fail-open (availability-favoring) vs fail-closed (safety-favoring).
      console.error("[rateLimitMiddleware] store error, failing open:", err);
      next();
    }
  };
}
