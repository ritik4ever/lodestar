/**
 * Unit tests for the Redis-backed activityFeed module.
 *
 * Uses ioredis-mock so no real Redis connection is needed.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import RedisMock from 'ioredis-mock';
import {
  setActivityFeedRedis,
  recordActivity,
  getActivityFeed,
  parseActivityPagination,
  ACTIVITY_MAX_ENTRIES,
  ACTIVITY_DEFAULT_LIMIT,
  ACTIVITY_MAX_LIMIT,
} from './activityFeed.js';

// ── helpers ──────────────────────────────────────────────────────────────────

const makeEntry = (n) => ({
  timestamp: `2026-01-01T00:0${n}:00Z`,
  agent: `G${'A'.repeat(55)}`,
  service: `Service-${n}`,
  amount: '0.001',
  txHash: `tx${n}`,
});

// ── Redis mode tests ─────────────────────────────────────────────────────────

describe('activityFeed — Redis mode', () => {
  let redis;

  beforeEach(() => {
    redis = new RedisMock();
    setActivityFeedRedis(redis);
  });

  afterEach(async () => {
    await redis.flushall();
    // Reset to file-based fallback
    setActivityFeedRedis(null);
  });

  it('recordActivity stores entries and getActivityFeed retrieves them', async () => {
    await recordActivity(makeEntry(1));
    await recordActivity(makeEntry(2));
    const feed = await getActivityFeed();
    // Newest-first
    expect(feed).toHaveLength(2);
    expect(feed[0].service).toBe('Service-2');
    expect(feed[1].service).toBe('Service-1');
  });

  it('caps the feed at ACTIVITY_MAX_ENTRIES (50) entries', async () => {
    for (let i = 0; i < ACTIVITY_MAX_ENTRIES + 10; i++) {
      await recordActivity(makeEntry(i));
    }
    const feed = await getActivityFeed();
    expect(feed).toHaveLength(ACTIVITY_MAX_ENTRIES);
  });

  it('getActivityFeed returns [] when no entries have been recorded', async () => {
    const feed = await getActivityFeed();
    expect(feed).toEqual([]);
  });

  it('entries survive across separate getActivityFeed calls (replica durability)', async () => {
    await recordActivity(makeEntry(42));
    // Simulate a second replica reading the same Redis key
    const feed1 = await getActivityFeed();
    const feed2 = await getActivityFeed();
    expect(feed1).toEqual(feed2);
    expect(feed1[0].service).toBe('Service-42');
  });
});

// ── parseActivityPagination ──────────────────────────────────────────────────

describe('parseActivityPagination', () => {
  it('returns defaults when called with no arguments', () => {
    const { limit, offset, errors } = parseActivityPagination();
    expect(limit).toBe(ACTIVITY_DEFAULT_LIMIT);
    expect(offset).toBe(0);
    expect(errors).toEqual([]);
  });

  it('clamps limit to ACTIVITY_MAX_LIMIT', () => {
    const { limit, errors } = parseActivityPagination({ limit: String(ACTIVITY_MAX_LIMIT + 100) });
    expect(limit).toBe(ACTIVITY_MAX_LIMIT);
    expect(errors).toEqual([]);
  });

  it('reports an error for a non-positive limit', () => {
    const { errors } = parseActivityPagination({ limit: '0' });
    expect(errors).toContain('`limit` must be a positive integer');
  });

  it('reports an error for a negative offset', () => {
    const { errors } = parseActivityPagination({ offset: '-1' });
    expect(errors).toContain('`offset` must be a non-negative integer');
  });

  it('accepts valid limit and offset', () => {
    const { limit, offset, errors } = parseActivityPagination({ limit: '10', offset: '5' });
    expect(limit).toBe(10);
    expect(offset).toBe(5);
    expect(errors).toEqual([]);
  });
});
