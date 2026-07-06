import express from "express";
import path from "path";
import { config } from "./config";
import { RateLimitStore } from "./stores/store.interface";
import { MemoryStore } from "./stores/memoryStore";
import { RedisStore } from "./stores/redisStore";
import { TokenBucketLimiter } from "./limiters/tokenBucket";
import { SlidingWindowLimiter } from "./limiters/slidingWindowCounter";
import { rateLimitMiddleware } from "./middleware/rateLimiter";
import { proxyMiddleware } from "./gateway/proxy";

async function main() {
  // Pick a backend store: Redis if configured (distributed / production),
  // otherwise fall back to in-memory (single instance / local dev).
  const store: RateLimitStore = config.redisUrl
    ? new RedisStore(config.redisUrl)
    : new MemoryStore();

  console.log(
    `[gateway] using ${config.redisUrl ? "Redis" : "in-memory"} store, algorithm=${config.algorithm}`
  );

  const limiter =
    config.algorithm === "sliding-window"
      ? new SlidingWindowLimiter(store, config.slidingWindow)
      : new TokenBucketLimiter(store, config.tokenBucket);

  const app = express();

  // Health check — not rate limited, so monitoring tools always get through.
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", algorithm: config.algorithm, backend: config.redisUrl ? "redis" : "memory" });
  });

  // Live dashboard (public/dashboard.html) — served directly by the gateway so
  // it's same-origin with /api/*, meaning it can call the gateway with a plain
  // fetch() and no CORS setup. Not rate limited: it's a monitoring tool, not
  // API traffic.
  app.use(express.static(path.join(__dirname, "..", "public")));
  app.get("/dashboard-config", (_req, res) => {
    res.json({
      algorithm: config.algorithm,
      capacity: config.tokenBucket.capacity,
      refillRate: config.tokenBucket.refillRatePerSecond,
    });
  });

  // Everything else passes through the rate limiter, then the proxy.
  app.use(rateLimitMiddleware(limiter as any));
  app.use(proxyMiddleware);

  app.listen(config.port, () => {
    console.log(`[gateway] listening on http://localhost:${config.port}`);
    console.log(`[gateway] proxying to ${config.backendUrl}`);
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
