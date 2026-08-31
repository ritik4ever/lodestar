# Liveness and Readiness

The backend exposes two probes that answer different questions (#841). Conflating
them makes an orchestrator route traffic to instances that cannot serve it, and
restart instances whose only problem is a slow upstream.

| Probe | Question | Failure means |
| --- | --- | --- |
| Liveness | Is this process running? | Restart the container |
| Readiness | Can it serve traffic right now? | Stop routing here; do **not** restart |

## Endpoints

| Path | Kind | Checks |
| --- | --- | --- |
| `GET /healthz` | liveness | Nothing external. Returns uptime, queue depth, pending transactions |
| `GET /api/health` | liveness | Nothing external. Returns network and contract id |
| `GET /readyz` | readiness | RPC, and Redis when configured |
| `GET /api/ready` | readiness | Same as `/readyz` |

Liveness always returns **200** while the process is answering. Readiness returns
**200** when every required dependency is reachable and **503** when one is not.

## Readiness semantics

| Dependency | Required | Rationale |
| --- | --- | --- |
| Stellar RPC | yes | Every registry read and write goes through it; without it the backend cannot serve |
| Redis | no | The rate limiter falls back to an in-memory store, so an outage degrades rather than disables the service |

Response:

```jsonc
{
  "ready": true,
  "status": "ready",          // ready | degraded | not_ready
  "checks": [
    { "name": "rpc",   "required": true,  "ok": true, "latencyMs": 42 },
    { "name": "redis", "required": false, "ok": false, "latencyMs": 2000,
      "error": "redis check timed out after 2000ms" }
  ],
  "timestamp": "2026-08-29T10:00:00.000Z"
}
```

`degraded` still returns 200 and keeps serving — only a failed **required**
dependency takes the instance out of rotation.

Every dependency check is bounded by `READINESS_TIMEOUT_MS` (default 2000 ms).
A probe that hangs is worse than one that fails: the orchestrator learns nothing
until its own timeout fires.

## Container wiring

`backend/Dockerfile` declares a `HEALTHCHECK` against **`/healthz`** — Docker
restarts an unhealthy container, so pointing it at readiness would turn a
dependency outage into a restart loop.

`docker-compose.yml` uses the same liveness check, and the frontend now waits on
`condition: service_healthy` rather than `service_started`, so it does not come up
against a backend that has not finished booting.

In an orchestrator that distinguishes the two (Kubernetes, ECS), wire the
liveness probe to `/healthz` and the readiness probe to `/readyz`.
