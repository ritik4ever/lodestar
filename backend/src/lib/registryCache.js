import crypto from 'crypto';

const cacheStore = new Map();

/**
 * Generate a normalized cache key from an Express request.
 * Sorts query parameters to ensure identical parameter sets map to the same key.
 */
export function generateCacheKey(req) {
  const fullUrl = req.originalUrl || req.url || '/';
  const [pathname, queryString] = fullUrl.split('?');
  if (!queryString) {
    return pathname;
  }
  const params = new URLSearchParams(queryString);
  params.sort();
  const sortedQuery = params.toString();
  return sortedQuery ? `${pathname}?${sortedQuery}` : pathname;
}

/**
 * Generate a strong ETag for a given response payload.
 */
export function generateETag(payload) {
  const content = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  return `"${hash}"`;
}

/**
 * Retrieve an unexpired cached item by key.
 * @param {string} key
 * @param {number} ttlMs
 * @returns {{ data: any, etag: string } | null}
 */
export function getRegistryCache(key, ttlMs) {
  const entry = cacheStore.get(key);
  if (!entry) {
    return null;
  }
  if (Date.now() - entry.timestamp > ttlMs) {
    cacheStore.delete(key);
    return null;
  }
  return { data: entry.data, etag: entry.etag };
}

/**
 * Store a response payload in the cache.
 * @param {string} key
 * @param {any} data
 * @returns {{ data: any, etag: string }}
 */
export function setRegistryCache(key, data) {
  const etag = generateETag(data);
  const entry = {
    data,
    etag,
    timestamp: Date.now(),
  };
  cacheStore.set(key, entry);
  return entry;
}

/**
 * Invalidate all cached entries. Called on successful write operations.
 */
export function clearRegistryCache() {
  cacheStore.clear();
}

/**
 * Get current number of items in cache (used in tests / diagnostics).
 */
export function getCacheSize() {
  return cacheStore.size;
}
