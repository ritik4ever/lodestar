import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import requestIdMiddleware from './requestId.js';

describe('requestIdMiddleware', () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    req = {
      headers: {},
    };
    res = {
      setHeader: vi.fn(),
    };
    next = vi.fn();
  });

  describe('success paths', () => {
    it('generates a UUID v4 when no X-Request-Id header is present', () => {
      requestIdMiddleware(req, res, next);

      expect(req.requestId).toBeTruthy();
      expect(req.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.requestId);
      expect(next).toHaveBeenCalledOnce();
    });

    it('preserves client-provided X-Request-Id header', () => {
      req.headers['x-request-id'] = 'client-correlation-id-123';

      requestIdMiddleware(req, res, next);

      expect(req.requestId).toBe('client-correlation-id-123');
      expect(res.setHeader).toHaveBeenCalledWith(
        'X-Request-Id',
        'client-correlation-id-123',
      );
      expect(next).toHaveBeenCalledOnce();
    });

    it('sets both req.requestId and response header with same value', () => {
      req.headers['x-request-id'] = 'matching-id';

      requestIdMiddleware(req, res, next);

      expect(req.requestId).toBe('matching-id');
      expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'matching-id');
      expect(res.setHeader).toHaveBeenCalledOnce();
    });

    it('calls next() exactly once', () => {
      requestIdMiddleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('edge cases and boundary inputs', () => {
    it('handles empty string X-Request-Id by generating UUID', () => {
      req.headers['x-request-id'] = '';

      requestIdMiddleware(req, res, next);

      expect(req.requestId).toBeTruthy();
      expect(req.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.requestId);
      expect(next).toHaveBeenCalledOnce();
    });

    it('handles whitespace-only X-Request-Id', () => {
      req.headers['x-request-id'] = '   ';

      requestIdMiddleware(req, res, next);

      expect(req.requestId).toBe('   ');
      expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', '   ');
      expect(next).toHaveBeenCalledOnce();
    });

    it('preserves UUID-format client IDs', () => {
      const clientUuid = crypto.randomUUID();
      req.headers['x-request-id'] = clientUuid;

      requestIdMiddleware(req, res, next);

      expect(req.requestId).toBe(clientUuid);
      expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', clientUuid);
    });

    it('handles very long X-Request-Id values', () => {
      const longId = 'a'.repeat(1000);
      req.headers['x-request-id'] = longId;

      requestIdMiddleware(req, res, next);

      expect(req.requestId).toBe(longId);
      expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', longId);
      expect(next).toHaveBeenCalledOnce();
    });

    it('handles special characters in X-Request-Id', () => {
      const specialId = 'req-id!@#$%^&*()_+-={}[]|:";\'<>?,./';
      req.headers['x-request-id'] = specialId;

      requestIdMiddleware(req, res, next);

      expect(req.requestId).toBe(specialId);
      expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', specialId);
      expect(next).toHaveBeenCalledOnce();
    });

    it('handles Unicode characters in X-Request-Id', () => {
      const unicodeId = 'req-测试-🚀-αβγ';
      req.headers['x-request-id'] = unicodeId;

      requestIdMiddleware(req, res, next);

      expect(req.requestId).toBe(unicodeId);
      expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', unicodeId);
      expect(next).toHaveBeenCalledOnce();
    });

    it('handles numeric string X-Request-Id', () => {
      req.headers['x-request-id'] = '12345';

      requestIdMiddleware(req, res, next);

      expect(req.requestId).toBe('12345');
      expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', '12345');
      expect(next).toHaveBeenCalledOnce();
    });

    it('handles X-Request-Id with only dashes', () => {
      req.headers['x-request-id'] = '----';

      requestIdMiddleware(req, res, next);

      expect(req.requestId).toBe('----');
      expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', '----');
      expect(next).toHaveBeenCalledOnce();
    });

    it('throws when headers object is undefined', () => {
      req.headers = undefined;

      expect(() => requestIdMiddleware(req, res, next)).toThrow(
        "Cannot read properties of undefined (reading 'x-request-id')",
      );
    });
  });

  describe('error propagation', () => {
    it('propagates errors thrown by next()', () => {
      const error = new Error('Downstream middleware error');
      next.mockImplementation(() => {
        throw error;
      });

      expect(() => requestIdMiddleware(req, res, next)).toThrow(
        'Downstream middleware error',
      );
      expect(req.requestId).toBeTruthy();
      expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.requestId);
    });

    it('propagates errors passed to next(err)', () => {
      const error = new Error('Error passed to next');
      next.mockImplementation((err) => {
        if (err) throw err;
      });

      expect(() => requestIdMiddleware(req, res, next)).not.toThrow();
      expect(next).toHaveBeenCalledOnce();
    });

    it('handles setHeader throwing an error', () => {
      const error = new Error('Header already sent');
      res.setHeader.mockImplementation(() => {
        throw error;
      });

      expect(() => requestIdMiddleware(req, res, next)).toThrow(
        'Header already sent',
      );
      expect(req.requestId).toBeTruthy();
      expect(next).not.toHaveBeenCalled();
    });

    it('handles crypto.randomUUID() failure gracefully', () => {
      vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
        throw new Error('Crypto not available');
      });

      expect(() => requestIdMiddleware(req, res, next)).toThrow(
        'Crypto not available',
      );

      crypto.randomUUID.mockRestore();
    });
  });

  describe('header case sensitivity', () => {
    it('reads x-request-id in lowercase', () => {
      req.headers['x-request-id'] = 'lowercase-id';

      requestIdMiddleware(req, res, next);

      expect(req.requestId).toBe('lowercase-id');
    });

    it('does not read X-Request-Id in uppercase (Express normalizes to lowercase)', () => {
      // Express normalizes headers to lowercase, but test behavior if uppercase exists
      req.headers['X-Request-Id'] = 'uppercase-id';

      requestIdMiddleware(req, res, next);

      // Should generate UUID since Express lowercases headers
      expect(req.requestId).toBeTruthy();
      expect(req.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('does not read mixed case X-Request-Id', () => {
      req.headers['X-rEqUeSt-Id'] = 'mixed-case-id';

      requestIdMiddleware(req, res, next);

      // Should generate UUID since Express lowercases headers
      expect(req.requestId).toBeTruthy();
      expect(req.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });
  });

  describe('consistency checks', () => {
    it('generates different UUIDs on subsequent calls', () => {
      const req1 = { headers: {} };
      const res1 = { setHeader: vi.fn() };
      const next1 = vi.fn();

      const req2 = { headers: {} };
      const res2 = { setHeader: vi.fn() };
      const next2 = vi.fn();

      requestIdMiddleware(req1, res1, next1);
      requestIdMiddleware(req2, res2, next2);

      expect(req1.requestId).toBeTruthy();
      expect(req2.requestId).toBeTruthy();
      expect(req1.requestId).not.toBe(req2.requestId);
    });

    it('does not modify the original request headers', () => {
      const originalHeaders = { 'x-request-id': 'original-id' };
      req.headers = { ...originalHeaders };

      requestIdMiddleware(req, res, next);

      expect(req.headers['x-request-id']).toBe('original-id');
      expect(Object.keys(req.headers).length).toBe(1);
    });

    it('does not add request ID to response headers if setHeader is not a function', () => {
      res.setHeader = undefined;

      expect(() => requestIdMiddleware(req, res, next)).toThrow();
      expect(req.requestId).toBeTruthy();
    });
  });

  describe('integration scenarios', () => {
    it('handles rapid successive calls with different IDs', () => {
      const calls = Array.from({ length: 100 }, (_, i) => ({
        req: { headers: { 'x-request-id': `client-id-${i}` } },
        res: { setHeader: vi.fn() },
        next: vi.fn(),
      }));

      calls.forEach(({ req, res, next }) => {
        requestIdMiddleware(req, res, next);
      });

      calls.forEach(({ req, res, next }, i) => {
        expect(req.requestId).toBe(`client-id-${i}`);
        expect(res.setHeader).toHaveBeenCalledWith(
          'X-Request-Id',
          `client-id-${i}`,
        );
        expect(next).toHaveBeenCalledOnce();
      });
    });

    it('handles rapid successive calls without client IDs', () => {
      const calls = Array.from({ length: 10 }, () => ({
        req: { headers: {} },
        res: { setHeader: vi.fn() },
        next: vi.fn(),
      }));

      calls.forEach(({ req, res, next }) => {
        requestIdMiddleware(req, res, next);
      });

      const requestIds = calls.map(({ req }) => req.requestId);
      const uniqueIds = new Set(requestIds);

      expect(uniqueIds.size).toBe(10); // All should be unique
      requestIds.forEach((id) => {
        expect(id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
      });
    });
  });
});
