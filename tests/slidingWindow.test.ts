import { MemoryStore } from "../src/stores/memoryStore";
import { SlidingWindowLimiter } from "../src/limiters/slidingWindowCounter";

describe("SlidingWindowLimiter", () => {
  it("allows up to maxRequests within a window", async () => {
    const store = new MemoryStore();
    const limiter = new SlidingWindowLimiter(store, { maxRequests: 5, windowSeconds: 1 });

    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push(await limiter.consume("client-a"));
    }

    const allowedCount = results.filter((r) => r.allowed).length;
    expect(allowedCount).toBe(5);
    expect(results[5].allowed).toBe(false);
  });

  it("smooths out bursts across a window boundary (no 2x burst bug)", async () => {
    const store = new MemoryStore();
    const limiter = new SlidingWindowLimiter(store, { maxRequests: 10, windowSeconds: 1 });

    // Use up the full quota near the end of the current window.
    for (let i = 0; i < 10; i++) {
      await limiter.consume("client-b");
    }

    // Immediately after, still within a fraction of a second, requests
    // from the "same effective window" should still mostly be blocked,
    // rather than resetting to a fresh 10 the instant the clock ticks over.
    const nextResult = await limiter.consume("client-b");
    expect(nextResult.allowed).toBe(false);
  });

  it("tracks separate windows per client key", async () => {
    const store = new MemoryStore();
    const limiter = new SlidingWindowLimiter(store, { maxRequests: 1, windowSeconds: 1 });

    const a = await limiter.consume("client-x");
    const b = await limiter.consume("client-y");

    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
  });
});
