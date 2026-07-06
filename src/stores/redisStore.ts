import Redis from "ioredis";
import { RateLimitStore } from "./store.interface";

/**
 * Redis-backed store — this is what makes rate limiting DISTRIBUTED.
 * Every gateway instance talks to the same Redis, so quota is enforced
 * globally no matter which instance handles a given request.
 *
 * Why Lua scripts instead of separate GET/SET calls?
 * If two requests hit at nearly the same time, a naive
 * "read count, check limit, write count+1" sequence has a race condition:
 * both requests can read the same count before either writes it back,
 * letting both through even if only one should be allowed.
 * Redis executes Lua scripts atomically — the whole script runs as one
 * indivisible step, so there's no window for a race. This is a classic
 * "check-then-act" concurrency bug, and knowing how to explain it is
 * genuinely interview gold.
 */
export class RedisStore implements RateLimitStore {
  private client: Redis;

  // Atomically: increment counter, set expiry only on first increment.
  private static readonly INCR_SCRIPT = `
    local current = redis.call("INCR", KEYS[1])
    if current == 1 then
      redis.call("EXPIRE", KEYS[1], ARGV[1])
    end
    return current
  `;

  constructor(redisUrl: string) {
    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    });

    this.client.on("error", (err) => {
      console.error("[RedisStore] connection error:", err.message);
    });
  }

  async incrementWithExpiry(key: string, windowSeconds: number): Promise<number> {
    const result = await this.client.eval(
      RedisStore.INCR_SCRIPT,
      1,
      key,
      windowSeconds.toString()
    );
    return Number(result);
  }

  async getBucket(key: string) {
    const data = await this.client.hgetall(key);
    if (!data || !data.tokens) return null;
    return {
      tokens: parseFloat(data.tokens),
      lastRefillMs: parseInt(data.lastRefillMs, 10),
    };
  }

  async setBucket(key: string, tokens: number, lastRefillMs: number, ttlSeconds: number) {
    const pipeline = this.client.pipeline();
    pipeline.hset(key, { tokens: tokens.toString(), lastRefillMs: lastRefillMs.toString() });
    pipeline.expire(key, ttlSeconds);
    await pipeline.exec();
  }

  async close() {
    await this.client.quit();
  }
}
