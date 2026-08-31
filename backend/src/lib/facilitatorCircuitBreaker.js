/**
 * Circuit Breaker for HTTPFacilitatorClient calls.
 *
 * A simple state machine (closed, open, half-open) that prevents the backend
 * from stalling when the facilitator service is slow or unavailable.
 *
 * State transitions:
 *  - CLOSED → OPEN: after CONSECUTIVE_FAILURES_THRESHOLD consecutive failures
 *  - OPEN → HALF_OPEN: after RESET_TIMEOUT_MS (allowing a probe request)
 *  - HALF_OPEN → CLOSED: on successful probe
 *  - HALF_OPEN → OPEN: on failed probe (re-enter open state)
 *
 * While in OPEN state, requests return 503 FACILITATOR_UNAVAILABLE immediately
 * without attempting the facilitator call.
 */

import logger from './logger.js';

// Circuit states
const STATE_CLOSED = 'closed';
const STATE_OPEN = 'open';
const STATE_HALF_OPEN = 'half-open';

// Configuration constants
const CONSECUTIVE_FAILURES_THRESHOLD = 5;
const RESET_TIMEOUT_MS = 30_000; // 30 seconds before attempting a probe

// Module-scope circuit state (persists across requests)
let circuitState = STATE_CLOSED;
let consecutiveFailures = 0;
let lastFailureTime = null;
let halfOpenProbeInflight = false;

// Statistics for health monitoring
const stats = {
  totalCalls: 0,
  successfulCalls: 0,
  failedCalls: 0,
  circuitOpenedAt: null,
  lastSuccessAt: null,
  lastFailureAt: null,
};

/**
 * Reset circuit breaker to initial closed state.
 * Exported for testing purposes only.
 */
export function __resetCircuitBreaker() {
  circuitState = STATE_CLOSED;
  consecutiveFailures = 0;
  lastFailureTime = null;
  halfOpenProbeInflight = false;
  stats.totalCalls = 0;
  stats.successfulCalls = 0;
  stats.failedCalls = 0;
  stats.circuitOpenedAt = null;
  stats.lastSuccessAt = null;
  stats.lastFailureAt = null;
}

/**
 * Get current circuit breaker state and statistics.
 * @returns {object} Current state info
 */
export function getCircuitBreakerState() {
  let timeUntilRetry = null;
  if (circuitState === STATE_OPEN && lastFailureTime) {
    timeUntilRetry = Math.max(0, RESET_TIMEOUT_MS - (Date.now() - lastFailureTime));
  }

  return {
    state: circuitState,
    consecutiveFailures,
    threshold: CONSECUTIVE_FAILURES_THRESHOLD,
    totalCalls: stats.totalCalls,
    successfulCalls: stats.successfulCalls,
    failedCalls: stats.failedCalls,
    lastSuccessAt: stats.lastSuccessAt,
    lastFailureAt: stats.lastFailureAt,
    circuitOpenedAt: stats.circuitOpenedAt,
    timeUntilRetry,
  };
}

/**
 * Check if the circuit allows a facilitator call.
 * @returns {boolean} true if the call should proceed, false if circuit is open
 */
export function isCircuitClosed() {
  if (circuitState === STATE_CLOSED) {
    return true;
  }

  if (circuitState === STATE_OPEN) {
    // Check if reset timeout has elapsed - transition to half-open
    if (lastFailureTime && (Date.now() - lastFailureTime) >= RESET_TIMEOUT_MS) {
      logger.info(
        { consecutiveFailures, timeSinceLastFailure: Date.now() - lastFailureTime },
        'Circuit breaker transitioning from OPEN to HALF_OPEN (reset timeout elapsed)',
      );
      circuitState = STATE_HALF_OPEN;
      return true;
    }
    return false;
  }

  if (circuitState === STATE_HALF_OPEN) {
    // Allow one probe request if none is inflight
    return !halfOpenProbeInflight;
  }

  return true;
}

/**
 * Record a successful facilitator call.
 * @param {number} latencyMs - The latency of the successful call
 */
export function recordSuccess(latencyMs) {
  stats.totalCalls++;
  stats.successfulCalls++;
  stats.lastSuccessAt = new Date().toISOString();

  if (circuitState === STATE_HALF_OPEN) {
    // Successful probe - close the circuit
    logger.info(
      { latencyMs, consecutiveFailures: 0 },
      'Circuit breaker CLOSED after successful half-open probe',
    );
    circuitState = STATE_CLOSED;
    consecutiveFailures = 0;
    halfOpenProbeInflight = false;
  } else if (circuitState === STATE_CLOSED) {
    // Reset failure counter on success
    consecutiveFailures = 0;
  }

  // Log latency at debug level
  logger.debug(
    { latencyMs, consecutiveFailures, state: circuitState },
    'Facilitator call succeeded',
  );

  // Warn if latency exceeds 3 seconds
  if (latencyMs > 3000) {
    logger.warn(
      { latencyMs, threshold: 3000 },
      'Facilitator call latency exceeded 3 seconds',
    );
  }
}

/**
 * Record a failed facilitator call (timeout or error).
 * @param {Error} error - The error that caused the failure
 * @param {number} latencyMs - The latency of the failed call (may be 0 for timeout)
 */
export function recordFailure(error, latencyMs = 0) {
  stats.totalCalls++;
  stats.failedCalls++;
  stats.lastFailureAt = new Date().toISOString();
  consecutiveFailures++;
  lastFailureTime = Date.now();

  const errorType = error?.code === 'ETIMEDOUT' || error?.message?.includes('timeout')
    ? 'timeout'
    : 'error';

  if (circuitState === STATE_HALF_OPEN) {
    // Failed probe - re-open the circuit
    halfOpenProbeInflight = false;
    logger.warn(
      { error: error?.message, errorType, consecutiveFailures, state: circuitState },
      'Circuit breaker re-OPENED after failed half-open probe',
    );
    circuitState = STATE_OPEN;
  } else if (circuitState === STATE_CLOSED && consecutiveFailures >= CONSECUTIVE_FAILURES_THRESHOLD) {
    // Open the circuit after threshold reached
    stats.circuitOpenedAt = new Date().toISOString();
    logger.warn(
      {
        consecutiveFailures,
        threshold: CONSECUTIVE_FAILURES_THRESHOLD,
        error: error?.message,
        errorType,
      },
      'Circuit breaker OPENED - consecutive facilitator failures exceeded threshold',
    );
    circuitState = STATE_OPEN;
  }

  // Log failure at debug level
  logger.debug(
    {
      latencyMs,
      error: error?.message,
      errorType,
      consecutiveFailures,
      threshold: CONSECUTIVE_FAILURES_THRESHOLD,
      state: circuitState,
    },
    'Facilitator call failed',
  );
}

/**
 * Mark that a half-open probe request is in flight.
 * Prevents multiple concurrent probe attempts.
 */
export function markHalfOpenProbeInFlight() {
  halfOpenProbeInflight = true;
}

/**
 * Execute a facilitator call with circuit breaker protection.
 * @param {Function} facilitatorCall - Async function that makes the facilitator call
 * @returns {Promise<any>} The result of the facilitator call
 * @throws {Error} Throws FACILITATOR_UNAVAILABLE error if circuit is open
 */
export async function executeWithCircuitBreaker(facilitatorCall) {
  if (!isCircuitClosed()) {
    const state = getCircuitBreakerState();
    const error = new Error('FACILITATOR_UNAVAILABLE');
    error.code = 'FACILITATOR_UNAVAILABLE';
    error.statusCode = 503;
    error.state = state;
    throw error;
  }

  // Mark half-open probe if applicable
  if (circuitState === STATE_HALF_OPEN) {
    markHalfOpenProbeInFlight();
  }

  return await facilitatorCall();
}
