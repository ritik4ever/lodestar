import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { Redis } from 'ioredis';
import config from '../config.js';
import logger from '../lib/logger.js';

let client;
if (config.redisUrl) {
  client = new Redis(config.redisUrl);
}

/**
 * express-rate-limit middleware for public write routes.
 *
 * Throttles spammy submissions before they reach the on-chain contracts.
 * Keyed by client IP. Limits default to the values in config.rateLimit but
 * can be overridden per-route (e.g. for tests or stricter endpoints).
 *
 * @param {number} [max]      Max requests allowed per window.
 * @param {number} [windowMs] Window length in milliseconds.
 * @returns {import('express').RequestHandler} Express middleware safe to
 *   share across concurrent requests. Redis-backed counters are atomic.
 * @throws {TypeError} If the supplied limit or window is not accepted by
 *   express-rate-limit.
 */
export function writeRateLimiter(
  max = config.rateLimit.max,
  windowMs = config.rateLimit.windowMs,
) {
  let store;
  if (client) {
    store = new RedisStore({
      sendCommand: (command, ...args) => client.call(command, ...args),
    });
  }
  return rateLimit({
    windowMs,
    limit: max,
    store,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      logger.warn(
        { ip: req.ip, path: req.originalUrl, max, windowMs },
        'Write rate limit exceeded',
      );
      res.status(429).json({
        error: 'Too many requests. Please slow down and try again later.',
        code: 'RATE_LIMITED',
        retryAfterMs: windowMs,
      });
    },
  });
}

/**
 * The shared Redis client, or undefined when REDIS_URL is unset.
 * Exposed so the readiness probe can ping the same connection the rate limiter
 * actually uses, rather than opening a second one (#841).
 */
export function getRateLimiterRedis() {
  return client;
}
