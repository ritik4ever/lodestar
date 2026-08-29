import { ContractError } from './ContractError.js';

export class SimulationError extends ContractError {
  constructor(message, detailsOrOptions, maybeCause) {
    const isOptions =
      detailsOrOptions &&
      typeof detailsOrOptions === 'object' &&
      ('operation' in detailsOrOptions || 'cause' in detailsOrOptions || 'safeInputs' in detailsOrOptions);
    const options = isOptions ? detailsOrOptions : { details: detailsOrOptions, cause: maybeCause };
    super(message, { code: 'SIMULATION_FAILED', statusCode: 400, ...options });
    this.name = 'SimulationError';
    if (options.details !== undefined) this.details = options.details;
  }
}

export class TransactionFailedError extends ContractError {
  constructor(message, hashOrOptions, details, cause) {
    let options = {};
    if (
      hashOrOptions &&
      typeof hashOrOptions === 'object' &&
      ('operation' in hashOrOptions || 'cause' in hashOrOptions || 'safeInputs' in hashOrOptions)
    ) {
      options = hashOrOptions;
    } else {
      options = { hash: hashOrOptions, details, cause };
    }
    super(message, { code: 'TRANSACTION_FAILED', statusCode: 400, ...options });
    this.name = 'TransactionFailedError';
    if (options.hash) this.hash = options.hash;
    if (options.details !== undefined) this.details = options.details;
  }
}

export class TransactionTimeoutError extends ContractError {
  constructor(message, hashOrOptions, cause) {
    let options = {};
    if (
      hashOrOptions &&
      typeof hashOrOptions === 'object' &&
      ('operation' in hashOrOptions || 'cause' in hashOrOptions || 'safeInputs' in hashOrOptions)
    ) {
      options = hashOrOptions;
    } else {
      options = { hash: hashOrOptions, cause };
    }
    super(message, { code: 'TRANSACTION_TIMEOUT', statusCode: 504, ...options });
    this.name = 'TransactionTimeoutError';
    if (options.hash) this.hash = options.hash;
  }
}

export class ReturnValueParseError extends ContractError {
  constructor(message, hashOrOptions, cause) {
    let options = {};
    if (
      hashOrOptions &&
      typeof hashOrOptions === 'object' &&
      ('operation' in hashOrOptions || 'cause' in hashOrOptions || 'safeInputs' in hashOrOptions)
    ) {
      options = hashOrOptions;
    } else {
      options = { hash: hashOrOptions, cause };
    }
    super(message, { code: 'RETURN_VALUE_PARSE_FAILED', statusCode: 502, ...options });
    this.name = 'ReturnValueParseError';
    if (options.hash) this.hash = options.hash;
    if (options.cause) this.cause = options.cause;
  }
}

/**
 * Thrown when an RPC call exhausts its retry budget against a throttled or
 * failing endpoint. The original error is attached as `cause` for diagnostics.
 */
export class RpcThrottledError extends ContractError {
  constructor(message, attemptsOrOptions, cause) {
    let options = {};
    if (
      attemptsOrOptions &&
      typeof attemptsOrOptions === 'object' &&
      ('operation' in attemptsOrOptions || 'cause' in attemptsOrOptions || 'safeInputs' in attemptsOrOptions)
    ) {
      options = attemptsOrOptions;
    } else {
      options = { attempts: attemptsOrOptions, cause };
    }
    super(message, { code: 'RPC_THROTTLED', statusCode: 503, ...options });
    this.name = 'RpcThrottledError';
    this.attempts = options.attempts;
    if (options.cause) this.cause = options.cause;
  }
}

/**
 * Thrown when an RPC call fails due to network, transport, or upstream JSON-RPC errors.
 */
export class RpcError extends ContractError {
  constructor(message, options = {}) {
    super(message, { code: options.code || 'RPC_FAILED', statusCode: options.statusCode || 502, ...options });
    this.name = 'RpcError';
  }
}

/**
 * Thrown when file persistence (e.g. pending-transactions.json) or storage operations fail.
 */
export class StorageError extends ContractError {
  constructor(message, options = {}) {
    super(message, { code: options.code || 'STORAGE_FAILED', statusCode: options.statusCode || 502, ...options });
    this.name = 'StorageError';
  }
}

/**
 * Thrown when an external dependency (like a 3rd party API) fails.
 */
export class ExternalProviderError extends ContractError {
  constructor(message, options = {}) {
    super(message, {
      code: options.code || 'EXTERNAL_PROVIDER_FAILED',
      statusCode: options.statusCode || 502,
      ...options,
    });
    this.name = 'ExternalProviderError';
  }
}

