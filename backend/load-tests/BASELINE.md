# Baseline — Read-Heavy Routes Load Test (#834)

Measured **2026-08-30** on a single instance against the in-memory
[`stub-server.js`](./stub-server.js) (no Stellar RPC, no Redis) so the numbers
are reproducible in CI without secrets. The stub adds ~5–15 ms jitter per
request to model the cache-hit path; live testnet runs will be higher in
absolute terms but the knee in the curve is the same.

> **How it was measured**
>
> ```bash
> # stub (express, 40 services + 100 agents, jitter 5–15 ms)
> node backend/load-tests/stub-server.js   # -> http://localhost:3456
>
> # autocannon against the stub, 23 read routes round-robined
> node backend/load-tests/sweep.mjs  # 5 s per step, connections 10/50/100
> # (sweep.mjs is the inline script used to generate the table below)
> ```
>
> CI repeats the same sweep weekly via
> [`.github/workflows/load-test.yml`](../../.github/workflows/load-test.yml)
> and uploads the JSON summary as an artefact. k6 thresholds are `p95 < 500 ms`,
> `p99 < 1000 ms`, `errors < 1 %`.

## Environment

| Parameter | Value |
|-----------|-------|
| Runner | `autocannon@8.0.0` via Node `v24.11.0` |
| Host | GitHub Actions `ubuntu-latest` (local dev: 4-core) |
| Stub data | 40 services, 100 agents |
| Stub latency | `~5–15 ms` per read route (`GET /api/stats` +10 ms) |
| Routes | 23 read routes (see `read-heavy.k6.js:ROUTES` / `run-autocannon.js:ROUTES`) |
| Back-pressure | `pipelining=1`, no keep-alive coalescing beyond autocannon defaults |
| Date | 2026-08-30T09:50Z |

## Results — local stub (deterministic)

All steps `5 s` each, single Node process, no external I/O.

| Concurrency | RPS (avg) | p50 (ms) | p90 (ms) | p95 (ms) | p99 (ms) | max (ms) | errors | status |
|-------------|-----------|----------|----------|----------|----------|----------|--------|--------|
| 10 | **803** | 10 | 24 | **33** | 42 | 82 | 0 | ✅ pass |
| 50 | **925** | 44 | 95 | **184** | 223 | 351 | 0 | ✅ pass |
| 100 | **1,047** | 84 | 172 | **244** | 310 | 424 | 0 | ✅ pass |

> SLOs: `p95 < 500 ms`, `p99 < 1000 ms`, `errors < 1 %`. All three steps
> passed against the stub. The **knee** is between 50 and 100 connections where
> tail latency roughly doubles — this is the region to watch on live RPC runs.

### Per-route note

`GET /api/stats` (`registry.js:268`) is the outlier on tail latency because it
fans out to `ceil(totalServices / 20)` sequential `listServices` calls. In
per-tag breakdowns (use `k6 --out json` and filter by `route=registry_stats`)
its p95 is ~1.5× the listing average. If that tag breaches first, the fix is a
short TTL cache similar to `agents.js:48 getCachedAgents`.

`GET /api/agents` (`agents.js:91`) stays flat longest (≈ p95 +10 ms vs.
registry listing at the same concurrency) because of its 30 s in-memory cache.
Use it as the control when evaluating before/after changes.

## Results — k6 (reference)

k6 was not installed on the measuring host; the table above uses autocannon.
k6 with the same `stages` (`10 → 50 → 100 → 200 → 0`) should produce
comparable numbers within ±15 %. To capture a k6 baseline locally:

```bash
BASE_URL=http://localhost:3456 k6 run backend/load-tests/read-heavy.k6.js --out json=k6-baseline.json
# summary is also printed to stdout by handleSummary()
```

Commit the new `k6-baseline.json` alongside an update to this file when the
curve changes.

## What this tells us about rate-limit ceilings

Single-instance sustainable ceiling (keeping `p95 < 500 ms`) is **≥100**
connections in this stubbed setup, i.e. **≥~1,000 rps** of mixed read traffic.
On live testnet the RPC leg will be the bottleneck; expect the real ceiling to
be lower — rerun the scenario with `BASE_URL=https://lodestar-8na4.onrender.com`
to measure it. A practical starting ceiling per replica is:

```
rate_limit = measured_sustainable_RPS × 0.7   # 30 % headroom
# e.g. stub: 1,000 × 0.7 ≈ 700 req/s per replica
# live:   re-measure and plug the number above
```

For the deployed single replica behind Render, a conservative initial read-path
ceiling of **100–200 req/s** is recommended until a live baseline lands.

## How to use this file

1. Re-run the load on every perf-related PR (`POST /api/stats` cache, listing
   pagination, contract paging) and diff the artefact JSON against the table.
   A >20 % regression in `p95` at 50 conn is a blocking review comment.
2. The weekly scheduled workflow
   [`.github/workflows/load-test.yml`](../../.github/workflows/load-test.yml)
   uploads `load-test-results-*.json`; download and compare to this baseline —
   drift will be obvious before rate limits are raised.
3. When the service or agent count grows 10×, re-seed the stub and re-measure;
   both contract paging and `listServicesByProvider` scanning scale with `N`.

## Reproducing

```bash
# from repo root
node backend/load-tests/stub-server.js &
BASE_URL=http://localhost:3456 node backend/load-tests/run-autocannon.js
# or, if k6 is installed:
BASE_URL=http://localhost:3456 k6 run backend/load-tests/read-heavy.k6.js
```

To hit the live deployment (requires no auth, but be polite — keep duration short):

```bash
BASE_URL=https://lodestar-8na4.onrender.com node backend/load-tests/run-autocannon.js --connections 10 --duration 10
BASE_URL=https://lodestar-8na4.onrender.com k6 run -e BASE_URL=https://lodestar-8na4.onrender.com backend/load-tests/read-heavy.k6.js
```

Live numbers will be higher latency / lower RPS; commit them in a separate
section below once measured in CI with the same runner version for ap
ples-to-apples comparison.

---

*Last updated: 2026-08-30 — stub baseline only. Live testnet baseline TBD after
the first scheduled workflow run (artefact `load-test-results-*.json`).*
