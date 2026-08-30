import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordReputationChange,
  getReputationHistory,
  clearReputationHistory,
  applyRetention,
  compactAllReputationHistory,
  getReputationHistorySize,
  RAW_WINDOW_MS,
  COMPACTION_BUCKET_MS,
  RETENTION_WINDOW_MS,
  MAX_POINTS_PER_SERVICE,
} from './reputationHistory.js';

/**
 * Retention and compaction policy (#857).
 *
 * History used to grow without bound per service. These tests pin the three
 * tiers — raw, compacted, dropped — and the guarantees the documentation makes.
 */

const NOW = Date.parse('2026-08-29T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function point(ageMs, delta = 1, newValue = 100) {
  return { timestamp: NOW - ageMs, delta, newValue };
}

describe('reputation history retention (#857)', () => {
  beforeEach(() => {
    clearReputationHistory();
  });

  describe('raw window', () => {
    it('keeps every event inside the raw window at full resolution', () => {
      const points = [point(1 * DAY), point(2 * DAY), point(3 * DAY)];

      const retained = applyRetention(points, NOW);

      expect(retained).toHaveLength(3);
      expect(retained.every((p) => !p.compacted)).toBe(true);
    });

    it('keeps events right up to the raw boundary', () => {
      const retained = applyRetention([point(RAW_WINDOW_MS - 1000)], NOW);

      expect(retained).toHaveLength(1);
      expect(retained[0].compacted).toBeUndefined();
    });

    it('preserves newest-first ordering', () => {
      const points = [point(1 * DAY), point(2 * DAY), point(3 * DAY)];

      const retained = applyRetention(points, NOW);

      expect(retained[0].timestamp).toBeGreaterThan(retained[1].timestamp);
      expect(retained[1].timestamp).toBeGreaterThan(retained[2].timestamp);
    });
  });

  describe('compaction', () => {
    it('folds same-day events beyond the raw window into one bucket', () => {
      const base = RAW_WINDOW_MS + 2 * DAY;
      const points = [
        point(base, 5, 130),
        point(base + 1000, 3, 125),
        point(base + 2000, 2, 122),
      ];

      const retained = applyRetention(points, NOW);

      expect(retained).toHaveLength(1);
      expect(retained[0].compacted).toBe(true);
      expect(retained[0].eventCount).toBe(3);
      // Net movement across the bucket, and the value it closed at.
      expect(retained[0].delta).toBe(10);
      expect(retained[0].newValue).toBe(130);
    });

    it('keeps separate days in separate buckets', () => {
      const base = RAW_WINDOW_MS + DAY;
      const points = [point(base, 1), point(base + COMPACTION_BUCKET_MS, 1)];

      const retained = applyRetention(points, NOW);

      expect(retained).toHaveLength(2);
      expect(retained.every((p) => p.compacted)).toBe(true);
    });

    it('aligns buckets to the compaction interval', () => {
      const retained = applyRetention([point(RAW_WINDOW_MS + 3 * DAY + 12345)], NOW);

      expect(retained[0].timestamp % COMPACTION_BUCKET_MS).toBe(0);
    });

    it('mixes raw and compacted points in one history', () => {
      const points = [point(1 * DAY), point(RAW_WINDOW_MS + 2 * DAY)];

      const retained = applyRetention(points, NOW);

      expect(retained).toHaveLength(2);
      expect(retained[0].compacted).toBeUndefined();
      expect(retained[1].compacted).toBe(true);
    });

    it('is idempotent — recompacting an already-compacted history is stable', () => {
      const points = [point(RAW_WINDOW_MS + DAY, 2), point(RAW_WINDOW_MS + DAY + 500, 3)];

      const once = applyRetention(points, NOW);
      const twice = applyRetention(once, NOW);

      expect(twice).toEqual(once);
      expect(twice[0].eventCount).toBe(2);
    });
  });

  describe('retention window', () => {
    it('drops points beyond the retention window', () => {
      const points = [point(1 * DAY), point(RETENTION_WINDOW_MS + DAY)];

      const retained = applyRetention(points, NOW);

      expect(retained).toHaveLength(1);
      expect(retained[0].timestamp).toBe(NOW - DAY);
    });

    it('keeps a point just inside the retention window', () => {
      const retained = applyRetention([point(RETENTION_WINDOW_MS - DAY)], NOW);

      expect(retained).toHaveLength(1);
    });

    it('can empty a history entirely', () => {
      expect(applyRetention([point(RETENTION_WINDOW_MS * 2)], NOW)).toEqual([]);
    });
  });

  describe('hard cap', () => {
    it('bounds a single service even inside the raw window', () => {
      const points = Array.from({ length: MAX_POINTS_PER_SERVICE + 200 }, (_, i) =>
        point(i * 1000),
      );

      const retained = applyRetention(points, NOW);

      expect(retained).toHaveLength(MAX_POINTS_PER_SERVICE);
      // The oldest points are the ones dropped.
      expect(retained[0].timestamp).toBe(NOW);
    });
  });

  describe('applied on write', () => {
    it('does not accumulate unbounded points for one service', () => {
      for (let i = 0; i < MAX_POINTS_PER_SERVICE + 100; i++) {
        recordReputationChange(1, Date.now() - i, 1, 100 + i);
      }

      expect(getReputationHistory(1).length).toBeLessThanOrEqual(MAX_POINTS_PER_SERVICE);
    });

    it('keeps a normal recent history untouched', () => {
      recordReputationChange(7, Date.now(), 1, 101);
      recordReputationChange(7, Date.now(), -1, 100);

      const history = getReputationHistory(7);
      expect(history).toHaveLength(2);
      expect(history.every((p) => !p.compacted)).toBe(true);
    });
  });

  describe('sweep across services', () => {
    it('compacts every service and reports what it did', () => {
      const old = Date.now() - RAW_WINDOW_MS - 2 * DAY;
      recordReputationChange(1, Date.now(), 1, 101);
      recordReputationChange(2, old, 1, 50);
      recordReputationChange(2, old + 1000, 1, 51);

      const before = getReputationHistorySize();
      const result = compactAllReputationHistory();

      expect(result.pointsBefore).toBe(before);
      expect(result.pointsAfter).toBeLessThanOrEqual(result.pointsBefore);
      expect(result.services).toBeGreaterThan(0);
    });

    it('removes services whose history has aged out completely', () => {
      recordReputationChange(9, Date.now() - RETENTION_WINDOW_MS * 2, 1, 10);

      compactAllReputationHistory();

      expect(getReputationHistory(9)).toEqual([]);
    });
  });

  describe('documented guarantees', () => {
    it('guarantees per-event resolution for the last 7 days', () => {
      expect(RAW_WINDOW_MS).toBe(7 * DAY);
    });

    it('guarantees daily resolution from 7 to 90 days', () => {
      expect(COMPACTION_BUCKET_MS).toBe(DAY);
      expect(RETENTION_WINDOW_MS).toBe(90 * DAY);
    });

    it('marks aggregates so a consumer cannot mistake one for a single event', () => {
      const retained = applyRetention([point(RAW_WINDOW_MS + DAY)], NOW);

      expect(retained[0]).toHaveProperty('compacted', true);
      expect(retained[0]).toHaveProperty('eventCount');
    });
  });
});
