import crypto from 'crypto';
import config from '../config.js';
import logger from '../lib/logger.js';

/**
 * Express middleware that gates a route behind HMAC-SHA256 admin authentication.
 *
 * The caller must supply an `X-Admin-Key` request header whose value is the
 * hex-encoded HMAC-SHA256 of the JSON-serialised request body, keyed with
 * `config.server.secret` (`SERVER_STELLAR_SECRET`). The comparison is
 * constant-time (`crypto.timingSafeEqual`) to prevent timing side-channels.
 *
 * **Error responses (does not throw):**
 * - `401 { error, code: 'ADMIN_KEY_MISSING' }` — header absent or not a string.
 * - `401 { error, code: 'ADMIN_KEY_INVALID' }` — HMAC does not match.
 *
 * On success the middleware calls `next()` with no arguments; on failure it
 * terminates the response (returns `res.status(401).json(…)`) and does **not**
 * call `next`.
 *
 * **Concurrency:** Stateless — reads only from `req`, `config`, and Node's
 * `crypto` module. Safe to use on any number of concurrent requests without
 * external synchronisation.
 *
 * @param {import('express').Request} req  - Express request; must have a parsed
 *   JSON body (`express.json()` or equivalent must run before this middleware).
 * @param {import('express').Response} res - Express response.
 * @param {import('express').NextFunction} next - Called on successful auth.
 * @returns {void}
 */
export function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (!key || typeof key !== 'string') {
    logger.warn({ path: req.path }, 'Missing X-Admin-Key header');
    return res.status(401).json({
      error: 'Missing X-Admin-Key header',
      code: 'ADMIN_KEY_MISSING',
    });
  }

  const body = JSON.stringify(req.body);
  const expected = crypto
    .createHmac('sha256', config.server.secret)
    .update(body)
    .digest('hex');

  const keyBuf = Buffer.from(key);
  const expBuf = Buffer.from(expected);

  if (keyBuf.length !== expBuf.length || !crypto.timingSafeEqual(keyBuf, expBuf)) {
    logger.warn({ path: req.path }, 'Invalid X-Admin-Key');
    return res.status(401).json({
      error: 'Invalid admin key',
      code: 'ADMIN_KEY_INVALID',
    });
  }

  next();
}
