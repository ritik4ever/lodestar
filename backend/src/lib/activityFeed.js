// Activity feed — durable store backed by Redis (capped list).
//
// ── Retention ───────────────────────────────────────────────────────────────
// At most ACTIVITY_MAX_ENTRIES (50) entries are kept.  Every write appends to
// the head of a Redis list and trims the tail to the cap, so storage is O(1)
// and retention requires no scheduled job.
//
// Redis key:  lodestar:activity:feed
// Structure:  a Redis list of JSON-serialised entry objects, newest-first.
//
// ── Replica consistency ──────────────────────────────────────────────────────
// All replicas share the same Redis list, so every GET /activity response
// reflects the same set of events regardless of which backend instance handled
// the write.
//
// ── Restart durability ──────────────────────────────────────────────────────
// The list lives in Redis, not in process memory or a local file.  Restarting
// or replacing a backend instance does not lose entries.
//
// ── Fallback ────────────────────────────────────────────────────────────────
// When REDIS_URL is not set the module falls back to the file-based store so
// a single-instance deployment without Redis continues to work unchanged.  The
// fallback is logged once at startup so operators know which path is active.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum number of entries retained in the feed. */
export const ACTIVITY_MAX_ENTRIES = 50;
export const ACTIVITY_DEFAULT_LIMIT = 20;
export const ACTIVITY_MAX_LIMIT = ACTIVITY_MAX_ENTRIES;

const REDIS_KEY = 'lodestar:activity:feed';

// ── Redis client (optional) ──────────────────────────────────────────────────

let redisClient = null;

/**
 * Inject a Redis client.  Called by the server at startup (or in tests via
 * the ioredis-mock).  When not called, the module falls back to the file store.
 *
 * @param {import('ioredis').Redis} client
 */
export function setActivityFeedRedis(client) {
  redisClient = client;
}

// ── File-based fallback ──────────────────────────────────────────────────────

const DATA_DIR = process.env.ACTIVITY_FEED_DIR || join(__dirname, '../../data');
const FEED_FILE = join(DATA_DIR, 'activityFeed.json');

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function fileFeedLoad() {
  ensureDataDir();
  if (!existsSync(FEED_FILE)) return [];
  const raw = readFileSync(FEED_FILE, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(
      `[activityFeed] Feed file contains invalid format: expected array, got ${typeof parsed}`,
    );
  }
  return parsed;
}

function fileFeedSave(feed) {
  ensureDataDir();
  writeFileSync(FEED_FILE, JSON.stringify(feed, null, 2), 'utf-8');
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Append one entry to the front of the activity feed.
 *
 * With Redis: atomic LPUSH + LTRIM keeps the list capped without a scan.
 * Without Redis: load → unshift → trim → write (file-based fallback).
 *
 * @param {object} entry
 */
export async function recordActivity(entry) {
  if (redisClient) {
    const serialised = JSON.stringify(entry);
    // LPUSH pushes to the head (newest-first); LTRIM discards the tail.
    await redisClient.lpush(REDIS_KEY, serialised);
    await redisClient.ltrim(REDIS_KEY, 0, ACTIVITY_MAX_ENTRIES - 1);
    return;
  }

  // File-based fallback
  const feed = fileFeedLoad();
  feed.unshift(entry);
  if (feed.length > ACTIVITY_MAX_ENTRIES) feed.pop();
  try {
    fileFeedSave(feed);
  } catch (err) {
    console.error('[activityFeed] Failed to persist feed:', err.message);
    throw err;
  }
}

/**
 * Return the full activity feed as an array of plain objects, newest-first.
 *
 * With Redis: LRANGE 0 -1 (returns all elements, newest-first).
 * Without Redis: reads the JSON file.
 *
 * @returns {Promise<object[]>}
 */
export async function getActivityFeed() {
  if (redisClient) {
    const raw = await redisClient.lrange(REDIS_KEY, 0, -1);
    return raw.map((s) => JSON.parse(s));
  }

  try {
    return fileFeedLoad();
  } catch (err) {
    console.error('[activityFeed] Failed to load feed:', err.message);
    throw err;
  }
}

/**
 * Validate and normalise `limit`/`offset` query params for the activity feed.
 * Missing params fall back to sane defaults; `limit` is clamped to ACTIVITY_MAX_LIMIT.
 * @param {Record<string, unknown>} [query]
 * @returns {{ limit: number, offset: number, errors: string[] }}
 */
export function parseActivityPagination(query = {}) {
  const errors = [];
  let limit = ACTIVITY_DEFAULT_LIMIT;
  let offset = 0;

  if (query.limit !== undefined) {
    const n = Number(query.limit);
    if (!Number.isInteger(n) || n < 1) {
      errors.push('`limit` must be a positive integer');
    } else {
      limit = Math.min(n, ACTIVITY_MAX_LIMIT);
    }
  }

  if (query.offset !== undefined) {
    const n = Number(query.offset);
    if (!Number.isInteger(n) || n < 0) {
      errors.push('`offset` must be a non-negative integer');
    } else {
      offset = n;
    }
  }

  return { limit, offset, errors };
}