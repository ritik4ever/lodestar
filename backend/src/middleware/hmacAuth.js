import crypto from 'crypto';
import config from '../config.js';
import logger from '../lib/logger.js';

/**
 * Error thrown when the HMAC verification pipeline fails for an internal
 * reason (body serialization or crypto failure) rather than a bad signature.
 * Carries the failing operation and preserves the original cause so callers
 * can debug without leaking raw driver errors into responses.
 */
export class HmacAuthError extends Error {
  constructor(message, operation, cause) {
    super(message);
    this.name = 'HmacAuthError';
    this.code = 'HMAC_ERROR';
    this.operation = operation;
    if (cause) this.cause = cause;
  }
}

/**
 * HMAC-SHA256 request signing middleware.
 * Requires X-Lodestar-Signature header matching HMAC-SHA256(body, secret).
 */
export function hmacAuth(req, res, next) {
  const signature = req.headers['x-lodestar-signature'];
  if (!signature || typeof signature !== 'string') {
    logger.warn({ path: req.path }, 'Missing X-Lodestar-Signature header');
    return res.status(401).json({
      error: 'Missing X-Lodestar-Signature header',
      code: 'HMAC_MISSING',
    });
  }

  let expected;
  let sigBuf;
  let expBuf;
  try {
    const body = JSON.stringify(req.body);
    expected = crypto
      .createHmac('sha256', config.server.secret)
      .update(body)
      .digest('hex');
    sigBuf = Buffer.from(signature);
    expBuf = Buffer.from(expected);
  } catch (cause) {
    const err = new HmacAuthError(
      'Failed to compute HMAC signature for request',
      'compute_hmac',
      cause,
    );
    logger.error(
      { path: req.path, operation: err.operation, err: cause },
      err.message,
    );
    return res.status(500).json({
      error: 'Signature verification failed',
      code: 'HMAC_ERROR',
    });
  }

  let valid;
  try {
    valid =
      sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
  } catch (cause) {
    const err = new HmacAuthError(
      'Failed to compare request signature',
      'compare_signatures',
      cause,
    );
    logger.error(
      { path: req.path, operation: err.operation, err: cause },
      err.message,
    );
    return res.status(500).json({
      error: 'Signature verification failed',
      code: 'HMAC_ERROR',
    });
  }

  if (!valid) {
    logger.warn({ path: req.path }, 'Invalid X-Lodestar-Signature');
    return res.status(401).json({
      error: 'Invalid signature',
      code: 'HMAC_INVALID',
    });
  }

  next();
}
