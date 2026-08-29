import { vi, describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../lib/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import logger from '../lib/logger.js';
import { paymentRateLimiter } from './paymentRateLimiter.js';

function makeApp(maxRequests, windowMs) {
  const app = express();
  app.get('/pay/:address', paymentRateLimiter(maxRequests, windowMs), (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe('paymentRateLimiter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows requests up to the configured limit', async () => {
    const app = makeApp(3, 60_000);

    for (let i = 0; i < 3; i++) {
      const res = await request(app).get('/pay/GADDR1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    }
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('returns 429 with RATE_LIMITED once the limit is exceeded', async () => {
    const app = makeApp(2, 60_000);

    await request(app).get('/pay/GADDR2');
    await request(app).get('/pay/GADDR2');

    const res = await request(app).get('/pay/GADDR2');
    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      error: 'Too many payment requests. Max 10 per minute per agent.',
      code: 'RATE_LIMITED',
      retryAfterMs: 60_000,
    });
  });

  it('logs a warning with the address and count when the limit is hit', async () => {
    const app = makeApp(1, 60_000);

    await request(app).get('/pay/GADDR3');
    await request(app).get('/pay/GADDR3');

    expect(logger.warn).toHaveBeenCalledWith(
      { address: 'GADDR3', count: 2 },
      'Payment rate limit hit'
    );
  });

  it('tracks separate buckets per agent address', async () => {
    const app = makeApp(1, 60_000);

    const first = await request(app).get('/pay/GADDR_A');
    const second = await request(app).get('/pay/GADDR_B');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it('exactly at the boundary (maxRequests-th request) is still allowed', async () => {
    const app = makeApp(5, 60_000);

    let lastStatus;
    for (let i = 0; i < 5; i++) {
      lastStatus = (await request(app).get('/pay/GADDR4')).status;
    }
    expect(lastStatus).toBe(200);
  });

  it('the request beyond the boundary (maxRequests+1) is rejected', async () => {
    const app = makeApp(5, 60_000);

    for (let i = 0; i < 5; i++) {
      await request(app).get('/pay/GADDR5');
    }
    const res = await request(app).get('/pay/GADDR5');
    expect(res.status).toBe(429);
  });

  it('allows requests again after the window has elapsed', async () => {
    const app = makeApp(1, 1_000);
    const nowSpy = vi.spyOn(Date, 'now');

    try {
      nowSpy.mockReturnValue(1_000_000);
      const first = await request(app).get('/pay/GADDR6');
      expect(first.status).toBe(200);

      const blocked = await request(app).get('/pay/GADDR6');
      expect(blocked.status).toBe(429);

      nowSpy.mockReturnValue(1_000_000 + 1_001);
      const afterWindow = await request(app).get('/pay/GADDR6');
      expect(afterWindow.status).toBe(200);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('uses default maxRequests and windowMs when none are supplied', async () => {
    const app = express();
    app.get('/pay/:address', paymentRateLimiter(), (_req, res) => res.json({ ok: true }));

    let lastStatus;
    for (let i = 0; i < 11; i++) {
      lastStatus = (await request(app).get('/pay/GADDR7')).status;
    }
    expect(lastStatus).toBe(429);
  });

  it('treats a missing address param as its own shared bucket key', async () => {
    const app = express();
    app.get('/pay', paymentRateLimiter(1, 60_000), (_req, res) => res.json({ ok: true }));

    const first = await request(app).get('/pay');
    const second = await request(app).get('/pay');

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
  });

  it('propagates a thrown error from a downstream handler instead of swallowing it', async () => {
    const app = express();
    app.get(
      '/pay/:address',
      paymentRateLimiter(10, 60_000),
      () => {
        throw new Error('downstream failure');
      }
    );
    // eslint-disable-next-line no-unused-vars
    app.use((err, _req, res, _next) => {
      res.status(500).json({ error: err.message });
    });

    const res = await request(app).get('/pay/GADDR8');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('downstream failure');
  });

  it('calls next() without a body when under the limit', async () => {
    const app = express();
    let nextCalled = false;
    app.get(
      '/pay/:address',
      paymentRateLimiter(10, 60_000),
      (_req, res) => {
        nextCalled = true;
        res.status(204).end();
      }
    );

    const res = await request(app).get('/pay/GADDR9');
    expect(res.status).toBe(204);
    expect(nextCalled).toBe(true);
  });
});
