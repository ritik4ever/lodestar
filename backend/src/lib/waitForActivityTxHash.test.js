import { describe, it, expect, vi } from 'vitest';
import { waitForActivityTxHash } from './waitForActivityTxHash.js';

function makeSleepRecorder() {
  const delays = [];
  const sleep = vi.fn(async (ms) => {
    delays.push(ms);
  });
  return { sleep, delays };
}

const defaultOptions = { maxWaitMs: 8000, initialDelayMs: 250, maxDelayMs: 2000 };

describe('waitForActivityTxHash', () => {
  it('returns immediately when the feed already contains a new txHash', async () => {
    const { sleep, delays } = makeSleepRecorder();
    const getFeed = vi.fn(() => [
      { txHash: 'abc123' },
      { txHash: 'old' },
    ]);

    const result = await waitForActivityTxHash(
      getFeed,
      1,
      defaultOptions,
      undefined,
      sleep,
    );

    expect(result).toBe('abc123');
    expect(getFeed).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('uses exponential delays when the txHash appears after multiple checks', async () => {
    const { sleep, delays } = makeSleepRecorder();
    const feeds = [
      [{ txHash: 'old' }],
      [{ txHash: 'old' }],
      [{ txHash: 'newhash', service: 'weather' }, { txHash: 'old' }],
    ];
    const getFeed = vi.fn(() => feeds.shift() ?? feeds[feeds.length - 1]);

    const result = await waitForActivityTxHash(
      getFeed,
      1,
      defaultOptions,
      undefined,
      sleep,
    );

    expect(result).toBe('newhash');
    expect(getFeed).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([250, 500]);
  });

  it('caps delay at pollMaxDelayMs', async () => {
    const { sleep, delays } = makeSleepRecorder();
    let call = 0;
    const getFeed = vi.fn(() => {
      call += 1;
      if (call < 4) {
        return [{ txHash: 'old' }];
      }
      return [{ txHash: 'capped' }, { txHash: 'old' }];
    });

    const result = await waitForActivityTxHash(
      getFeed,
      1,
      { maxWaitMs: 10_000, initialDelayMs: 1000, maxDelayMs: 1500 },
      undefined,
      sleep,
    );

    expect(result).toBe('capped');
    expect(delays).toEqual([1000, 1500, 1500]);
    expect(delays.every((d) => d <= 1500)).toBe(true);
  });

  it('returns an empty string when maxWaitMs is reached without a txHash', async () => {
    const { sleep, delays } = makeSleepRecorder();
    const getFeed = vi.fn(() => [{ txHash: '' }]);

    const result = await waitForActivityTxHash(
      getFeed,
      5,
      { maxWaitMs: 1000, initialDelayMs: 250, maxDelayMs: 500 },
      undefined,
      sleep,
    );

    expect(result).toBe('');
    const totalSlept = delays.reduce((sum, d) => sum + d, 0);
    expect(totalSlept).toBeLessThanOrEqual(1000);
    expect(delays.length).toBeGreaterThan(0);
  });

  it('rejects with an AbortError and never polls when the signal is already aborted', async () => {
    const { sleep, delays } = makeSleepRecorder();
    const getFeed = vi.fn(() => [{ txHash: 'abc123' }]);
    const controller = new AbortController();
    controller.abort();

    await expect(
      waitForActivityTxHash(
        getFeed,
        0,
        { ...defaultOptions, signal: controller.signal },
        undefined,
        sleep,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });

    // Aborted before the initial feed read → no feed poll, no sleeping.
    expect(getFeed).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
    expect(delays).toEqual([]);
  });

  it('aborts mid-poll and stops early instead of sleeping to the full budget', async () => {
    const controller = new AbortController();
    const delays = [];
    // Abort after the first sleep so the loop cannot exhaust maxWaitMs.
    const sleep = vi.fn(async (ms) => {
      delays.push(ms);
      controller.abort();
    });
    // Feed never contains a txHash, so absent an abort the loop would keep
    // polling until maxWaitMs is reached.
    const getFeed = vi.fn(() => [{ txHash: '' }]);

    await expect(
      waitForActivityTxHash(
        getFeed,
        0,
        { maxWaitMs: 8000, initialDelayMs: 250, maxDelayMs: 2000, signal: controller.signal },
        undefined,
        sleep,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });

    // Only one sleep happened before the abort was observed — nowhere near the
    // full 8000ms budget of exponential backoff.
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([250]);
  });

  it('ignores unrelated new entries when a matcher is provided', async () => {
    const { sleep, delays } = makeSleepRecorder();
    const myId = 'request-a';
    const feeds = [
      [{ txHash: 'other-hash', demoRunId: 'request-b' }],
      [
        { txHash: 'my-hash', demoRunId: myId },
        { txHash: 'other-hash', demoRunId: 'request-b' },
      ],
    ];
    const getFeed = vi.fn(() => feeds.shift() ?? feeds[feeds.length - 1]);

    const result = await waitForActivityTxHash(
      getFeed,
      0,
      defaultOptions,
      (entry) => entry.demoRunId === myId,
      sleep,
    );

    expect(result).toBe('my-hash');
    expect(getFeed).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([250]);
  });
});
