# Load Test — Read-Heavy Routes (#834)

Covers `GET /api/services`, `GET /api/stats`, `GET /api/agents` and related
read endpoints referenced in
[`backend/src/routes/registry.js:110`](../../backend/src/routes/registry.js#L110)
and
[`backend/src/routes/agents.js:91`](../../backend/src/routes/agents.js#L91).

The scenario hits every read route the frontend and autonomous agents use at
scale so we have a baseline before choosing rate-limit ceilings.

## Scenarios

| File | Runner | When to use |
|------|--------|-------------|
| [`read-heavy.k6.js`](./read-heavy.k6.js) | [k6](https://k6.io) (Grafana) | CI scheduled runs, full SLO thresholds |
| [`run-autocannon.js`](./run-autocannon.js) | [autocannon](https://github.com/mcollina/autocannon) or plain `fetch` fallback | Local dev without k6 binary — also used by CI as fallback |

Both runners hit the same route catalogue (see `ROUTES` in each file) with a
weighted mix reflecting expected traffic:

- ~58 % registry listing (`/api/services` variants)
- ~10 % registry stats & by-provider (the expensive `GET /api/stats` scatter-gather)
- ~28 % agents listing / stats / count
- ~4 % per-address reads + liveness/readiness

## Thresholds / SLOs

```
http_req_failed  < 1 %
p95 latency      < 500 ms
p99 latency      < 1000 ms
```

If any threshold breaches, the runner exits non-zero and the workflow fails.
Breach at `50–100` concurrent connections is the signal to lower the
read-path rate-limit ceiling or to promote the registry stats cache.

## Quick start

```bash
# 1. Start the backend (or a stub — see below)
cd backend
npm install

# 2a. With k6 (recommended for CI parity)
k6 run load-tests/read-heavy.k6.js
BASE_URL=https://lodestar-8na4.onrender.com k6 run load-tests/read-heavy.k6.js

# 2b. With autocannon (no extra binary)
npm run load:autocannon
BASE_URL=http://localhost:3001 npm run load:autocannon

# 2c. Increasing-concurrency sweep (10 → 50 → 100) — same stages k6 uses
node load-tests/run-autocannon.js
```

Machine-readable summaries (`--out json` for k6, stdout JSON for autocannon)
are collected by CI and uploaded as artefacts — see
[`.github/workflows/load-test.yml`](../../.github/workflows/load-test.yml).

## Stub server

`[`stub-server.js`](./stub-server.js)` is a zero-dependency Express server that
mocks every read route with in-memory data and ~5–15 ms jitter. It models the
fast cache-hit path; real Stellar RPC calls will be slower but the relative
shape of the curve is the same. CI runs the scheduled load against the stub so
results are deterministic without needing testnet secrets.

```bash
# in one terminal
node backend/load-tests/stub-server.js   # http://localhost:3456

# in another
BASE_URL=http://localhost:3456 node backend/load-tests/run-autocannon.js
BASE_URL=http://localhost:3456 k6 run backend/load-tests/read-heavy.k6.js
```

## Choosing rate-limit ceilings

1. Find the concurrency where `p95` first exceeds `500 ms` in the
   [baseline](./BASELINE.md). That `connections` value is the sustainable ceiling
   for a single instance.
2. Divide by the number of replicas and leave 30 % headroom — e.g. if the
   baseline holds 50 conn under 500 ms, set the limiter to `35` req/s per
   instance.
3. The scheduled workflow re-measures weekly; if the curve shifts, the artefact
   diff makes the regression obvious before a limit is raised.

## Artefacts

Every scheduled run uploads `k6-summary.json` / `autocannon-summary.json` to the
workflow run (retained 30 days). Download them from the Actions tab and diff
against [`BASELINE.md`](./BASELINE.md) to detect drift.

## Notes

- The expensive route is `GET /api/stats` (`registry.js:268`) which fans out to
  `N = ceil(totalServices / PAGE_SIZE)` sequential `listServices` calls. Under
  load this dominates tail latency — cache it if `p99` climbs first on that tag.
- `GET /api/agents` already has a 30 s in-memory cache (`agents.js:48`)
  (`getCachedAgents`) so it stays flat longer; use it as the control when
  comparing before/after.
