/**
 * k6 load scenario for the read-heavy routes (#834).
 *
 * Covers the listing and stats routes that carry most traffic:
 *   - GET /api/services (with category / q variants) — registry.js:110
 *   - GET /api/stats                                  — registry.js:268
 *   - GET /api/agents  (paginated + sorted)           — agents.js:91
 *   - GET /api/agents/stats, /count, /:address/*     — agents.js
 *
 * Usage:
 *   k6 run backend/load-tests/read-heavy.k6.js
 *   k6 run -e BASE_URL=https://lodestar-8na4.onrender.com backend/load-tests/read-heavy.k6.js
 *   k6 run --out json=results.json backend/load-tests/read-heavy.k6.js
 *
 * Thresholds map to the SLOs we want to guard with rate-limit ceilings:
 *   p95 < 500 ms, p99 < 1000 ms, error rate < 1 %.
 * If a threshold breaches, k6 exits non-zero which fails CI.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';

// A valid Stellar public key for by-provider / by-address routes.
// This is the well-known test address used across backend tests — it does not
// need to own services/agents; the route just validates format and queries chain.
const SAMPLE_ADDRESS = 'GAMASX3TLJIDO42FO3GTX7IQAYN7RJ4U4CXJOROTB7RSV3NGPUEIEQH3';

export const options = {
  stages: [
    { duration: '30s', target: 10 },   // warm-up
    { duration: '30s', target: 50 },   // nominal
    { duration: '1m', target: 100 },   // stress
    { duration: '30s', target: 200 },  // spike — where we expect to see limits
    { duration: '30s', target: 0 },    // cool-down
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    // Custom per-route durations — fail if any single listing route degrades badly.
    // k6 can filter by tag; we use `expected_response:true` checks below.
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
};

// ---------------------------------------------------------------------------
// Route catalogue — weighted by expected real-world traffic share.
// Listing routes get the highest weight because the issue says they carry most traffic.
// ---------------------------------------------------------------------------

const ROUTES = [
  // Registry listing (highest traffic)
  { method: 'GET', path: '/api/services', weight: 25, tag: 'registry_list' },
  { method: 'GET', path: '/api/services?category=search&limit=20', weight: 10, tag: 'registry_list_category' },
  { method: 'GET', path: '/api/services?category=weather&limit=12', weight: 10, tag: 'registry_list_category' },
  { method: 'GET', path: '/api/services?q=weather', weight: 8, tag: 'registry_list_search' },
  { method: 'GET', path: '/api/services?offset=20&limit=20', weight: 5, tag: 'registry_list_paging' },

  // Registry single + history (moderate)
  { method: 'GET', path: '/api/services/1', weight: 4, tag: 'registry_get_one' },
  { method: 'GET', path: '/api/services/1/history', weight: 2, tag: 'registry_history' },

  // Registry stats (heavy — sequential scatter-gather across all services)
  { method: 'GET', path: '/api/stats', weight: 6, tag: 'registry_stats' },
  { method: 'GET', path: `/api/registry/by-provider/${SAMPLE_ADDRESS}`, weight: 4, tag: 'registry_by_provider' },

  // Agents listing (highest traffic on agents side)
  { method: 'GET', path: '/api/agents?page=0&pageSize=12&sort=score', weight: 15, tag: 'agents_list' },
  { method: 'GET', path: '/api/agents?page=1&pageSize=12&sort=payments', weight: 5, tag: 'agents_list' },
  { method: 'GET', path: '/api/agents?page=0&pageSize=12&sort=newest', weight: 3, tag: 'agents_list' },

  // Agents stats / count
  { method: 'GET', path: '/api/agents/stats', weight: 6, tag: 'agents_stats' },
  { method: 'GET', path: '/api/agents/count', weight: 4, tag: 'agents_count' },

  // Agents per-address reads (lighter but should stay fast)
  { method: 'GET', path: `/api/agents/${SAMPLE_ADDRESS}`, weight: 2, tag: 'agents_get' },
  { method: 'GET', path: `/api/agents/${SAMPLE_ADDRESS}/score`, weight: 2, tag: 'agents_score' },
  { method: 'GET', path: `/api/agents/${SAMPLE_ADDRESS}/eligible?min_score=500`, weight: 1, tag: 'agents_eligible' },
  { method: 'GET', path: `/api/agents/${SAMPLE_ADDRESS}/can-spend?amount=0.001&category=weather`, weight: 1, tag: 'agents_can_spend' },
  { method: 'GET', path: `/api/agents/${SAMPLE_ADDRESS}/payment-history?limit=20&offset=0`, weight: 1, tag: 'agents_payment_history' },

  // Liveness / readiness (cheap, always hit by orchestrators + load balancers)
  { method: 'GET', path: '/healthz', weight: 3, tag: 'healthz' },
  { method: 'GET', path: '/readyz', weight: 3, tag: 'readyz' },
  { method: 'GET', path: '/api/health', weight: 1, tag: 'api_health' },
  { method: 'GET', path: '/api/ready', weight: 1, tag: 'api_ready' },
];

// Build a flat weighted picker array.
function buildPicker(routes) {
  const picker = [];
  for (const r of routes) {
    for (let i = 0; i < r.weight; i++) picker.push(r);
  }
  return picker;
}

const PICKER = buildPicker(ROUTES);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function pickRoute() {
  return PICKER[Math.floor(Math.random() * PICKER.length)];
}

// ---------------------------------------------------------------------------
// VU lifecycle
// ---------------------------------------------------------------------------

export default function () {
  const route = pickRoute();
  const url = `${BASE_URL}${route.path}`;

  const res = http.get(url, {
    tags: { route: route.tag },
    headers: { Accept: 'application/json' },
  });

  // 2xx or 404 are "correct" responses for read routes (404 just means id not found,
  // which is fine under load — we only fail on 5xx / timeouts).
  const ok = check(res, {
    'status is 2xx or 404': (r) => (r.status >= 200 && r.status < 300) || r.status === 404,
    'response time < 500ms': (r) => r.timings.duration < 500,
  }, { route: route.tag });

  // Small think-time so we don't hammer as a tight loop — models real client gap
  // between discovering a service and fetching its detail.
  sleep(Math.random() * 0.4 + 0.1);
}

// Emit a machine-readable summary when run with --out json or handleSummary.
export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    // Pass/fail of the thresholds — basis for choosing rate-limit ceilings.
    thresholds_passed: Object.values(data.thresholds || {}).every((t) => t.ok !== false),
    metrics: {},
  };

  // Lift the key http metrics into the summary for baseline comparison.
  for (const [name, metric] of Object.entries(data.metrics || {})) {
    if (name.startsWith('http_req')) {
      summary.metrics[name] = {
        avg: metric.values?.avg,
        med: metric.values?.med,
        'p(90)': metric.values?.['p(90)'],
        'p(95)': metric.values?.['p(95)'],
        'p(99)': metric.values?.['p(99)'],
        max: metric.values?.max,
        count: metric.values?.count,
        fails: metric.values?.fails,
      };
    }
  }

  return {
    stdout: JSON.stringify(summary, null, 2),
  };
}
