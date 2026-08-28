/**
 * Poll the activity feed with exponential backoff until a new entry with a
 * txHash appears, or the max wait budget is exhausted.
 *
 * If an `AbortSignal` is supplied via `options.signal`, the poll aborts as soon
 * as the signal fires — throwing an `Error` whose `name` is `'AbortError'` — so
 * a disconnected client no longer keeps the loop running for the full budget.
 *
 * @param {() => Array<{ txHash?: string }>} getFeed
 * @param {number} activityCountBefore
 * @param {{ maxWaitMs: number, initialDelayMs: number, maxDelayMs: number, signal?: AbortSignal }} options
 * @param {(entry: { txHash?: string }) => boolean} [matchesEntry]
 * @param {(ms: number) => Promise<void>} [sleep]
 * @returns {Promise<string>}
 */
export async function waitForActivityTxHash(
  getFeed,
  activityCountBefore,
  { maxWaitMs, initialDelayMs, maxDelayMs, signal },
  matchesEntry,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  let elapsedMs = 0;
  let currentDelay = initialDelayMs;

  const throwIfAborted = () => {
    if (signal?.aborted) {
      const e = new Error('The operation was aborted');
      e.name = 'AbortError';
      throw e;
    }
  };

  while (true) {
    throwIfAborted();

    const feed = getFeed();
    const addedCount = Math.max(feed.length - activityCountBefore, 0);
    if (addedCount > 0) {
      const recentEntries = feed.slice(0, addedCount);
      const matched = recentEntries.find(
        (entry) => entry?.txHash && (!matchesEntry || matchesEntry(entry)),
      );
      if (matched) return matched.txHash;
    }

    if (elapsedMs >= maxWaitMs) {
      break;
    }

    const delay = Math.min(currentDelay, maxDelayMs, maxWaitMs - elapsedMs);
    if (delay <= 0) {
      break;
    }

    await sleep(delay);
    throwIfAborted();
    elapsedMs += delay;
    currentDelay = Math.min(currentDelay * 2, maxDelayMs);
  }

  return '';
}
