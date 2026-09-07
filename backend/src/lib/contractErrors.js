import { ContractError } from './ContractError.js';

export const REGISTRY_ERROR_CODES = Object.freeze({
  1: { code: 'INVALID_NAME', message: 'Service name must be 3-64 characters' },
  2: { code: 'INVALID_DESCRIPTION', message: 'Service description must be 10-256 characters' },
  3: { code: 'DUPLICATE_SERVICE', message: 'Active service with same provider and endpoint already exists' },
  4: { code: 'SERVICE_NOT_FOUND', message: 'Service not found' },
  5: { code: 'AGENTS_CONTRACT_NOT_CONFIGURED', message: 'Agents contract is not configured for this registry' },
  6: { code: 'CALLER_NOT_REGISTERED_AGENT', message: 'Caller is not a registered agent' },
  7: { code: 'REPUTATION_VOTE_COOLDOWN', message: 'This agent has voted on this service too recently' },
  8: { code: 'PROVIDER_MISMATCH', message: 'Only the provider that registered this service can deactivate it' },
  9: { code: 'CATEGORY_INDEX_NOT_FOUND', message: 'Category index not found' },
  10: { code: 'INVALID_ENDPOINT', message: 'Service endpoint must be at most 256 characters' },
  11: { code: 'INVALID_CATEGORY', message: 'Service category must be a supported value of 1-32 characters' },
});

const REGISTRY_ERROR_PATTERNS = [
  /Error\(Contract,\s*#?(\d+)\)/i,
  /ContractError\((\d+)\)/i,
  /contract error[^\d]*(\d+)/i,
  /contract code[^\d]*(\d+)/i,
];

const REGISTRY_ERROR_CODE_KEYS = new Set([
  'contractCode',
  'contract_code',
  'contractErrorCode',
  'contract_error_code',
  'errorCode',
  'error_code',
]);

const REGISTRY_ERROR_CONTAINER_KEYS = new Set([
  'error',
  'message',
  'result',
  'errorResult',
  'diagnosticEvents',
  'events',
  'details',
  'cause',
]);

function registryCodeFromNumber(value) {
  if (Number.isInteger(value) && REGISTRY_ERROR_CODES[value]) return value;
  return null;
}

function registryCodeFromString(value) {
  for (const pattern of REGISTRY_ERROR_PATTERNS) {
    const match = pattern.exec(value);
    if (!match) continue;
    const code = registryCodeFromNumber(Number(match[1]));
    if (code !== null) return code;
  }
  return null;
}

export function extractRegistryErrorCode(value, seen = new Set()) {
  const numericCode = registryCodeFromNumber(value);
  if (numericCode !== null) return numericCode;

  if (typeof value === 'bigint') {
    return registryCodeFromNumber(Number(value));
  }
  if (typeof value === 'string') {
    return registryCodeFromString(value);
  }
  if (!value || typeof value !== 'object' || seen.has(value)) {
    return null;
  }
  seen.add(value);

  for (const key of REGISTRY_ERROR_CODE_KEYS) {
    const numericCode = registryCodeFromNumber(Number(value[key]));
    if (numericCode !== null) return numericCode;
  }

  if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
    const code = registryCodeFromString(value.toString());
    if (code !== null) return code;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const code = extractRegistryErrorCode(item, seen);
      if (code !== null) return code;
    }
  } else {
    for (const key of REGISTRY_ERROR_CONTAINER_KEYS) {
      const code = extractRegistryErrorCode(value[key], seen);
      if (code !== null) return code;
    }
  }

  return null;
}

export function registryErrorFromCode(numericCode) {
  const meta = REGISTRY_ERROR_CODES[numericCode];
  if (!meta) return null;
  const err = new ContractError(meta.message, meta.code);
  err.registryErrorCode = numericCode;
  return err;
}

export function registryErrorFromHostError(details) {
  return registryErrorFromCode(extractRegistryErrorCode(details));
}

export class SimulationError extends ContractError {
  constructor(message, details, cause) {
    super(message, 'SIMULATION_FAILED');
    this.name = 'SimulationError';
    if (details !== undefined) this.details = details;
    if (cause) this.cause = cause;
  }
}

export class TransactionFailedError extends ContractError {
  constructor(message, hash, details, cause) {
    super(message, 'TRANSACTION_FAILED');
    this.name = 'TransactionFailedError';
    if (hash) this.hash = hash;
    if (details !== undefined) this.details = details;
    if (cause) this.cause = cause;
  }
}

export class TransactionTimeoutError extends ContractError {
  constructor(message, hash, cause) {
    super(message, 'TRANSACTION_TIMEOUT');
    this.name = 'TransactionTimeoutError';
    if (hash) this.hash = hash;
    if (cause) this.cause = cause;
  }
}

export class ReturnValueParseError extends ContractError {
  constructor(message, hash, cause) {
    super(message, 'RETURN_VALUE_PARSE_FAILED');
    this.name = 'ReturnValueParseError';
    if (hash) this.hash = hash;
    if (cause) this.cause = cause;
  }
}

/**
 * Thrown when an RPC call exhausts its retry budget against a throttled or
 * failing endpoint. The original error is attached as `cause` for diagnostics.
 */
export class RpcThrottledError extends ContractError {
  constructor(message, attempts, cause) {
    super(message, 'RPC_THROTTLED');
    this.name = 'RpcThrottledError';
    this.attempts = attempts;
    if (cause) this.cause = cause;
  }
}
