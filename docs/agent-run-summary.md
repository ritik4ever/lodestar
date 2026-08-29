# Agent Run Summary

The agent writes a machine-readable JSON summary at the end of every run, so
downstream tooling can consume the outcome without parsing log prose (#843).

## Output path

| Setting | Value |
| --- | --- |
| Env var | `AGENT_RUN_SUMMARY_PATH` |
| Default | `agent-run-summary.json` in the working directory |
| Disable | set `AGENT_RUN_SUMMARY_PATH=""` (empty string) |

Relative paths are resolved to absolute; missing parent directories are created.

The summary is written on **success and failure alike**, including when the run
crashes or is cut short by a shutdown signal — a failed run is exactly the case
where a consumer most needs the artefact. Writing is best-effort: if the path is
unwritable the agent logs a warning and continues, since an observability
artefact must never change the exit status.

## Schema

`schemaVersion` is an integer, currently `1`. It is incremented on any breaking
change, so a consumer can refuse a file it does not understand.

```jsonc
{
  "schemaVersion": 1,
  "status": "success",          // success | partial | failure
  "agent": { "address": "G...", "name": "lodestar-agent" },
  "startedAt": "2026-08-29T10:00:00.000Z",
  "finishedAt": "2026-08-29T10:02:30.000Z",
  "durationMs": 150000,
  "tasks": [
    {
      "category": "weather",
      "success": true,
      "servicesDiscovered": 4,   // services returned by the registry
      "servicesEligible": 3,     // those meeting AGENT_MIN_SERVICE_REPUTATION
      "attempts": 1,             // candidate services tried
      "priceUsdc": "0.010000",
      "txHash": "abc123",
      "scoreAfter": 72,
      "durationMs": 1200,
      "failureReason": null,     // set when success is false
      "selection": {             // why this service was chosen; null if none was
        "serviceId": "svc-1",
        "serviceName": "Weather API",
        "reputation": 90,
        "priceUsdc": "0.010000",
        "strategy": "reputation_weighted_random",
        "candidatesConsidered": 3,
        "minReputation": 0
      }
    }
  ],
  "totals": {
    "tasks": 1,
    "succeeded": 1,
    "failed": 0,
    "usdcSpent": "0.010000",     // string, 6dp — never a float
    "unresolvedPayments": 0
  },
  "score": { "before": 70, "after": 72, "delta": 2 },
  "unresolvedPayments": [],
  "shutdownInitiated": false,
  "error": null                  // { "name", "message" } when the run crashed
}
```

### `status`

Derived, not reported by the caller:

| Value | Meaning |
| --- | --- |
| `success` | Every task succeeded and the run was not cut short |
| `partial` | At least one task succeeded and at least one did not, or shutdown interrupted the run |
| `failure` | No task succeeded, no tasks ran, or the run crashed |

A run interrupted by SIGTERM never reports `success`, even if the tasks that did
run all passed — the remaining ones never got a chance.

### `failureReason`

| Value | Meaning |
| --- | --- |
| `no_services_found` | The registry returned nothing for the category |
| `no_services_meet_min_reputation` | Services exist but all fall below `AGENT_MIN_SERVICE_REPUTATION` |
| `all_candidates_exhausted` | Every candidate was tried and failed |
| `skipped_due_to_shutdown` | Shutdown began before the task started |

### Notes for consumers

- `usdcSpent` and `priceUsdc` are **strings** with 6 decimal places. Do not parse
  them as floats for accounting.
- `score.delta` is `null` when either endpoint is unknown, which happens when
  scoring is disabled.
- `selection` is `null` for a task that never got as far as choosing a service.
- Timestamps are ISO 8601 in UTC.
