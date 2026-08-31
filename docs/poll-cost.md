# Activity Poll Cost

`waitForActivityTxHash` waits for a submitted transaction to appear in the
activity feed. Each poll is an RPC call, so the wait strategy is an RPC budget
decision (#852).

## Strategy

Exponential backoff bounded by a total-time budget:

| Setting | Meaning |
| --- | --- |
| `pollInitialDelayMs` | Delay before the second poll |
| `pollMaxDelayMs` | Ceiling on the delay between polls |
| `pollMaxWaitMs` | Total time budget — the wait never exceeds this |

The delay doubles after each poll up to `pollMaxDelayMs`, and the final delay is
clipped so the total never overshoots `pollMaxWaitMs`. A wait also stops
immediately when its `AbortSignal` fires, so a disconnected client stops costing
RPC calls at once rather than running out the full budget.

## Measurement

Poll cost is recorded per wait and in aggregate, so a change to the parameters
can be shown to have helped rather than assumed to have.

Per wait — pass `onPollSample` and receive:

| Field | Meaning |
| --- | --- |
| `polls` | Feed reads performed — one RPC call each |
| `sleeps` | Backoff sleeps between polls |
| `totalDelayMs` | Time spent sleeping |
| `durationMs` | Wall-clock duration of the wait |
| `outcome` | `matched`, `timeout`, or `aborted` |

The demo route logs this as `activity_poll_complete`, so the cost of each wait is
visible in production logs alongside the request that paid for it.

In aggregate — `getPollMetrics()` returns totals plus `avgPollsPerWait`, the
headline number: it is what a change to the backoff parameters is meant to move.
`resetPollMetrics()` clears the counters (used by tests, and useful for
before/after measurement windows).

## Before and after

Over an 8000ms budget for a transaction that never lands:

| Strategy | RPC calls per wait |
| --- | --- |
| Fixed 250ms interval | 33 |
| Backoff, 250ms → 2000ms | 8 |

A transaction that lands immediately costs exactly **1** call under either
strategy — the saving is entirely on slow and failed waits, which is where the
old approach spent the most. Both figures are asserted in
`backend/src/lib/pollMetrics.test.js` so the comparison cannot silently rot.
