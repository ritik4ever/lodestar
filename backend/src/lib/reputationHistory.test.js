import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordReputationChange,
  getReputationHistory,
  clearReputationHistory,
} from './reputationHistory.js';

beforeEach(() => {
  clearReputationHistory();
});

describe('reputationHistory', () => {
  describe('getReputationHistory', () => {
    it('returns an empty array for an unknown serviceId', () => {
      expect(getReputationHistory(999)).toEqual([]);
    });

    it('returns an empty array for a serviceId that was never recorded', () => {
      recordReputationChange(1, 1000, 5, 5);
      expect(getReputationHistory(2)).toEqual([]);
    });
  });

  describe('recordReputationChange', () => {
    it('records a single entry and retrieves it intact', () => {
      recordReputationChange(1, 1718170000, 1, 100);

      const history = getReputationHistory(1);
      expect(history).toHaveLength(1);
      expect(history[0]).toEqual({
        timestamp: 1718170000,
        delta: 1,
        newValue: 100,
      });
    });

    it('maintains LIFO ordering — newest entry appears first', () => {
      recordReputationChange(1, 1000, 10, 10);
      recordReputationChange(1, 2000, 5, 15);
      recordReputationChange(1, 3000, -3, 12);

      const history = getReputationHistory(1);
      expect(history).toHaveLength(3);
      expect(history[0].timestamp).toBe(3000);
      expect(history[1].timestamp).toBe(2000);
      expect(history[2].timestamp).toBe(1000);
    });

    it('isolates history across different serviceIds', () => {
      recordReputationChange(1, 1000, 5, 5);
      recordReputationChange(2, 2000, 10, 10);
      recordReputationChange(1, 3000, -2, 3);

      const history1 = getReputationHistory(1);
      const history2 = getReputationHistory(2);

      expect(history1).toHaveLength(2);
      expect(history2).toHaveLength(1);

      // Verify correct values per service
      expect(history1[0]).toMatchObject({ timestamp: 3000, delta: -2, newValue: 3 });
      expect(history1[1]).toMatchObject({ timestamp: 1000, delta: 5, newValue: 5 });
      expect(history2[0]).toMatchObject({ timestamp: 2000, delta: 10, newValue: 10 });
    });

    it('handles negative deltas correctly', () => {
      recordReputationChange(1, 1000, -50, -50);

      const history = getReputationHistory(1);
      expect(history[0].delta).toBe(-50);
      expect(history[0].newValue).toBe(-50);
    });

    it('handles zero delta correctly', () => {
      recordReputationChange(1, 1000, 0, 100);

      const history = getReputationHistory(1);
      expect(history[0].delta).toBe(0);
      expect(history[0].newValue).toBe(100);
    });

    it('accumulates many entries without data loss', () => {
      const count = 100;
      for (let i = 0; i < count; i++) {
        recordReputationChange(1, i * 1000, i, i * 2);
      }

      const history = getReputationHistory(1);
      expect(history).toEqual(
        Array.from({ length: count }, (_, index) => {
          const i = count - 1 - index;
          return { timestamp: i * 1000, delta: i, newValue: i * 2 };
        }),
      );
    });
  });
});
