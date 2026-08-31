import { randomUUID } from 'node:crypto';
import pinoHttp from 'pino-http';
import logger, { requestContext } from '../lib/logger.js';

function getRequestId(req) {
  const inboundId = req.headers['x-request-id'];

  if (typeof inboundId === 'string' && inboundId.trim()) {
    return inboundId.trim();
  }

  return randomUUID();
}

export function createRequestLogger(baseLogger = logger) {
  return pinoHttp({
    logger: baseLogger,
    genReqId(req, res) {
      const requestId = getRequestId(req);
      res.setHeader('X-Request-Id', requestId);
      return requestId;
    },
  });
}

export const requestLogger = createRequestLogger();

export class ExternalDependencyError extends Error {
  constructor(operation, safeInputs, cause) {
    const message = `${operation} failed`;
    super(message, cause ? { cause } : undefined);
    this.name = 'ExternalDependencyError';
    this.operation = operation;
    this.safeInputs = safeInputs ?? {};
    // Preserve original cause for diagnostics (Node 22+ supports cause natively)
    this.cause = cause;
    this.code = 'EXTERNAL_DEPENDENCY_ERROR';
  }
}

const TYPED_ERROR_NAMES = new Set([
  'ContractError',
  'SimulationError',
  'TransactionFailedError',
  'TransactionTimeoutError',
  'ReturnValueParseError',
  'RpcThrottledError',
  'ExternalDependencyError',
]);

const TYPED_ERROR_CODES = new Set([
  'SIMULATION_FAILED',
  'TRANSACTION_FAILED',
  'TRANSACTION_TIMEOUT',
  'RETURN_VALUE_PARSE_FAILED',
  'RPC_THROTTLED',
  'EXTERNAL_DEPENDENCY_ERROR',
]);

export function wrapExternalError(operation, safeInputs, err) {
  if (!err) return err;
  if (err instanceof ExternalDependencyError) return err;
  // Do not re-wrap already-typed domain errors (ContractError hierarchy)
  if (err.name && TYPED_ERROR_NAMES.has(err.name)) return err;
  if (err.code && TYPED_ERROR_CODES.has(err.code)) return err;
  return new ExternalDependencyError(operation, safeInputs, err);
}

export function isExternalDependencyError(err) {
  return err instanceof ExternalDependencyError;
}

export function requestContextMiddleware(req, res, next) {
  const requestId = req.id;

  res.setHeader('X-Request-Id', requestId);

  const originalJson = res.json.bind(res);

  res.json = (body) => {
    if (
      res.statusCode >= 400 &&
      body &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      body.requestId === undefined
    ) {
      body = { ...body, requestId };
    }

    return originalJson(body);
  };

  // Ensure async errors are captured and wrapped so raw driver errors never leak
  requestContext.run({ requestId }, () => {
    try {
      const maybePromise = next();
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch((err) => {
          const wrapped = wrapExternalError('requestContext', { requestId }, err);
          next(wrapped);
        });
      }
    } catch (err) {
      next(wrapExternalError('requestContext', { requestId }, err));
    }
  });
}

/**
 * Express error-handling middleware to be mounted after routes.
 * Wraps any raw external failure (RPC, Redis, contract driver) in a typed
 * ExternalDependencyError, preserves the original cause for logs, and returns
 * a sanitized response that never exposes driver internals.
 */
export function requestContextErrorHandler(err, req, res, _next) {
  const storeRequestId = requestContext.getStore()?.requestId;
  const requestId = req.id || req.headers['x-request-id'] || storeRequestId;

  // Normalize to typed error — preserve already-typed errors (allowlist, not generic Error with code)
  let typedErr = err;
  const isAlreadyTyped =
    typedErr instanceof ExternalDependencyError ||
    (typedErr && TYPED_ERROR_NAMES.has(typedErr.name)) ||
    (typedErr && TYPED_ERROR_CODES.has(typedErr.code));

  if (!isAlreadyTyped) {
    typedErr = wrapExternalError('external.dependency', { requestId, path: req.path, method: req.method }, err);
  }

  // Log full context internally (cause + operation + safeInputs) — never to client
  logger.error(
    {
      err: typedErr.cause ?? typedErr,
      operation: typedErr.operation ?? 'external.dependency',
      safeInputs: typedErr.safeInputs ?? { requestId },
      requestId,
      code: typedErr.code,
    },
    `${typedErr.operation || 'external.dependency'} failed`
  );

  if (res.headersSent) {
    return _next(typedErr);
  }

  // Map typed codes to appropriate HTTP status without leaking details
  let status = 500;
  if (typedErr.code === 'RPC_THROTTLED' || typedErr.code === 'EXTERNAL_DEPENDENCY_ERROR') {
    status = 503;
  } else if (typedErr.code === 'TRANSACTION_TIMEOUT') {
    status = 504;
  } else if (typedErr instanceof ExternalDependencyError) {
    status = 503;
  }

  const body = {
    error: 'Internal server error',
    code: typedErr.code || 'INTERNAL_ERROR',
  };

  // requestContextMiddleware's res.json wrapper will inject requestId, but ensure fallback if status not >=400? Always include.
  if (requestId && body.requestId === undefined) {
    body.requestId = requestId;
  }

  res.status(status).json(body);
}
