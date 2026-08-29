import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ContractError, handleContractError } from './ContractError.js';
import {
  SimulationError,
  TransactionFailedError,
  TransactionTimeoutError,
  ReturnValueParseError,
  RpcThrottledError,
  RpcError,
  StorageError,
  ExternalProviderError,
} from './contractErrors.js';

describe('ContractError and Typed Error Hierarchy', () => {
  it('instantiates ContractError with string code', () => {
    const err = new ContractError('Something failed', 'SOME_CODE');
    assert.equal(err.name, 'ContractError');
    assert.equal(err.message, 'Something failed');
    assert.equal(err.code, 'SOME_CODE');
    assert.equal(err.operation, 'unknown');
    assert.equal(err.isOperational, true);
  });

  it('instantiates ContractError with rich options', () => {
    const cause = new Error('Socket closed');
    const err = new ContractError('Safe error message', {
      code: 'CUSTOM_CODE',
      operation: 'customOp',
      safeInputs: { id: 123 },
      cause,
      statusCode: 502,
      details: 'extra detail',
    });

    assert.equal(err.message, 'Safe error message');
    assert.equal(err.code, 'CUSTOM_CODE');
    assert.equal(err.operation, 'customOp');
    assert.deepEqual(err.safeInputs, { id: 123 });
    assert.equal(err.cause, cause);
    assert.equal(err.statusCode, 502);
    assert.equal(err.details, 'extra detail');
  });

  it('instantiates SimulationError with options and sets code SIMULATION_FAILED', () => {
    const rawSim = { error: 'HostError: Error(Contract, #1)' };
    const err = new SimulationError('Simulation failed: HostError', {
      operation: 'simulateTx',
      details: rawSim.error,
      cause: rawSim,
    });

    assert.equal(err.name, 'SimulationError');
    assert.equal(err.code, 'SIMULATION_FAILED');
    assert.equal(err.operation, 'simulateTx');
    assert.equal(err.details, rawSim.error);
    assert.equal(err.cause, rawSim);
    assert.equal(err.statusCode, 400);
  });

  it('instantiates TransactionFailedError with options and sets code TRANSACTION_FAILED', () => {
    const err = new TransactionFailedError('Transaction failed on-chain', {
      operation: 'sendTx',
      hash: 'abc123hash',
      details: { status: 'FAILED' },
      cause: new Error('tx failed'),
    });

    assert.equal(err.name, 'TransactionFailedError');
    assert.equal(err.code, 'TRANSACTION_FAILED');
    assert.equal(err.hash, 'abc123hash');
    assert.equal(err.operation, 'sendTx');
    assert.equal(err.statusCode, 400);
  });

  it('instantiates TransactionTimeoutError with options and sets code TRANSACTION_TIMEOUT', () => {
    const err = new TransactionTimeoutError('Transaction not confirmed', {
      operation: 'getTx',
      hash: 'abc123hash',
    });

    assert.equal(err.name, 'TransactionTimeoutError');
    assert.equal(err.code, 'TRANSACTION_TIMEOUT');
    assert.equal(err.hash, 'abc123hash');
    assert.equal(err.statusCode, 504);
  });

  it('instantiates ReturnValueParseError with options and sets code RETURN_VALUE_PARSE_FAILED', () => {
    const parseCause = new Error('invalid scval');
    const err = new ReturnValueParseError('Parse failed', {
      operation: 'parseReturn',
      hash: 'abc123hash',
      cause: parseCause,
    });

    assert.equal(err.name, 'ReturnValueParseError');
    assert.equal(err.code, 'RETURN_VALUE_PARSE_FAILED');
    assert.equal(err.statusCode, 502);
    assert.equal(err.cause, parseCause);
  });

  it('instantiates RpcThrottledError and sets code RPC_THROTTLED', () => {
    const raw429 = new Error('Too many requests');
    const err = new RpcThrottledError('RPC throttled', {
      operation: 'rpc.getAccount',
      attempts: 5,
      cause: raw429,
    });

    assert.equal(err.name, 'RpcThrottledError');
    assert.equal(err.code, 'RPC_THROTTLED');
    assert.equal(err.attempts, 5);
    assert.equal(err.statusCode, 503);
    assert.equal(err.cause, raw429);
  });

  it('instantiates RpcError and sets code RPC_FAILED and 502 status', () => {
    const networkErr = new Error('ECONNRESET');
    const err = new RpcError('RPC connection lost', {
      operation: 'rpc.simulateTransaction',
      cause: networkErr,
    });

    assert.equal(err.name, 'RpcError');
    assert.equal(err.code, 'RPC_FAILED');
    assert.equal(err.statusCode, 502);
    assert.equal(err.cause, networkErr);
  });

  it('instantiates StorageError and sets code STORAGE_FAILED and 502 status', () => {
    const fsErr = new Error('EACCES permission denied');
    const err = new StorageError('Disk persistence failed', {
      operation: 'dumpPendingTransactions',
      safeInputs: { file: 'pending-transactions.json' },
      cause: fsErr,
    });

    assert.equal(err.name, 'StorageError');
    assert.equal(err.code, 'STORAGE_FAILED');
    assert.equal(err.statusCode, 502);
  });

  it('instantiates ExternalProviderError and sets code EXTERNAL_PROVIDER_FAILED', () => {
    const providerErr = new Error('API timeout');
    const err = new ExternalProviderError('Upstream search failed', {
      operation: 'serperSearch',
      cause: providerErr,
    });

    assert.equal(err.name, 'ExternalProviderError');
    assert.equal(err.code, 'EXTERNAL_PROVIDER_FAILED');
    assert.equal(err.statusCode, 502);
  });
});

describe('handleContractError response mapping and sanitization', () => {
  function createMockResponse() {
    const res = {
      statusCode: 200,
      body: null,
      locals: {},
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      },
    };
    return res;
  }

  it('maps TRANSACTION_TIMEOUT to HTTP 504', () => {
    const res = createMockResponse();
    const err = new TransactionTimeoutError('Polling timed out', 'hash123');
    handleContractError(err, res, 'Fallback', 'FALLBACK_CODE');

    assert.equal(res.statusCode, 504);
    assert.deepEqual(res.body, {
      error: 'Polling timed out',
      code: 'TRANSACTION_TIMEOUT',
    });
  });

  it('maps RPC_THROTTLED to HTTP 503', () => {
    const res = createMockResponse();
    const err = new RpcThrottledError('Throttled', 5);
    handleContractError(err, res);

    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, {
      error: 'Throttled',
      code: 'RPC_THROTTLED',
    });
  });

  it('maps RPC_FAILED and STORAGE_FAILED to HTTP 502', () => {
    const res = createMockResponse();
    const err = new RpcError('RPC endpoint failed');
    handleContractError(err, res);

    assert.equal(res.statusCode, 502);
    assert.deepEqual(res.body, {
      error: 'RPC endpoint failed',
      code: 'RPC_FAILED',
    });
  });

  it('maps SERVICE_NOT_FOUND to HTTP 404', () => {
    const res = createMockResponse();
    const err = new ContractError('Service 123 not found', 'SERVICE_NOT_FOUND');
    handleContractError(err, res);

    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, {
      error: 'Service 123 not found',
      code: 'SERVICE_NOT_FOUND',
    });
  });

  it('maps ALREADY_INACTIVE and DUPLICATE_SERVICE to HTTP 409', () => {
    const res = createMockResponse();
    const err = new ContractError('Service already inactive', 'ALREADY_INACTIVE');
    handleContractError(err, res);

    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.body, {
      error: 'Service already inactive',
      code: 'ALREADY_INACTIVE',
    });
  });

  it('maps PROVIDER_MISMATCH to HTTP 403', () => {
    const res = createMockResponse();
    const err = new ContractError('Only provider may deactivate', 'PROVIDER_MISMATCH');
    handleContractError(err, res);

    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, {
      error: 'Only provider may deactivate',
      code: 'PROVIDER_MISMATCH',
    });
  });

  it('sanitizes raw unexpected driver error and returns HTTP 500 without leaking driver internals', () => {
    const res = createMockResponse();
    const rawDriverError = new Error('ioredis connection refused on 127.0.0.1:6379 password: secret');
    handleContractError(rawDriverError, res, 'Failed to process request', 'PROCESS_ERROR');

    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, {
      error: 'Failed to process request',
      code: 'PROCESS_ERROR',
    });
    assert.equal(JSON.stringify(res.body).includes('ioredis'), false);
    assert.equal(JSON.stringify(res.body).includes('127.0.0.1'), false);
    assert.equal(JSON.stringify(res.body).includes('secret'), false);
  });

  it('includes requestId from res.locals if present', () => {
    const res = createMockResponse();
    res.locals.requestId = 'req-xyz-789';
    const err = new ContractError('Simulation rejected', 'SIMULATION_FAILED');
    handleContractError(err, res);

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, {
      error: 'Simulation rejected',
      code: 'SIMULATION_FAILED',
      requestId: 'req-xyz-789',
    });
  });
});
