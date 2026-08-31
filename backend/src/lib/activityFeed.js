// Activity feed — persisted to a JSON file so entries survive server restarts.
// Kept dependency-free so the feed/pagination logic is unit-testable in
// isolation from Express, x402, and runtime config.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.ACTIVITY_FEED_DIR || join(__dirname, '../../data');
const FEED_FILE = join(DATA_DIR, 'activityFeed.json');

/**
 * Maximum number of activity entries retained in the persisted feed.
 * @type {number}
 */
export const ACTIVITY_MAX_ENTRIES = 50;

/**
 * Default page size for activity queries when no limit is provided.
 * @type {number}
 */
export const ACTIVITY_DEFAULT_LIMIT = 20;

/**
 * Maximum allowed page size for activity queries.
 * @type {number}
 */
export const ACTIVITY_MAX_LIMIT = ACTIVITY_MAX_ENTRIES;

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadFeed() {
  ensureDataDir();
  if (!existsSync(FEED_FILE)) return [];
  const raw = readFileSync(FEED_FILE, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`[activityFeed] Feed file contains invalid format: expected array, got ${typeof parsed}`);
  }
  return parsed;
}

function saveFeed(feed) {
  ensureDataDir();
  writeFileSync(FEED_FILE, JSON.stringify(feed, null, 2), 'utf-8'); // let errors bubble up
}

/**
 * Persist a new activity entry to the backing feed file.
 *
 * This function is not safe to run concurrently with another writer for the same
 * feed file because it reads the current file, appends a new entry, and writes the
 * whole feed back. Concurrent writers can overwrite each other.
 *
 * @param {unknown} entry - The activity record to prepend to the feed. Callers are
 *   expected to pass the fully-formed structured object that downstream routes
 *   serialize to JSON.
 * @returns {void}
 * @throws {Error} If the feed file is unreadable, malformed, or cannot be saved.
 */
export function recordActivity(entry) {
  const feed = loadFeed();
  feed.unshift(entry);
  if (feed.length > ACTIVITY_MAX_ENTRIES) feed.pop();
  try {
    saveFeed(feed);
  } catch (err) {
    console.error('[activityFeed] Failed to persist feed:', err.message);
    throw err; // propagate so callers know persistence failed
  }
}

/**
 * Load the full persisted activity feed.
 *
 * Safe for concurrent readers; the feed is read from disk and returned without
 * mutation. Concurrent writes are not safe and may race with the read when the
 * file is being rewritten.
 *
 * @returns {unknown[]} The current feed contents as an array. Returns an empty
 *   array when no persisted feed exists yet.
 * @throws {Error} If the feed file exists but is malformed or unreadable.
 */
export function getActivityFeed() {
  try {
    return loadFeed();
  } catch (err) {
    console.error('[activityFeed] Failed to load feed:', err.message);
    throw err; // propagate so callers can handle appropriately
  }
}

/**
 * Validate and normalise `limit`/`offset` query params for the activity feed.
 *
 * Missing params fall back to sane defaults; `limit` is clamped to
 * `ACTIVITY_MAX_LIMIT` and invalid values are collected in `errors` instead of
 * throwing. This function is pure and safe to call concurrently.
 *
 * @param {Record<string, unknown>} [query] - Query-string values presented as
 *   strings or other scalar values by the route layer.
 * @returns {{ limit: number, offset: number, errors: string[] }}
 *   `limit` is always at least 1 and no greater than `ACTIVITY_MAX_LIMIT`.
 *   `offset` is always non-negative.
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