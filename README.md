# Rate Limit Gateway

A distributed API rate limiter and reverse proxy gateway, built in TypeScript. It sits in front of any backend API and enforces per-client request quotas — the same architectural pattern used by Kong, AWS API Gateway, and Cloudflare — with a live dashboard to watch it work in real time.

**[Live dashboard demo →](#live-dashboard)** · **[Why Redis?](#why-redis-not-just-in-memory-counters)** · **[Run it yourself](#running-locally-no-docker)**

---

## Why this exists

Every public API needs to protect itself from clients sending too many requests — whether malicious (abuse, scraping) or accidental (a retry loop gone wrong). This project implements that protection as a standalone gateway service that any backend can sit behind, without changing a line of the backend's own code.

## What's inside

| Piece | What it proves |
|---|---|
| **Token bucket algorithm** | Allows realistic traffic bursts while enforcing a steady average rate |
| **Sliding window counter** | Avoids the "boundary burst" bug that simple fixed-window limiters have |
| **Redis-backed distributed state** | One shared quota across multiple gateway instances, not per-instance |
| **Atomic Lua scripts** | No race conditions when concurrent requests hit the same client key |
| **Live dashboard** | Watch the token bucket fill and drain against real traffic |
| **Docker Compose setup** | Two gateway instances + Redis + backend, proving the "distributed" claim |
| **Jest test suite** | 6 tests covering capacity limits, refill timing, and window edge cases |
| **Load test script** | Real throughput numbers (60K+ req/sec sustained in testing) |

## Live dashboard

Once the gateway is running, open **`http://localhost:3000/dashboard.html`** in a browser.

You'll see:
- A **token bucket that visually drains and refills** in real time, tied to the actual algorithm state — not a mock animation
- A **live request log** showing every request's outcome (200 allowed / 429 blocked)
- Running totals of allowed vs. blocked traffic
- A "Start traffic" button (steady stream) and a "Send burst of 15" button (to watch the bucket empty and hit the limit instantly)

This is the fastest way to *see* what the rate limiter is actually doing, rather than reading `curl` output.

## Architecture

```
                    ┌──────────────────┐
   client requests  │                  │
  ────────────────► │   Gateway (this) │
                     │  ┌────────────┐ │       ┌──────────────┐
                     │  │ Rate Limit │ │       │              │
                     │  │ Middleware │◄┼──────►│    Redis     │
                     │  └─────┬──────┘ │       │(shared state)│
                     │        │        │       └──────────────┘
                     │        ▼        │
                     │  ┌────────────┐ │       ┌──────────────┐
                     │  │  Reverse   │ │       │   Upstream   │
                     │  │   Proxy    ├─┼──────►│   Backend    │
                     │  └────────────┘ │       │  (your API)  │
                     └──────────────────┘       └──────────────┘
```

Requests hit the gateway first. The rate limit middleware checks (and updates) the client's quota in Redis. If allowed, the request is forwarded to the real backend via the reverse proxy; if not, the gateway responds `429 Too Many Requests` without the backend ever seeing the request.

### Why Redis, not just in-memory counters?

Run multiple copies of this gateway behind a load balancer (which any real deployment would, for availability) and in-memory counters give each instance its **own separate quota** — a client could get N× the intended rate by spreading requests across N instances. Redis gives every instance one shared source of truth, so the limit holds no matter which instance handles a given request.

This repo proves it: `docker-compose.yml` runs **two gateway instances against one Redis**, and hitting both alternately shows the shared quota deplete together — not doubled.

```
3000 -> 200   3001 -> 200   3000 -> 200   3001 -> 200   3000 -> 200
3001 -> 200   3000 -> 200   3001 -> 200   3000 -> 200   3001 -> 200
3000 -> 429   3001 -> 429   3000 -> 429   3001 -> 429   ...
```
*(actual output from a two-instance run with `BUCKET_CAPACITY=10`, split ~5/5 across instances before both correctly reject)*

### Algorithms implemented

**Token Bucket** — `src/limiters/tokenBucket.ts`
Each client has a bucket holding up to `capacity` tokens, refilling continuously at `refillRatePerSecond`. Every request costs one token. Allows short bursts while enforcing a steady average rate — closer to how real client traffic behaves than a naive fixed counter.

**Sliding Window Counter** — `src/limiters/slidingWindowCounter.ts`
Approximates a true sliding window by weighting the previous fixed window's count by how much it overlaps the current lookback period. Avoids the "boundary burst" bug of fixed windows (e.g. 100 requests at 0:59 + 100 more at 1:00 against a "100/minute" limit) at O(1) cost per request.

Switch between them with the `RATE_LIMIT_ALGORITHM` environment variable.

### Design tradeoffs (worth knowing before an interview)

- **Fail-open on store errors** — if Redis goes down, the gateway lets traffic through rather than blocking all API access. Availability over strict enforcement, a deliberate choice (see `src/middleware/rateLimiter.ts`).
- **Atomic Lua scripts in Redis** — increment-and-expire runs as a single Lua script server-side, avoiding a check-then-act race condition where two concurrent requests could both read the same count before either writes it back (see `src/stores/redisStore.ts`).
- **Lazy token refill** — no background timers or cron jobs; tokens are calculated from elapsed time on each request, which is simpler and behaves identically across memory or Redis backends.

## Project structure

```
public/
  dashboard.html      # Live monitor — served directly by the gateway
src/
  stores/             # Storage abstraction: memory (local dev) vs Redis (distributed)
  limiters/           # The two rate-limiting algorithms
  middleware/          # Express middleware wiring a limiter into the request pipeline
  gateway/             # Reverse proxy to the upstream backend
  config.ts            # Env-driven configuration
  index.ts              # Main gateway server
  mockBackend.ts        # Stand-in upstream API for local testing/demos
tests/                  # Jest unit tests for both algorithms
loadtest/               # autocannon-based load test script
docker-compose.yml      # Redis + 2 gateway instances + mock backend
```

## Running locally (no Docker)

Requires Node.js 18+.

```bash
npm install
cp .env.example .env
```

Open two terminal tabs:

```bash
# Terminal 1
npm run mock-backend

# Terminal 2
npm run dev
```

Then open **`http://localhost:3000/dashboard.html`** and click "Start traffic" — or test from the command line:

```bash
for i in {1..25}; do curl -i http://localhost:3000/api/hello; echo; done
```

## Running the full distributed setup (Docker + Redis)

```bash
docker compose up --build
```

This starts Redis, the mock backend, and **two gateway instances** (ports 3000 and 3001) sharing one Redis. Hit both alternately to watch the shared quota deplete together:

```bash
for i in {1..15}; do
  curl -s -o /dev/null -w "3000 -> %{http_code}\n" http://localhost:3000/api/hello
  curl -s -o /dev/null -w "3001 -> %{http_code}\n" http://localhost:3001/api/hello
done
```

## Tests

```bash
npm test
```

6 tests covering: capacity limits, refill-over-time behavior, per-client isolation, and the sliding-window boundary-burst case.

## Load testing

```bash
npm run dev            # terminal 1
npm run mock-backend    # terminal 2
npm run loadtest         # terminal 3, once both are up
```

Reports requests/sec, average latency, and how many requests were allowed vs. rate-limited under concurrent load. In testing on this project: **60,000+ requests/sec sustained at sub-millisecond average latency**, with the limiter correctly rejecting all traffic beyond the configured quota.

## Possible extensions

- Key by API key / JWT claim instead of IP, for per-user (not per-IP) limits
- Add a `/admin/limits/:key` endpoint to inspect or reset a client's quota
- Sliding window log (exact, timestamp-based) as a third algorithm for comparison
- Prometheus metrics endpoint for allowed/rejected request counts

## Tech stack

TypeScript · Express · Redis (ioredis) · Docker · Jest · autocannon
