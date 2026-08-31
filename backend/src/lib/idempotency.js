/**
 * In-memory idempotency store for the payment route.
 *
 * Keys expire after TTL_MS (default 24 h). Expired entries are pruned by a
 * background timer so that every lookup stays O(1). A lazy per-key expiry
 * check on read catches any stragglers between timer ticks.
 *
 * Lifecycle of a key:
 *   'pending'  — request is in-flight; a concurrent retry gets 409
 *   'complete' — request finished; replays cached response with 200
 *   'failed'   — request threw; replays the error response
 */

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PURGE_INTERVAL_MS = 60_000; // sweep every 60 s

/**
 * @type {Map<string, {
 *   status: 'pending' | 'complete' | 'failed',
 *   result: { newScore?: number, error?: string, code?: string, httpStatus?: number } | null,
 *   expiresAt: number
 * }>}
 */
const store = new Map();

/** @type {ReturnType<typeof setInterval> | null} */
let purgeTimer = null;

/**
 * Remove entries whose TTL has passed.
 * Runs on a background timer so lookups stay O(1).
 */
function purgeExpired() {
  const now = Date.now();
  for (const [k, entry] of store) {
    if (entry.expiresAt <= now) {
      store.delete(k);
    }
  }
}

function startPurgeTimer() {
  if (purgeTimer !== null) return;
  purgeTimer = setInterval(purgeExpired, PURGE_INTERVAL_MS);
  purgeTimer.unref();
}

function stopPurgeTimer() {
  if (purgeTimer !== null) {
    clearInterval(purgeTimer);
    purgeTimer = null;
  }
}

startPurgeTimer();

/**
 * Validate that `key` is a non-empty string of at most 255 characters
 * containing only safe printable ASCII (printable minus control chars).
 * This mirrors the convention used by Stripe and most payment APIs.
 *
 * @param {string} key
 * @returns {boolean}
 */
export function isValidIdempotencyKey(key) {
  return (
    typeof key === 'string' &&
    key.length >= 1 &&
    key.length <= 255 &&
    /^[\x21-\x7E]+$/.test(key) // printable ASCII, no spaces/control chars
  );
}

/**
 * Look up an existing entry for `key`.
 * Returns the entry if it exists and has not expired, otherwise `null`.
 * Lazy per-key expiry handles correctness between timer ticks.
 *
 * @param {string} key
 * @returns {{ status: string, result: object | null } | null}
 */
export function getEntry(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return entry;
}

/**
 * Reserve `key` as pending (in-flight).
 * Must only be called after confirming no live entry exists.
 *
 * @param {string} key
 */
export function markPending(key) {
  store.set(key, {
    status: 'pending',
    result: null,
    expiresAt: Date.now() + TTL_MS,
  });
}

/**
 * Resolve a pending key with a successful result.
 *
 * @param {string} key
 * @param {{ newScore: number }} result
 */
export function markComplete(key, result) {
  const entry = store.get(key);
  if (entry) {
    entry.status = 'complete';
    entry.result = result;
  }
}

/**
 * Resolve a pending key with a failure result so retries get the same error.
 *
 * @param {string} key
 * @param {{ httpStatus: number, error: string, code: string }} result
 */
export function markFailed(key, result) {
  const entry = store.get(key);
  if (entry) {
    entry.status = 'failed';
    entry.result = result;
  }
}

/** Exposed for testing only — resets internal state and timer. */
export function _reset() {
  stopPurgeTimer();
  store.clear();
}

/** Exposed for testing only — restarts the purge timer. */
export function _startTimer() {
  startPurgeTimer();
}

/** Exposed for testing only — manually trigger an immediate purge. */
export function _purgeNow() {
  purgeExpired();
}

/** Exposed for testing only — current store size. */
export function _size() {
  return store.size;
}
