import config from '../config.js';

// Reputation history — in-memory store.
// Kept dependency-free so it's unit-testable.
//
// ── Retention and compaction (#857) ──────────────────────────────────────────
//
// History previously grew without bound: every reputation change was kept
// forever, for every service, so storage grew linearly with activity and never
// shrank. The chart that consumes this only needs recent detail — older points
// are useful as a trend, not as individual events.
//
// The policy has three tiers, applied newest-first:
//
//   1. RAW      — every event is kept for RAW_WINDOW_MS.
//   2. COMPACT  — beyond that, events are folded into one bucket per
//                 COMPACTION_BUCKET_MS, keeping the net delta and the closing
//                 value of each bucket.
//   3. DROP     — beyond RETENTION_WINDOW_MS, points are discarded.
//
// A per-service hard cap (MAX_POINTS_PER_SERVICE) bounds memory even for a
// service that somehow produces enormous churn inside the raw window.

const reputationHistory = new Map();

/** Events newer than this keep full per-event resolution. */
export const RAW_WINDOW_MS = config.reputationHistory.rawWindowMs;

/** Older events are aggregated into buckets of this size. */
export const COMPACTION_BUCKET_MS = config.reputationHistory.compactionBucketMs;

/** Nothing older than this is retained at any resolution. */
export const RETENTION_WINDOW_MS = config.reputationHistory.retentionWindowMs;

/** Absolute per-service ceiling, a backstop against pathological churn. */
export const MAX_POINTS_PER_SERVICE = config.reputationHistory.maxPointsPerService;

/**
 * Record a reputation change for a service.
 *
 * Retention is applied on write so the store cannot grow unbounded between
 * reads; a service that stops receiving votes simply stops being compacted,
 * which is harmless because its history is already bounded.
 *
 * @param {number} serviceId - The ID of the service whose reputation changed
 * @param {number} timestamp - Unix timestamp (ms) of when the change occurred
 * @param {number} delta - The change in reputation (positive or negative integer)
 * @param {number} newValue - The new reputation value after the change
 */
export function recordReputationChange(serviceId, timestamp, delta, newValue) {
  if (!reputationHistory.has(serviceId)) {
    reputationHistory.set(serviceId, []);
  }
  const history = reputationHistory.get(serviceId);
  history.unshift({
    timestamp,
    delta,
    newValue,
  });

  reputationHistory.set(serviceId, applyRetention(history, timestamp));
}

/**
 * Get the reputation history for a service.
 *
 * Points older than RAW_WINDOW_MS are daily aggregates and carry
 * `compacted: true` plus the `eventCount` they represent, so a consumer can
 * tell an aggregate from a single event rather than assuming uniform meaning.
 *
 * @param {number} serviceId - The ID of the service to retrieve history for
 * @returns {Array<Object>} Array of reputation change events, sorted with newest first
 */
export function getReputationHistory(serviceId) {
  return reputationHistory.get(serviceId) || [];
}

/**
 * Apply the retention policy to one service's points (newest first).
 * Exported for tests and for a maintenance sweep.
 *
 * @param {Array<Object>} points - newest-first points
 * @param {number} now - reference timestamp in ms
 */
export function applyRetention(points, now = Date.now()) {
  const rawCutoff = now - RAW_WINDOW_MS;
  const retentionCutoff = now - RETENTION_WINDOW_MS;

  const raw = [];
  const olderBuckets = new Map();

  for (const point of points) {
    if (point.timestamp < retentionCutoff) continue;

    if (point.timestamp >= rawCutoff) {
      raw.push(point);
      continue;
    }

    const bucketStart = Math.floor(point.timestamp / COMPACTION_BUCKET_MS) * COMPACTION_BUCKET_MS;
    const existing = olderBuckets.get(bucketStart);

    if (!existing) {
      olderBuckets.set(bucketStart, {
        timestamp: bucketStart,
        delta: point.delta,
        // Points arrive newest-first, so the first one seen in a bucket is the
        // latest in that bucket — its value closes the bucket.
        newValue: point.newValue,
        compacted: true,
        eventCount: (point.eventCount ?? 1),
      });
      continue;
    }

    existing.delta += point.delta;
    existing.eventCount += point.eventCount ?? 1;
  }

  const compacted = [...olderBuckets.values()].sort((a, b) => b.timestamp - a.timestamp);
  const merged = [...raw, ...compacted];

  // Hard cap: drop the oldest points first, which are the least useful.
  return merged.length > MAX_POINTS_PER_SERVICE
    ? merged.slice(0, MAX_POINTS_PER_SERVICE)
    : merged;
}

/**
 * Run retention across every service. Useful as a periodic sweep so histories
 * for services that have gone quiet still age out.
 *
 * @returns {{ services: number, pointsBefore: number, pointsAfter: number }}
 */
export function compactAllReputationHistory(now = Date.now()) {
  let pointsBefore = 0;
  let pointsAfter = 0;

  for (const [serviceId, points] of reputationHistory) {
    pointsBefore += points.length;
    const retained = applyRetention(points, now);
    pointsAfter += retained.length;

    if (retained.length === 0) {
      reputationHistory.delete(serviceId);
    } else {
      reputationHistory.set(serviceId, retained);
    }
  }

  return { services: reputationHistory.size, pointsBefore, pointsAfter };
}

/** Total retained points across all services — for metrics and tests. */
export function getReputationHistorySize() {
  let total = 0;
  for (const points of reputationHistory.values()) total += points.length;
  return total;
}

/** Clear all in-memory reputation history (for tests). */
export function clearReputationHistory() {
  reputationHistory.clear();
}
