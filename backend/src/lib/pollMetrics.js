/**
 * Poll cost instrumentation (#852).
 *
 * `waitForActivityTxHash` already backs off with a total-time budget, but the cost
 * of a wait was invisible: nothing recorded how many feed reads (and therefore how
 * many RPC calls) a single wait actually spends. Without that number, a change to
 * the backoff parameters cannot be shown to have helped.
 *
 * Every wait records one sample here. The aggregate is exposed for logging and for
 * before/after comparison; the per-wait record is returned to the caller so it can
 * be logged alongside the request that paid for it.
 */

/** @typedef {'matched' | 'timeout' | 'aborted'} PollOutcome */

/**
 * @typedef {object} PollSample
 * @property {number} polls        Feed reads performed — one RPC call each
 * @property {number} sleeps       Backoff sleeps between polls
 * @property {number} totalDelayMs Time spent sleeping
 * @property {number} durationMs   Wall-clock duration of the wait
 * @property {PollOutcome} outcome How the wait ended
 */

const EMPTY = () => ({
  waits: 0,
  polls: 0,
  sleeps: 0,
  totalDelayMs: 0,
  totalDurationMs: 0,
  maxPolls: 0,
  byOutcome: { matched: 0, timeout: 0, aborted: 0 },
});

let totals = EMPTY();

/** Record one completed wait. */
export function recordPollSample(sample) {
  totals.waits += 1;
  totals.polls += sample.polls;
  totals.sleeps += sample.sleeps;
  totals.totalDelayMs += sample.totalDelayMs;
  totals.totalDurationMs += sample.durationMs;
  totals.maxPolls = Math.max(totals.maxPolls, sample.polls);
  if (totals.byOutcome[sample.outcome] !== undefined) {
    totals.byOutcome[sample.outcome] += 1;
  }
  return sample;
}

/**
 * Aggregate poll cost since the last reset.
 * `avgPollsPerWait` is the headline number for #852: it is what a change to the
 * backoff parameters is supposed to move.
 */
export function getPollMetrics() {
  const { waits } = totals;
  return {
    ...totals,
    byOutcome: { ...totals.byOutcome },
    avgPollsPerWait: waits > 0 ? round(totals.polls / waits) : 0,
    avgDurationMs: waits > 0 ? Math.round(totals.totalDurationMs / waits) : 0,
  };
}

export function resetPollMetrics() {
  totals = EMPTY();
}

function round(value) {
  return Math.round(value * 100) / 100;
}
