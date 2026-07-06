import { MemoryStore } from "../src/stores/memoryStore";
import { TokenBucketLimiter } from "../src/limiters/tokenBucket";

describe("TokenBucketLimiter", () => {
  it("allows requests up to capacity, then blocks", async () => {
    const store = new MemoryStore();
    const limiter = new TokenBucketLimiter(store, { capacity: 3, refillRatePerSecond: 1 });

    const r1 = await limiter.consume("client-a");
    const r2 = await limiter.consume("client-a");
    const r3 = await limiter.consume("client-a");
    const r4 = await limiter.consume("client-a");

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(true);
    expect(r4.allowed).toBe(false);
    expect(r4.retryAfterMs).toBeGreaterThan(0);
  });

  it("refills tokens over time", async () => {
    const store = new MemoryStore();
    const limiter = new TokenBucketLimiter(store, { capacity: 1, refillRatePerSecond: 10 });

    const r1 = await limiter.consume("client-b");
    expect(r1.allowed).toBe(true);

    const r2 = await limiter.consume("client-b");
    expect(r2.allowed).toBe(false);

    // Wait 150ms -> at 10 tokens/sec that's 1.5 tokens refilled, enough for one more request.
    await new Promise((resolve) => setTimeout(resolve, 150));

    const r3 = await limiter.consume("client-b");
    expect(r3.allowed).toBe(true);
  });

  it("tracks separate buckets per client key", async () => {
    const store = new MemoryStore();
    const limiter = new TokenBucketLimiter(store, { capacity: 1, refillRatePerSecond: 1 });

    const a = await limiter.consume("client-c");
    const b = await limiter.consume("client-d");

    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true); // different key, its own full bucket
  });
});
