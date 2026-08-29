import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateCacheKey,
  generateETag,
  getRegistryCache,
  setRegistryCache,
  clearRegistryCache,
  getCacheSize,
} from './registryCache.js';

describe('registryCache module', () => {
  beforeEach(() => {
    clearRegistryCache();
  });

  describe('generateCacheKey', () => {
    it('returns pathname when no query parameters are present', () => {
      expect(generateCacheKey({ originalUrl: '/api/services' })).toBe('/api/services');
    });

    it('sorts query parameters so key is deterministic regardless of param order', () => {
      const req1 = { originalUrl: '/api/services?q=test&category=weather&page=1' };
      const req2 = { originalUrl: '/api/services?page=1&q=test&category=weather' };
      expect(generateCacheKey(req1)).toBe(generateCacheKey(req2));
      expect(generateCacheKey(req1)).toBe('/api/services?category=weather&page=1&q=test');
    });

    it('falls back to req.url if originalUrl is absent', () => {
      expect(generateCacheKey({ url: '/api/stats' })).toBe('/api/stats');
    });
  });

  describe('generateETag', () => {
    it('generates consistent quotes-wrapped hash for identical payload', () => {
      const payload = { services: [{ id: 1, name: 'Service 1' }] };
      const etag1 = generateETag(payload);
      const etag2 = generateETag(payload);
      expect(etag1).toBe(etag2);
      expect(etag1).toMatch(/^"[a-f0-9]{16}"$/);
    });

    it('generates different ETags for different payloads', () => {
      expect(generateETag({ a: 1 })).not.toBe(generateETag({ a: 2 }));
    });
  });

  describe('getRegistryCache and setRegistryCache', () => {
    it('returns cached item when within TTL', () => {
      const key = '/api/services';
      const data = { services: [1, 2, 3] };
      setRegistryCache(key, data);

      const cached = getRegistryCache(key, 10_000);
      expect(cached).not.toBeNull();
      expect(cached.data).toEqual(data);
      expect(cached.etag).toBeDefined();
    });

    it('returns null and purges item when TTL expires', () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      const key = '/api/services';
      const data = { services: [] };
      setRegistryCache(key, data);

      // Fast forward past 10s TTL
      vi.setSystemTime(now + 10_001);

      const cached = getRegistryCache(key, 10_000);
      expect(cached).toBeNull();
      expect(getCacheSize()).toBe(0);

      vi.useRealTimers();
    });

    it('clearRegistryCache empties all cached keys', () => {
      setRegistryCache('/key1', { val: 1 });
      setRegistryCache('/key2', { val: 2 });
      expect(getCacheSize()).toBe(2);

      clearRegistryCache();
      expect(getCacheSize()).toBe(0);
      expect(getRegistryCache('/key1', 10_000)).toBeNull();
    });
  });
});
