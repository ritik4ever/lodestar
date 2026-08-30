import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitForActivityTxHash } from './waitForActivityTxHash.js';
import { getPollMetrics, resetPollMetrics, recordPollSample } from './pollMetrics.js';

/**
 * Poll cost measurement (#852).
 *
 * The backoff and the total-time budget were already in place; what was missing
 * was any measurement of what a wait actually costs in RPC calls. These tests
 * pin the instrumentation, including the before/after comparison the issue asks
 * for: fixed-interval polling vs backoff over the same wait budget.
 */

function makeSleepRecorder() {
  const delays = [];
  const sleep = vi.fn(async (ms) => {
    delays.push(ms);
  });
  return { sleep, delays };
}

const defaultOptions = { maxWaitMs: 8000, initialDelayMs: 250, maxDelayMs: 2000 };

describe('poll metrics (#852)', () => {
  beforeEach(() => {
    resetPollMetrics();
  });

  describe('per-wait sample', () => {
    it('counts a single feed read when the hash is already present', async () => {
      const { sleep } = makeSleepRecorder();
      let sample = null;

      const result = await waitForActivityTxHash(
        () => [{ txHash: 'abc123' }],
        0,
        { ...defaultOptions, onPollSample: (s) => { sample = s; } },
        undefined,
        sleep,
      );

      expect(result).toBe('abc123');
      expect(sample).toMatchObject({ polls: 1, sleeps: 0, totalDelayMs: 0, outcome: 'matched' });
    });

    it('counts one feed read per poll and one sleep per gap', async () => {
      const { sleep } = makeSleepRecorder();
      let calls = 0;
      const getFeed = () => (++calls >= 3 ? [{ txHash: 'late' }] : []);
      let sample = null;

      const result = await waitForActivityTxHash(
        getFeed,
        0,
        { ...defaultOptions, onPollSample: (s) => { sample = s; } },
        undefined,
        sleep,
      );

      expect(result).toBe('late');
      expect(sample.polls).toBe(3);
      expect(sample.sleeps).toBe(2);
      // 250 + 500 under exponential backoff.
      expect(sample.totalDelayMs).toBe(750);
    });

    it('reports a timeout outcome when the budget is exhausted', async () => {
      const { sleep } = makeSleepRecorder();
      let sample = null;

      const result = await waitForActivityTxHash(
        () => [],
        0,
        { maxWaitMs: 1000, initialDelayMs: 250, maxDelayMs: 2000, onPollSample: (s) => { sample = s; } },
        undefined,
        sleep,
      );

      expect(result).toBe('');
      expect(sample.outcome).toBe('timeout');
      expect(sample.totalDelayMs).toBe(1000);
    });

    it('reports an aborted outcome and stops spending polls', async () => {
      const { sleep } = makeSleepRecorder();
      const controller = new AbortController();
      let sample = null;

      let calls = 0;
      const getFeed = () => {
        if (++calls === 2) controller.abort();
        return [];
      };

      await expect(
        waitForActivityTxHash(
          getFeed,
          0,
          { ...defaultOptions, signal: controller.signal, onPollSample: (s) => { sample = s; } },
          undefined,
          sleep,
        ),
      ).rejects.toThrow(/aborted/i);

      expect(sample.outcome).toBe('aborted');
      // An abandoned client stops costing RPC calls almost immediately.
      expect(sample.polls).toBeLessThanOrEqual(2);
    });
  });

  describe('aggregate metrics', () => {
    it('accumulates across waits', async () => {
      const { sleep } = makeSleepRecorder();

      await waitForActivityTxHash(() => [{ txHash: 'a' }], 0, defaultOptions, undefined, sleep);
      await waitForActivityTxHash(() => [{ txHash: 'b' }], 0, defaultOptions, undefined, sleep);

      const metrics = getPollMetrics();
      expect(metrics.waits).toBe(2);
      expect(metrics.polls).toBe(2);
      expect(metrics.byOutcome.matched).toBe(2);
      expect(metrics.avgPollsPerWait).toBe(1);
    });

    it('tracks the worst-case wait', async () => {
      const { sleep } = makeSleepRecorder();

      await waitForActivityTxHash(() => [{ txHash: 'a' }], 0, defaultOptions, undefined, sleep);
      await waitForActivityTxHash(
        () => [],
        0,
        { maxWaitMs: 4000, initialDelayMs: 250, maxDelayMs: 2000 },
        undefined,
        sleep,
      );

      const metrics = getPollMetrics();
      expect(metrics.maxPolls).toBeGreaterThan(1);
      expect(metrics.byOutcome.timeout).toBe(1);
    });

    it('separates outcomes', () => {
      recordPollSample({ polls: 3, sleeps: 2, totalDelayMs: 750, durationMs: 800, outcome: 'matched' });
      recordPollSample({ polls: 9, sleeps: 8, totalDelayMs: 8000, durationMs: 8100, outcome: 'timeout' });
      recordPollSample({ polls: 1, sleeps: 0, totalDelayMs: 0, durationMs: 5, outcome: 'aborted' });

      const metrics = getPollMetrics();
      expect(metrics.byOutcome).toEqual({ matched: 1, timeout: 1, aborted: 1 });
      expect(metrics.polls).toBe(13);
      expect(metrics.avgPollsPerWait).toBeCloseTo(4.33, 2);
    });

    it('resets cleanly', () => {
      recordPollSample({ polls: 5, sleeps: 4, totalDelayMs: 100, durationMs: 120, outcome: 'matched' });
      resetPollMetrics();

      expect(getPollMetrics()).toMatchObject({ waits: 0, polls: 0, avgPollsPerWait: 0, maxPolls: 0 });
    });
  });

  describe('before/after: fixed interval vs backoff', () => {
    /** The previous strategy: poll every `intervalMs` until the budget runs out. */
    async function fixedIntervalPollCount({ maxWaitMs, intervalMs }) {
      let elapsed = 0;
      let polls = 0;
      while (true) {
        polls += 1;
        if (elapsed >= maxWaitMs) return polls;
        elapsed += intervalMs;
      }
    }

    it('spends far fewer RPC calls on a wait that never lands', async () => {
      const maxWaitMs = 8000;
      const { sleep } = makeSleepRecorder();

      const before = await fixedIntervalPollCount({ maxWaitMs, intervalMs: 250 });

      resetPollMetrics();
      await waitForActivityTxHash(
        () => [],
        0,
        { maxWaitMs, initialDelayMs: 250, maxDelayMs: 2000 },
        undefined,
        sleep,
      );
      const after = getPollMetrics().polls;

      // 33 polls at a fixed 250ms interval vs 8 under backoff over the same budget.
      expect(before).toBe(33);
      expect(after).toBe(8);
      expect(after).toBeLessThan(before / 4);
    });

    it('costs the same single call when the transaction lands immediately', async () => {
      const { sleep } = makeSleepRecorder();
      resetPollMetrics();

      await waitForActivityTxHash(() => [{ txHash: 'fast' }], 0, defaultOptions, undefined, sleep);

      expect(getPollMetrics().polls).toBe(1);
    });

    it('keeps the total wait inside the configured budget', async () => {
      const { sleep, delays } = makeSleepRecorder();
      const maxWaitMs = 5000;

      await waitForActivityTxHash(
        () => [],
        0,
        { maxWaitMs, initialDelayMs: 250, maxDelayMs: 2000 },
        undefined,
        sleep,
      );

      const totalSlept = delays.reduce((sum, d) => sum + d, 0);
      expect(totalSlept).toBe(maxWaitMs);
      expect(getPollMetrics().totalDelayMs).toBe(maxWaitMs);
    });
  });
});
