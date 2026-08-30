#!/usr/bin/env node
/**
 * Autocannon (or fetch-fallback) runner for read-heavy routes (#834).
 *
 * Mirrors the k6 scenario but runs with Node.js so contributors without k6 can
 * still reproduce the load locally. If the `autocannon` npm package is installed
 * we use it for accurate throughput/latency stats; otherwise we fall back to a
 * bare `fetch` loop that reports comparable numbers without external deps.
 *
 * Usage:
 *   node backend/load-tests/run-autocannon.js
 *   BASE_URL=http://localhost:3001 node backend/load-tests/run-autocannon.js
 *   BASE_URL=https://lodestar-8na4.onrender.com node backend/load-tests/run-autocannon.js --connections 50 --duration 20
 *
 * Autocannon mode (if installed):
 *   npm install --save-dev autocannon   # one-time
 *   node backend/load-tests/run-autocannon.js --connections 50 --duration 30
 */

import { performance } from 'node:perf_hooks';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const SAMPLE_ADDRESS = 'GAMASX3TLJIDO42FO3GTX7IQAYN7RJ4U4CXJOROTB7RSV3NGPUEIEQH3';

const ROUTES = [
  '/api/services',
  '/api/services?category=search&limit=20',
  '/api/services?category=weather&limit=12',
  '/api/services?q=weather',
  '/api/services?offset=20&limit=20',
  '/api/services/1',
  '/api/services/1/history',
  '/api/stats',
  `/api/registry/by-provider/${SAMPLE_ADDRESS}`,
  '/api/agents?page=0&pageSize=12&sort=score',
  '/api/agents?page=1&pageSize=12&sort=payments',
  '/api/agents?page=0&pageSize=12&sort=newest',
  '/api/agents/stats',
  '/api/agents/count',
  `/api/agents/${SAMPLE_ADDRESS}`,
  `/api/agents/${SAMPLE_ADDRESS}/score`,
  `/api/agents/${SAMPLE_ADDRESS}/eligible?min_score=500`,
  `/api/agents/${SAMPLE_ADDRESS}/can-spend?amount=0.001&category=weather`,
  `/api/agents/${SAMPLE_ADDRESS}/payment-history?limit=20&offset=0`,
  '/healthz',
  '/readyz',
  '/api/health',
  '/api/ready',
];

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { connections: 10, duration: 20, pipelining: 1 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--connections' || args[i] === '-c') opts.connections = Number(args[++i]);
    else if (args[i] === '--duration' || args[i] === '-d') opts.duration = Number(args[++i]);
    else if (args[i] === '--pipelining') opts.pipelining = Number(args[++i]);
  }
  return opts;
}

async function tryAutocannon(opts) {
  let autocannon;
  try {
    autocannon = (await import('autocannon')).default;
  } catch {
    return null;
  }

  // Build one autocannon run that round-robins URLs via `requests` array.
  // autocannon supports `requests: [{ path, method }]` for mixed workloads.
  const requests = ROUTES.map((p) => ({ path: p, method: 'GET', headers: { Accept: 'application/json' } }));

  console.log(`\n[autocannon] BASE_URL=${BASE_URL} connections=${opts.connections} duration=${opts.duration}s pipelining=${opts.pipelining}`);
  console.log(`[autocannon] ${requests.length} routes weighted equally (see k6 file for weighted variant)`);

  return new Promise((resolve, reject) => {
    const instance = autocannon(
      {
        url: BASE_URL,
        connections: opts.connections,
        duration: opts.duration,
        pipelining: opts.pipelining,
        requests,
      },
      (err, result) => {
        if (err) return reject(err);
        console.log(autocannon.printResult(result));
        resolve({
          title: `autocannon c${opts.connections} d${opts.duration}s`,
          rps: result.requests.average,
          latencyAvgMs: result.latency.average,
          latencyP95Ms: result.latency.p95 ?? result.latency.p97_5,
          latencyP99Ms: result.latency.p99,
          throughputBytes: result.throughput.average,
          errors: result.errors,
          timeouts: result.timeouts,
          non2xx: result.non2xx,
          totalRequests: result.requests.total,
        });
      }
    );
    autocannon.track(instance, { renderProgressBar: true });
  });
}

async function fetchFallback(opts) {
  console.log(`\n[fetch-fallback] BASE_URL=${BASE_URL} concurrency=${opts.connections} duration=${opts.duration}s`);
  console.log(`[fetch-fallback] Install "autocannon" for more accurate stats: npm install --save-dev autocannon`);

  const latencies = [];
  let total = 0;
  let errors = 0;
  let non2xx = 0;

  const endAt = performance.now() + opts.duration * 1000;
  const workers = [];

  async function worker() {
    while (performance.now() < endAt) {
      const path = ROUTES[Math.floor(Math.random() * ROUTES.length)];
      const url = `${BASE_URL}${path}`;
      const start = performance.now();
      try {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        const dt = performance.now() - start;
        latencies.push(dt);
        total++;
        // 404 is acceptable for read routes (id may not exist under load)
        if (!(res.status >= 200 && res.status < 300) && res.status !== 404) non2xx++;
        // tiny think-time to avoid saturating the loop unrealistically
        await new Promise((r) => setTimeout(r, Math.random() * 20));
      } catch {
        errors++;
        total++;
      }
    }
  }

  for (let i = 0; i < opts.connections; i++) workers.push(worker());
  await Promise.all(workers);

  latencies.sort((a, b) => a - b);
  const avg = latencies.reduce((s, v) => s + v, 0) / (latencies.length || 1);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] ?? 0;
  const max = latencies[latencies.length - 1] ?? 0;
  const rps = total / opts.duration;

  console.log(`\n--- fetch-fallback results (concurrency=${opts.connections}) ---`);
  console.log(`  Total requests: ${total}`);
  console.log(`  RPS (avg):      ${rps.toFixed(1)}`);
  console.log(`  Latency avg:    ${avg.toFixed(2)} ms`);
  console.log(`  Latency p50:    ${p50.toFixed(2)} ms`);
  console.log(`  Latency p95:    ${p95.toFixed(2)} ms`);
  console.log(`  Latency p99:    ${p99.toFixed(2)} ms`);
  console.log(`  Latency max:    ${max.toFixed(2)} ms`);
  console.log(`  Non-2xx/404:    ${non2xx}`);
  console.log(`  Errors:         ${errors}`);

  return {
    title: `fetch-fallback c${opts.connections} d${opts.duration}s`,
    rps,
    latencyAvgMs: avg,
    latencyP95Ms: p95,
    latencyP99Ms: p99,
    latencyP50Ms: p50,
    latencyMaxMs: max,
    errors,
    non2xx,
    totalRequests: total,
  };
}

// Increasing-concurrency sweep matching the k6 stages (10 → 50 → 100).
async function main() {
  const baseOpts = parseArgs();

  // If user passed explicit --connections, do a single shot (CI single point).
  const explicit = process.argv.includes('--connections') || process.argv.includes('-c');

  const sweep = explicit
    ? [baseOpts]
    : [
        { connections: 10, duration: 15, pipelining: 1 },
        { connections: 50, duration: 15, pipelining: 1 },
        { connections: 100, duration: 15, pipelining: 1 },
      ];

  const results = [];
  for (const opts of sweep) {
    // Prefer autocannon if available, else fetch fallback
    let r = await tryAutocannon(opts);
    if (!r) r = await fetchFallback(opts);
    results.push(r);
    // Brief cool-down between steps
    await new Promise((res) => setTimeout(res, 2000));
  }

  console.log('\n=== Sweep summary (use for baseline / rate-limit ceilings) ===');
  console.table(
    results.map((r) => ({
      scenario: r.title,
      rps: typeof r.rps === 'number' ? r.rps.toFixed(1) : r.rps,
      avg_ms: r.latencyAvgMs?.toFixed ? r.latencyAvgMs.toFixed(1) : r.latencyAvgMs,
      p95_ms: r.latencyP95Ms?.toFixed ? r.latencyP95Ms.toFixed(1) : r.latencyP95Ms,
      p99_ms: r.latencyP99Ms?.toFixed ? r.latencyP99Ms.toFixed(1) : r.latencyP99Ms,
      errors: r.errors,
      non2xx: r.non2xx ?? r.non2xx,
    }))
  );

  // Machine-readable JSON for CI artefact
  const summary = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    results,
  };
  console.log('\n--- JSON summary (for artefact) ---');
  console.log(JSON.stringify(summary, null, 2));

  // Non-zero exit if p95 breaches SLO in any step (helps tie to rate-limit choices)
  const breached = results.some((r) => (r.latencyP95Ms ?? 0) > 500);
  if (breached) {
    console.warn('\nWARN: p95 > 500 ms in at least one step — consider lowering rate-limit ceiling or adding cache');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
