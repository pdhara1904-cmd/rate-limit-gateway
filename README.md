# Rate Limit Gateway

A distributed API rate limiter and reverse proxy gateway, built in TypeScript. Supports two rate-limiting algorithms (token bucket and sliding window counter), pluggable storage (in-memory or Redis), and is load-tested and containerized for multi-instance deployment.

## Why this exists

Every public API needs to protect itself from clients that send too many requests — whether malicious (abuse, scraping) or just buggy (a retry loop gone wrong). This project implements that as a standalone gateway service, the same architectural pattern used in production systems like Kong, AWS API Gateway, and Cloudflare.

## Architecture

```
                    ┌─────────────────┐
   client requests  │                 │
  ────────────────► │   Gateway (this)│
                     │  ┌───────────┐ │       ┌──────────────┐
                     │  │Rate Limit │ │       │              │
                     │  │Middleware │◄┼──────►│    Redis     │
                     │  └─────┬─────┘ │       │ (shared state)
                     │        │       │       └──────────────┘
                     │        ▼       │
                     │  ┌───────────┐ │       ┌──────────────┐
                     │  │  Reverse  │ │       │   Upstream   │
                     │  │   Proxy   ├─┼──────►│   Backend    │
                     │  └───────────┘ │       │  (your API)  │
                     └─────────────────┘       └──────────────┘
```

Requests hit the gateway first. The rate limit middleware checks (and updates) the client's quota in Redis. If allowed, the request is forwarded to the real backend via the reverse proxy; if not, the gateway responds `429 Too Many Requests` without the backend ever seeing the request.

### Why Redis, not just in-memory counters?

If you run multiple copies of this gateway behind a load balancer (which any real deployment would, for availability), in-memory counters give each instance its own separate quota — a client could get N times the intended rate by spreading requests across N instances. Redis gives every instance one shared source of truth, so the limit is enforced correctly no matter which instance handles a given request. This project runs **two gateway instances against one Redis** in `docker-compose.yml` specifically to demonstrate this.

### Algorithms implemented

**Token Bucket** (`src/limiters/tokenBucket.ts`)
Each client has a bucket holding up to `capacity` tokens, refilling at `refillRatePerSecond`. Every request costs one token. Allows short bursts while enforcing a steady average rate — closer to how real client traffic behaves than a naive fixed counter.

**Sliding Window Counter** (`src/limiters/slidingWindowCounter.ts`)
Approximates a true sliding window by weighting the previous fixed window's count by how much it overlaps the current lookback period. Avoids the "boundary burst" bug of fixed windows (e.g. 100 requests at 0:59 + 100 more at 1:00 against a "100/minute" limit) at O(1) cost per request.

Switch between them with the `RATE_LIMIT_ALGORITHM` env var.

### Design tradeoffs worth knowing (interview-relevant)

- **Fail-open on store errors**: if Redis goes down, the gateway lets traffic through rather than blocking all API access. Availability over strict enforcement — a deliberate choice, not an oversight (see `src/middleware/rateLimiter.ts`).
- **Atomic Lua scripts in Redis**: increment-and-expire is done as a single Lua script server-side to avoid a check-then-act race condition between concurrent requests (see `src/stores/redisStore.ts`).
- **Lazy token refill**: no background timers or cron jobs — tokens are calculated from elapsed time on each request, which is simpler and works identically across memory or Redis backends.

## Project structure

```
src/
  stores/         # Storage abstraction: memory (local dev) vs Redis (distributed)
  limiters/        # The two rate-limiting algorithms
  middleware/      # Express middleware wiring a limiter into the request pipeline
  gateway/         # Reverse proxy to the upstream backend
  config.ts        # Env-driven configuration
  index.ts         # Main gateway server
  mockBackend.ts    # Stand-in upstream API for local testing/demos
tests/              # Jest unit tests for both algorithms
loadtest/           # autocannon-based load test script
docker-compose.yml  # Redis + 2 gateway instances + mock backend
```

## Running locally (no Docker)

Requires Node.js 18+.

```bash
npm install
cp .env.example .env

# Terminal 1: start the mock upstream backend
npm run mock-backend

# Terminal 2: start the gateway (uses in-memory store by default)
npm run dev
```

Then try it:

```bash
# First few succeed, then you'll start getting 429s
for i in {1..10}; do curl -i http://localhost:3000/api/hello; echo; done
```

## Running the full distributed setup (Docker + Redis)

```bash
docker-compose up --build
```

This starts Redis, the mock backend, and **two gateway instances** (ports 3000 and 3001) sharing the same Redis. Hit both instances alternately and watch the shared quota deplete across both — proof the rate limit is global, not per-instance:

```bash
for i in {1..15}; do
  curl -s -o /dev/null -w "instance 3000 -> %{http_code}\n" http://localhost:3000/api/hello
  curl -s -o /dev/null -w "instance 3001 -> %{http_code}\n" http://localhost:3001/api/hello
done
```

## Tests

```bash
npm test
```

Covers: capacity limits, refill-over-time behavior, per-client isolation, and the sliding-window boundary-burst case.

## Load testing

```bash
npm run dev            # in one terminal
npm run mock-backend    # in another
npm run loadtest         # in a third, once both are up
```

Reports requests/sec, average latency, and how many requests were allowed vs. rate-limited under concurrent load (20 connections, 10 seconds by default — edit `loadtest/run.js` to change).

## Possible extensions

- Key by API key / JWT claim instead of IP, for per-user (not per-IP) limits
- Add a `/admin/limits/:key` endpoint to inspect or reset a client's quota
- Sliding window log (exact, timestamp-based) as a third algorithm for comparison
- Prometheus metrics endpoint for allowed/rejected request counts
