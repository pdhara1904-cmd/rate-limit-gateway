/**
 * Load test: fires concurrent requests at the gateway and reports
 * throughput plus how many requests were allowed vs rate-limited.
 *
 * This is what gives you a real NUMBER for your resume/interview
 * instead of a vague "handles high traffic" claim, e.g.:
 * "Load-tested at 500 req/sec with autocannon; correctly rate-limited
 *  X% of requests exceeding the configured quota."
 *
 * Usage: make sure the gateway (and mock backend) are running, then:
 *   npm run loadtest
 */
const autocannon = require("autocannon");

async function run() {
  const result = await autocannon({
    url: "http://localhost:3000/api/hello",
    connections: 20,
    duration: 10,
  });

  const allowed = result["2xx"];
  const limited = result.non2xx; // includes 429s

  console.log("\n=== Load Test Results ===");
  console.log(`Requests/sec (avg): ${result.requests.average}`);
  console.log(`Latency (avg ms):   ${result.latency.average}`);
  console.log(`2xx responses:      ${allowed}`);
  console.log(`Non-2xx (mostly 429s): ${limited}`);
  console.log(`Total requests:     ${result.requests.total}`);
}

run().catch((err) => {
  console.error("Load test failed:", err.message);
  console.error("Make sure the gateway is running: npm run dev");
  process.exit(1);
});
