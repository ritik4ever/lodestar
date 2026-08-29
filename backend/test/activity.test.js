/**
 * Integration tests for the activityFeed module.
 *
 * These tests exercise the module against a real ioredis-mock instance so they
 * cover both the Redis code path (durability, cap enforcement, LIFO ordering)
 * and the pure-logic helpers (parseActivityPagination).
 *
 * The file-based fallback is covered by the unit tests in
 * src/lib/activityFeed.test.js — here we always inject a Redis mock so the
 * tests run fast, deterministically, and without touching the filesystem.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import RedisMock from 'ioredis-mock';

import {
  setActivityFeedRedis,
  recordActivity,
  getActivityFeed,
  parseActivityPagination,
  ACTIVITY_DEFAULT_LIMIT,
  ACTIVITY_MAX_LIMIT,
  ACTIVITY_MAX_ENTRIES,
} from '../src/lib/activityFeed.js';

// ── Redis setup / teardown ───────────────────────────────────────────────────

let redis;

beforeEach(() => {
  redis = new RedisMock();
  setActivityFeedRedis(redis);
});

afterEach(async () => {
  await redis.flushall();
  setActivityFeedRedis(null);
});

// ── helpers ──────────────────────────────────────────────────────────────────

async function seedFeed(count) {
  for (let i = 0; i < count; i++) {
    await recordActivity({ timestamp: `t-${i}`, service: `svc-${i}` });
  }
}

// ── parseActivityPagination ──────────────────────────────────────────────────

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

// ── activity feed store ──────────────────────────────────────────────────────

describe('activity feed store', () => {
  it('getActivityFeed always returns an array', async () => {
    const feed = await getActivityFeed();
    expect(Array.isArray(feed)).toBe(true);
  });

  it('getActivityFeed slicing yields non-overlapping pages', async () => {
    await seedFeed(ACTIVITY_MAX_ENTRIES);
    const feed = await getActivityFeed();
    expect(feed.length).toBe(ACTIVITY_MAX_ENTRIES);

    const page1 = feed.slice(0, 10);
    const page2 = feed.slice(10, 20);
    expect(page1.length).toBe(10);
    expect(page2.length).toBe(10);
    expect(page1[0]).not.toEqual(page2[0]);
  });

  it('recordActivity caps the feed at ACTIVITY_MAX_ENTRIES', async () => {
    await seedFeed(ACTIVITY_MAX_ENTRIES + 25);
    expect((await getActivityFeed()).length).toBe(ACTIVITY_MAX_ENTRIES);
  });

  it('maintains LIFO ordering — newest entry appears first', async () => {
    const first = { id: 'first', marker: 1 };
    const second = { id: 'second', marker: 2 };
    const third = { id: 'third', marker: 3 };

    await recordActivity(first);
    await recordActivity(second);
    await recordActivity(third);

    const feed = await getActivityFeed();
    expect(feed[0].id).toBe('third');
    expect(feed[1].id).toBe('second');
    expect(feed[2].id).toBe('first');
  });

  it('returns a single recorded entry intact', async () => {
    const entry = { txHash: 'single-entry-hash', service: 'test-svc' };
    await recordActivity(entry);
    const feed = await getActivityFeed();
    expect(feed[0]).toEqual(entry);
  });

  it('truncation drops oldest entries and preserves newest', async () => {
    // Fill the feed to its maximum capacity with labelled filler entries
    for (let i = 0; i < ACTIVITY_MAX_ENTRIES; i++) {
      await recordActivity({ tag: 'filler', n: i });
    }
    // Push one more — this should bump the oldest filler (n=0) out
    const newest = { tag: 'newest', marker: true };
    await recordActivity(newest);

    const feed = await getActivityFeed();
    expect(feed.length).toBe(ACTIVITY_MAX_ENTRIES);
    expect(feed[0]).toMatchObject(newest);

    // The oldest filler entry (n=0) should have been evicted
    const hasOldest = feed.some((e) => e.tag === 'filler' && e.n === 0);
    expect(hasOldest).toBe(false);
  });
});
