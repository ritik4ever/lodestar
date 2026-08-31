import { vi, describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use a shared in-memory store for aggregation testing
const sharedStore = new Map();

// Mock RedisStore to use our shared in-memory store
vi.mock('rate-limit-redis', () => {
    return {
        RedisStore: class {
            constructor() {
                return {
                    async increment(key) {
                        const val = (sharedStore.get(key) || 0) + 1;
                        sharedStore.set(key, val);
                        return { totalHits: val, resetTime: undefined };
                    },
                    async decrement(key) {
                        const val = Math.max(0, (sharedStore.get(key) || 0) - 1);
                        sharedStore.set(key, val);
                    },
                    async resetKey(key) {
                        sharedStore.delete(key);
                    },
                    async init() { /* do nothing */ }
                };
            }
        }
    };
});

// Mock config to enable Redis (which triggers RedisStore usage)
vi.mock('../config.js', () => ({
    default: {
        redisUrl: 'redis://localhost:6379',
        rateLimit: { windowMs: 60_000, max: 10 },
        logLevel: 'info',
        nodeEnv: 'test',
    },
}));

// Mock logger
vi.mock('../lib/logger.js', () => ({
    default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// Import limiter AFTER config mock
import { writeRateLimiter } from './rateLimiter.js';

function makeApp() {
    const app = express();
    app.post('/write', writeRateLimiter(10, 60_000), (_req, res) => {
        res.json({ ok: true });
    });
    return app;
}

describe('writeRateLimiter Redis Aggregation', () => {
    beforeEach(async () => {
        sharedStore.clear();
    });

    it('shares rate limits across multiple instances', async () => {
        const app1 = makeApp();
        const app2 = makeApp();

        // Aggregate limit is 10.
        // 5 requests on app1, 5 on app2.
        for (let i = 0; i < 5; i++) {
            const res1 = await request(app1).post('/write').send({});
            expect(res1.status).toBe(200);

            const res2 = await request(app2).post('/write').send({});
            expect(res2.status).toBe(200);
        }

        // 11th request on app1 should be limited
        const res = await request(app1).post('/write').send({});
        expect(res.status).toBe(429);
        expect(res.body.code).toBe('RATE_LIMITED');
    });
});
