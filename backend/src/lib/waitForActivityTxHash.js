import { recordPollSample } from './pollMetrics.js';

/**
 * Poll the activity feed with exponential backoff until a new entry with a
 * txHash appears, or the max wait budget is exhausted.
 *
 * If an `AbortSignal` is supplied via `options.signal`, the poll aborts as soon
 * as the signal fires — throwing an `Error` whose `name` is `'AbortError'` — so
 * a disconnected client no longer keeps the loop running for the full budget.
 *
 * Every wait records its cost (feed reads, sleeps, elapsed time, outcome) so the
 * RPC budget a wait spends is measurable rather than assumed (#852). Callers that
 * want the per-wait numbers can pass `options.onPollSample`; the aggregate is
 * available from `getPollMetrics()`.
 *
 * @param {() => Array<{ txHash?: string }>} getFeed
 * @param {number} activityCountBefore
 * @param {{ maxWaitMs: number, initialDelayMs: number, maxDelayMs: number, signal?: AbortSignal, onPollSample?: (sample: import('./pollMetrics.js').PollSample) => void }} options
 * @param {(entry: { txHash?: string }) => boolean} [matchesEntry]
 * @param {(ms: number) => Promise<void>} [sleep]
 * @returns {Promise<string>}
 */
export async function waitForActivityTxHash(
  getFeed,
  activityCountBefore,
  { maxWaitMs, initialDelayMs, maxDelayMs, signal, onPollSample },
  matchesEntry,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  let elapsedMs = 0;
  let currentDelay = initialDelayMs;

  const startedAt = Date.now();
  let polls = 0;
  let sleeps = 0;
  let totalDelayMs = 0;

  const finish = (outcome) => {
    const sample = recordPollSample({
      polls,
      sleeps,
      totalDelayMs,
      durationMs: Date.now() - startedAt,
      outcome,
    });
    onPollSample?.(sample);
  };

  const throwIfAborted = () => {
    if (signal?.aborted) {
      const e = new Error('The operation was aborted');
      e.name = 'AbortError';
      finish('aborted');
      throw e;
    }
  };

  while (true) {
    throwIfAborted();

    polls += 1;
    const feed = getFeed();
    const addedCount = Math.max(feed.length - activityCountBefore, 0);
    if (addedCount > 0) {
      const recentEntries = feed.slice(0, addedCount);
      const matched = recentEntries.find(
        (entry) => entry?.txHash && (!matchesEntry || matchesEntry(entry)),
      );
      if (matched) {
        finish('matched');
        return matched.txHash;
      }
    }

    if (elapsedMs >= maxWaitMs) {
      break;
    }

    const delay = Math.min(currentDelay, maxDelayMs, maxWaitMs - elapsedMs);
    if (delay <= 0) {
      break;
    }

    await sleep(delay);
    sleeps += 1;
    totalDelayMs += delay;
    throwIfAborted();
    elapsedMs += delay;
    currentDelay = Math.min(currentDelay * 2, maxDelayMs);
  }

  finish('timeout');
  return '';
}
