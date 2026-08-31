import crypto from 'node:crypto';

/**
 * Middleware that assigns a unique request ID to every incoming request.
 *
 * If the client sends an `X-Request-Id` header, that value is preserved
 * so upstream proxies/clients can set their own correlation IDs.
 * Otherwise, a new UUID v4 is generated via `crypto.randomUUID()`.
 *
 * The request ID is exposed on:
 *   - `req.requestId` — available to all downstream middleware/routes
 *   - `X-Request-Id` response header — so the client can capture it
 */
export default function requestIdMiddleware(req, res, next) {
  req.requestId = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}
