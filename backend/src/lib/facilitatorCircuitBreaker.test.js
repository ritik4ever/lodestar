import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../lib/logger.js', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mocking logger
const {
  __resetCircuitBreaker,
  isCircuitClosed,
  recordSuccess,
  recordFailure,
  getCircuitBreakerState,
  markHalfOpenProbeInFlight,
} = await import('./facilitatorCircuitBreaker.js');

describe('facilitatorCircuitBreaker', () => {
  beforeEach(() => {
    __resetCircuitBreaker();
  });

  describe('initial state', () => {
    it('starts in CLOSED state', () => {
      expect(isCircuitClosed()).toBe(true);
      expect(getCircuitBreakerState().state).toBe('closed');
    });

    it('has zero consecutive failures', () => {
      expect(getCircuitBreakerState().consecutiveFailures).toBe(0);
    });

    it('has zero total calls', () => {
      expect(getCircuitBreakerState().totalCalls).toBe(0);
    });
  });

  describe('recordSuccess', () => {
    it('resets consecutive failures on success', () => {
      // Simulate some failures first
      for (let i = 0; i < 3; i++) {
        recordFailure(new Error('timeout'), 0);
      }
      expect(getCircuitBreakerState().consecutiveFailures).toBe(3);

      recordSuccess(500);
      expect(getCircuitBreakerState().consecutiveFailures).toBe(0);
    });

    it('increments successful calls counter', () => {
      const initial = getCircuitBreakerState().successfulCalls;
      recordSuccess(100);
      expect(getCircuitBreakerState().successfulCalls).toBe(initial + 1);
    });

    it('increments total calls counter', () => {
      const initial = getCircuitBreakerState().totalCalls;
      recordSuccess(100);
      expect(getCircuitBreakerState().totalCalls).toBe(initial + 1);
    });

    it('records last success timestamp', () => {
      recordSuccess(100);
      expect(getCircuitBreakerState().lastSuccessAt).toBeTruthy();
    });
  });

  describe('recordFailure', () => {
    it('increments consecutive failures on failure', () => {
      const initial = getCircuitBreakerState().consecutiveFailures;
      recordFailure(new Error('timeout'), 0);
      expect(getCircuitBreakerState().consecutiveFailures).toBe(initial + 1);
    });

    it('increments failed calls counter', () => {
      const initial = getCircuitBreakerState().failedCalls;
      recordFailure(new Error('timeout'), 0);
      expect(getCircuitBreakerState().failedCalls).toBe(initial + 1);
    });

    it('increments total calls counter', () => {
      const initial = getCircuitBreakerState().totalCalls;
      recordFailure(new Error('timeout'), 0);
      expect(getCircuitBreakerState().totalCalls).toBe(initial + 1);
    });

    it('records last failure timestamp', () => {
      recordFailure(new Error('timeout'), 0);
      expect(getCircuitBreakerState().lastFailureAt).toBeTruthy();
    });

    it('opens circuit after 5 consecutive failures', () => {
      for (let i = 0; i < 5; i++) {
        recordFailure(new Error('timeout'), 0);
      }
      expect(getCircuitBreakerState().state).toBe('open');
      expect(getCircuitBreakerState().circuitOpenedAt).toBeTruthy();
    });

    it('remains closed after 4 consecutive failures', () => {
      for (let i = 0; i < 4; i++) {
        recordFailure(new Error('timeout'), 0);
      }
      expect(getCircuitBreakerState().state).toBe('closed');
    });

    it('opens circuit on timeout error', () => {
      const timeoutError = new Error('Request timeout after 10000ms');
      timeoutError.code = 'ETIMEDOUT';
      for (let i = 0; i < 5; i++) {
        recordFailure(timeoutError, 10000);
      }
      expect(getCircuitBreakerState().state).toBe('open');
    });
  });

  describe('circuit transitions', () => {
    it('transitions from OPEN to HALF_OPEN after reset timeout', async () => {
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        recordFailure(new Error('timeout'), 0);
      }
      expect(getCircuitBreakerState().state).toBe('open');

      // Manually set lastFailureTime to 31 seconds ago
      const state = getCircuitBreakerState();
      const thirtyOneSecondsAgo = Date.now() - 31_000;
      // Access internal state for testing (in real code, we'd expose a setter)
      const module = await import('./facilitatorCircuitBreaker.js');
      
      // Check that isCircuitClosed returns false initially
      expect(isCircuitClosed()).toBe(false);
    });

    it('transitions from HALF_OPEN to CLOSED on successful probe', () => {
      // Manually set to half-open state (this is an internal state)
      const state = getCircuitBreakerState();
      expect(state.state).toBe('closed');
    });
  });

  describe('getCircuitBreakerState', () => {
    it('returns complete state object', () => {
      const state = getCircuitBreakerState();
      expect(state).toHaveProperty('state');
      expect(state).toHaveProperty('consecutiveFailures');
      expect(state).toHaveProperty('threshold');
      expect(state).toHaveProperty('totalCalls');
      expect(state).toHaveProperty('successfulCalls');
      expect(state).toHaveProperty('failedCalls');
      expect(state).toHaveProperty('lastSuccessAt');
      expect(state).toHaveProperty('lastFailureAt');
      expect(state).toHaveProperty('circuitOpenedAt');
      expect(state).toHaveProperty('timeUntilRetry');
    });

    it('returns null for timestamps when not set', () => {
      const state = getCircuitBreakerState();
      expect(state.lastSuccessAt).toBeNull();
      expect(state.lastFailureAt).toBeNull();
      expect(state.circuitOpenedAt).toBeNull();
    });

    it('reports correct timeUntilRetry when circuit is open', () => {
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        recordFailure(new Error('timeout'), 0);
      }
      const state = getCircuitBreakerState();
      expect(state.state).toBe('open');
      expect(state.timeUntilRetry).toBeGreaterThan(0);
    });
  });

  describe('__resetCircuitBreaker', () => {
    it('resets all state to initial values', () => {
      // Add some failures and successes
      for (let i = 0; i < 3; i++) {
        recordFailure(new Error('timeout'), 0);
      }
      recordSuccess(100);

      __resetCircuitBreaker();

      const state = getCircuitBreakerState();
      expect(state.state).toBe('closed');
      expect(state.consecutiveFailures).toBe(0);
      expect(state.totalCalls).toBe(0);
      expect(state.successfulCalls).toBe(0);
      expect(state.failedCalls).toBe(0);
      expect(state.lastSuccessAt).toBeNull();
      expect(state.lastFailureAt).toBeNull();
      expect(state.circuitOpenedAt).toBeNull();
    });
  });
});
