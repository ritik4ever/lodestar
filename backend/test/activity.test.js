import { describe, it, expect } from 'vitest';

import {
  recordActivity,
  getActivityFeed,
  parseActivityPagination,
  ACTIVITY_DEFAULT_LIMIT,
  ACTIVITY_MAX_LIMIT,
  ACTIVITY_MAX_ENTRIES,
} from '../src/lib/activityFeed.js';

// recordActivity mutates a module-level store; seed it so the slicing
// assertions below have a known, full feed to page through.
function seedFeed(count) {
  for (let i = 0; i < count; i++) {
    recordActivity({ timestamp: `t-${i}`, service: `svc-${i}` });
  }
}

describe('parseActivityPagination', () => {
  it('applies sane defaults when params are absent', () => {
    const { limit, offset, errors } = parseActivityPagination({});
    expect(limit).toBe(ACTIVITY_DEFAULT_LIMIT);
    expect(offset).toBe(0);
    expect(errors).toEqual([]);
  });

  it('parses valid limit and offset', () => {
    const { limit, offset, errors } = parseActivityPagination({ limit: '10', offset: '5' });
    expect(limit).toBe(10);
    expect(offset).toBe(5);
    expect(errors).toEqual([]);
  });

  it('clamps limit to the maximum', () => {
    const { limit, errors } = parseActivityPagination({ limit: String(ACTIVITY_MAX_LIMIT + 100) });
    expect(limit).toBe(ACTIVITY_MAX_LIMIT);
    expect(errors).toEqual([]);
  });

  it('rejects non-positive or non-integer limit', () => {
    for (const bad of ['0', '-1', '1.5', 'abc', '']) {
      const { errors } = parseActivityPagination({ limit: bad });
      expect(errors.length, `expected error for limit=${JSON.stringify(bad)}`).toBeGreaterThan(0);
    }
  });

  it('rejects negative or non-integer offset', () => {
    for (const bad of ['-1', '2.5', 'xyz']) {
      const { errors } = parseActivityPagination({ offset: bad });
      expect(errors.length, `expected error for offset=${JSON.stringify(bad)}`).toBeGreaterThan(0);
    }
  });
});

describe('activity feed store', () => {
  it('getActivityFeed always returns an array', () => {
    const feed = getActivityFeed();
    expect(Array.isArray(feed)).toBe(true);
  });

  it('getActivityFeed slicing yields non-overlapping pages', () => {
    seedFeed(ACTIVITY_MAX_ENTRIES);
    const feed = getActivityFeed();
    expect(feed.length).toBe(ACTIVITY_MAX_ENTRIES);

    const page1 = feed.slice(0, 10);
    const page2 = feed.slice(10, 20);
    expect(page1.length).toBe(10);
    expect(page2.length).toBe(10);
    expect(page1[0]).not.toEqual(page2[0]);
  });

  it('recordActivity caps the feed at ACTIVITY_MAX_ENTRIES', () => {
    seedFeed(ACTIVITY_MAX_ENTRIES + 25);
    expect(getActivityFeed().length).toBe(ACTIVITY_MAX_ENTRIES);
  });

  it('maintains LIFO ordering — newest entry appears first', () => {
    const first = { id: 'first', marker: 1 };
    const second = { id: 'second', marker: 2 };
    const third = { id: 'third', marker: 3 };

    recordActivity(first);
    recordActivity(second);
    recordActivity(third);

    const feed = getActivityFeed();
    expect(feed[0].id).toBe('third');
    expect(feed[1].id).toBe('second');
    expect(feed[2].id).toBe('first');
  });

  it('returns a single recorded entry intact', () => {
    const entry = { txHash: 'single-entry-hash', service: 'test-svc' };
    recordActivity(entry);
    const feed = getActivityFeed();
    // The feed is a file-based persistent store; prior test entries may exist.
    // Verify the most recently recorded entry (at index 0 via unshift) matches exactly.
    expect(feed[0]).toEqual(entry);
  });

  it('truncation drops oldest entries and preserves newest', () => {
    // Fill the feed to its maximum capacity with labelled filler entries
    for (let i = 0; i < ACTIVITY_MAX_ENTRIES; i++) {
      recordActivity({ tag: 'filler', n: i });
    }
    // Push one more — this should bump the oldest filler (n=0) out
    const newest = { tag: 'newest', marker: true };
    recordActivity(newest);

    const feed = getActivityFeed();
    expect(feed.length).toBe(ACTIVITY_MAX_ENTRIES);
    expect(feed[0]).toMatchObject(newest);

    // The oldest filler entry (n=0) should have been evicted
    const hasOldest = feed.some((e) => e.tag === 'filler' && e.n === 0);
    expect(hasOldest).toBe(false);
  });
});
