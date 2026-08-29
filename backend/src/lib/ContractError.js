let logger = console;
try {
  const loggerMod = await import('./logger.js');
  logger = loggerMod.default || console;
} catch {
  logger = {
    warn: () => {},
    error: () => {},
    info: () => {},
    debug: () => {},
  };
}

export class ContractError extends Error {
  /**
   * @param {string} message - Client-safe error message
   * @param {string|{ code?: string, operation?: string, safeInputs?: object, cause?: any, statusCode?: number, details?: any, isOperational?: boolean }} [optionsOrCode]
   */
  constructor(message, optionsOrCode) {
    super(message);
    this.name = 'ContractError';

    if (typeof optionsOrCode === 'string') {
      this.code = optionsOrCode;
      this.operation = 'unknown';
      this.safeInputs = undefined;
      this.statusCode = undefined;
      this.details = undefined;
      this.isOperational = true;
    } else if (optionsOrCode && typeof optionsOrCode === 'object') {
      this.code = optionsOrCode.code || 'CONTRACT_ERROR';
      this.operation = optionsOrCode.operation || 'unknown';
      this.safeInputs = optionsOrCode.safeInputs;
      this.cause = optionsOrCode.cause;
      this.statusCode = optionsOrCode.statusCode;
      this.details = optionsOrCode.details;
      this.isOperational = optionsOrCode.isOperational !== undefined ? optionsOrCode.isOperational : true;
    } else {
      this.code = 'CONTRACT_ERROR';
      this.operation = 'unknown';
      this.isOperational = true;
    }
  }
}

export function handleContractError(err, res, defaultMessage = 'Internal server error', defaultCode = 'INTERNAL_ERROR') {
  if (err instanceof ContractError) {
    logger.warn(
      {
        errName: err.name,
        code: err.code,
        operation: err.operation,
        safeInputs: err.safeInputs,
        details: err.details,
        cause: err.cause?.message ?? (err.cause ? String(err.cause) : undefined),
        stack: err.stack,
      },
      `Contract/RPC operation failed: ${err.message}`
    );

    let status = err.statusCode;
    if (!status) {
      if (err.code === 'TRANSACTION_TIMEOUT') {
        status = 504;
      } else if (err.code === 'RPC_THROTTLED') {
        status = 503;
      } else if (
        err.code === 'RPC_FAILED' ||
        err.code === 'RPC_ERROR' ||
        err.code === 'SERVICE_READ_FAILED' ||
        err.code === 'STORAGE_FAILED'
      ) {
        status = 502;
      } else if (err.code === 'SERVICE_NOT_FOUND' || err.code === 'NOT_FOUND') {
        status = 404;
      } else if (err.code === 'ALREADY_INACTIVE' || err.code === 'CONFLICT' || err.code === 'DUPLICATE_SERVICE') {
        status = 409;
      } else if (err.code === 'PROVIDER_MISMATCH' || err.code === 'FORBIDDEN') {
        status = 403;
      } else {
        status = 400;
      }
    }

    return res.status(status).json({
      error: err.message,
      code: err.code,
      ...(err.details !== undefined && typeof err.details === 'string' ? { details: err.details } : {}),
      ...(res?.locals?.requestId && { requestId: res.locals.requestId }),
    });
  }

  logger.error(
    {
      err,
      stack: err?.stack,
      cause: err?.cause,
    },
    `Unhandled error in route: ${defaultMessage}`
  );

  return res.status(500).json({
    error: defaultMessage,
    code: defaultCode,
    ...(res?.locals?.requestId && { requestId: res.locals.requestId }),
  });
}
