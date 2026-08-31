# Reputation History Retention

`backend/src/lib/reputationHistory.js` records every reputation change per
service. Without a policy that store grows linearly with activity and never
shrinks, so it now has a defined retention window and compaction (#857).

## Guaranteed resolution

| Age of data | Resolution | Retained |
| --- | --- | --- |
| 0 – 7 days | **Every event**, exactly as recorded | yes |
| 7 – 90 days | **One aggregate per day**, carrying the day's net delta and closing value | yes |
| Over 90 days | — | dropped |

Constants live next to the implementation: `RAW_WINDOW_MS` (7 days),
`COMPACTION_BUCKET_MS` (1 day), `RETENTION_WINDOW_MS` (90 days).

These are the numbers the chart actually needs: recent activity is inspected
event by event, while older activity is only ever read as a trend line.

## Aggregate shape

A compacted point is marked, so a consumer can never mistake an aggregate for a
single event:

```jsonc
{
  "timestamp": 1756339200000,  // start of the day bucket, aligned to COMPACTION_BUCKET_MS
  "delta": 10,                 // net change across the bucket
  "newValue": 130,             // value at the end of the bucket
  "compacted": true,
  "eventCount": 3              // events folded into this point
}
```

Raw points have neither `compacted` nor `eventCount`.

## Bounds

- **Per service:** `MAX_POINTS_PER_SERVICE` (500) is a hard ceiling, applied even
  inside the raw window. It is a backstop against pathological churn; the oldest
  points are dropped first.
- **Whole store:** bounded by services × 500 points. A service whose history ages
  out entirely is removed from the map by the sweep.

## When it runs

Retention is applied **on write**, so the store cannot grow unbounded between
reads. `compactAllReputationHistory()` sweeps every service, which also ages out
histories for services that have gone quiet and would otherwise never be
revisited. `getReputationHistorySize()` reports total retained points for
metrics.

## Consequences to know about

- Compaction is **lossy by design**: individual events older than 7 days cannot
  be recovered. If per-event history beyond a week is ever needed, it must come
  from indexed on-chain events, not this store.
- The store is **in-memory** and does not survive a restart. Retention bounds
  growth within a process lifetime; durability is a separate concern.
- Bucket timestamps are aligned to the compaction interval, so a compacted
  point's timestamp is the start of its day, not the time of any real event.
