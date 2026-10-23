/**
 * Reproducible concurrent load test for the UrjaSetu EMS Platform API.
 * Measures response latency percentiles (p50, p90, p95, p99), throughput (req/s),
 * error rates, and connection handling under concurrent requests.
 *
 * Usage:
 *   pnpm -C platform/api tsx scripts/load-test.ts [baseUrl] [concurrency] [totalRequests]
 *
 * Example:
 *   pnpm -C platform/api tsx scripts/load-test.ts http://127.0.0.1:8080 10 100
 */

const baseUrl = (process.argv[2] ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const concurrency = Math.max(1, Number(process.argv[3] ?? 10));
const totalRequests = Math.max(concurrency, Number(process.argv[4] ?? 100));

interface Result {
  endpoint: string;
  status: number;
  durationMs: number;
  ok: boolean;
}

const endpoints = [
  "/api/health",
  "/api/tariffs",
  "/api/policy-rules",
  "/api/system/health",
];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

async function fetchOne(endpoint: string): Promise<Result> {
  const t0 = performance.now();
  try {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      headers: { "user-agent": "UrjaSetu-LoadTest/1.0" },
    });
    await res.text();
    const durationMs = performance.now() - t0;
    return { endpoint, status: res.status, durationMs, ok: res.ok };
  } catch {
    const durationMs = performance.now() - t0;
    return { endpoint, status: 0, durationMs, ok: false };
  }
}

async function main(): Promise<void> {
  console.log(`=== UrjaSetu EMS API Concurrent Load Test ===`);
  console.log(`Target:         ${baseUrl}`);
  console.log(`Concurrency:    ${concurrency} simultaneous workers`);
  console.log(`Total Requests: ${totalRequests} requests`);
  console.log(`Endpoints:      ${endpoints.join(", ")}\n`);

  // Verify server is alive before testing
  try {
    const health = await fetch(`${baseUrl}/api/health`);
    if (!health.ok) {
      console.error(`FATAL: Server at ${baseUrl}/api/health returned HTTP ${health.status}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`FATAL: Unable to reach ${baseUrl}. Is the API server running?`);
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const results: Result[] = [];
  let completed = 0;
  const overallStart = performance.now();

  const worker = async () => {
    while (true) {
      const idx = completed++;
      if (idx >= totalRequests) break;
      const endpoint = endpoints[idx % endpoints.length]!;
      const r = await fetchOne(endpoint);
      results.push(r);
    }
  };

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  const totalDurationMs = performance.now() - overallStart;
  const totalDurationSec = totalDurationMs / 1000;
  const throughput = (results.length / totalDurationSec).toFixed(2);

  const latencies = results.map((r) => r.durationMs).sort((a, b) => a - b);
  const successCount = results.filter((r) => r.ok).length;
  const failureCount = results.length - successCount;
  const errorRate = ((failureCount / results.length) * 100).toFixed(1);

  const p50 = percentile(latencies, 50).toFixed(1);
  const p90 = percentile(latencies, 90).toFixed(1);
  const p95 = percentile(latencies, 95).toFixed(1);
  const p99 = percentile(latencies, 99).toFixed(1);
  const min = latencies[0]?.toFixed(1) ?? "0";
  const max = latencies[latencies.length - 1]?.toFixed(1) ?? "0";
  const mean = (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(1);

  console.log(`--- Load Test Summary ---`);
  console.log(`Completed:      ${results.length} requests in ${totalDurationSec.toFixed(2)}s`);
  console.log(`Throughput:     ${throughput} req/sec`);
  console.log(`Success Rate:   ${successCount}/${results.length} (${(100 - Number(errorRate)).toFixed(1)}%)`);
  console.log(`Error Rate:     ${errorRate}% (${failureCount} failed)`);
  console.log(`\n--- Latency Distribution (ms) ---`);
  console.log(`Min:            ${min} ms`);
  console.log(`Mean:           ${mean} ms`);
  console.log(`Median (p50):   ${p50} ms`);
  console.log(`p90:            ${p90} ms`);
  console.log(`p95:            ${p95} ms`);
  console.log(`p99:            ${p99} ms`);
  console.log(`Max:            ${max} ms\n`);

  console.log(`--- Per-Endpoint Latency (Median / p95) ---`);
  for (const ep of endpoints) {
    const epResults = results.filter((r) => r.endpoint === ep);
    const epLats = epResults.map((r) => r.durationMs).sort((a, b) => a - b);
    const epMed = percentile(epLats, 50).toFixed(1);
    const epP95 = percentile(epLats, 95).toFixed(1);
    const epSuccess = epResults.filter((r) => r.ok).length;
    console.log(`${ep.padEnd(20)}: ${epMed.padStart(6)} ms (p50) | ${epP95.padStart(6)} ms (p95) | ${epSuccess}/${epResults.length} ok`);
  }

  if (failureCount > 0) {
    console.error(`\nLoad test encountered ${failureCount} errors.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Load test failed:", err);
  process.exit(1);
});
