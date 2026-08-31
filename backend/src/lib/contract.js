import pkg from '@stellar/stellar-sdk';
const {
  Account,
  Contract,
  Keypair,
  Transaction,
  TransactionBuilder,
  BASE_FEE,
  xdr,
  Address,
  StrKey,
  nativeToScVal,
  scValToNative,
  rpc,
} = pkg;
import PQueue from 'p-queue';
import { randomUUID } from 'node:crypto';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import config from '../config.js';
import { getStellarServer, getNetworkPassphrase } from './stellar.js';
import logger from './logger.js';
import { ContractError } from './ContractError.js';
import {
  ReturnValueParseError,
  SimulationError,
  TransactionFailedError,
  TransactionTimeoutError,
} from './contractErrors.js';
import {
  trackPendingTransaction,
  removePendingTransaction,
  getPendingTransactionCount,
  getPendingTransactions,
  dumpPendingTransactions,
  resumePendingTransactions,
  __resetPendingTransactions,
} from './pendingTx.js';

// Re-export pendingTx functions so contract.js public interface is unchanged
export {
  getPendingTransactionCount,
  getPendingTransactions,
  dumpPendingTransactions,
  resumePendingTransactions,
  __resetPendingTransactions,
};


const TIMEOUT = 30;
const REGISTRY_SUBMIT_TOKEN_TTL_MS = 10 * 60 * 1000;

// Must match `const MAX_TTL: u32 = 3110400` in contract/src/lib.rs.
// Persistent storage entries are extended to this many ledgers on every write.
export const SERVICE_MAX_TTL = 3_110_400;

// Warn providers when fewer than this many ledgers remain before their listing
// could expire (~18 days at 5 s/ledger = 10 % of SERVICE_MAX_TTL).
// Note: any reputation update resets the TTL, so this is a conservative estimate
// based solely on registered_at; actual expiry may be later.
export const SERVICE_TTL_WARNING_LEDGERS = 311_040;

const rpcMetrics = {
  getAccount: 0,
  simulateTransaction: 0,
  sendTransaction: 0,
  getTransaction: 0,
};

function logRpcCall(method, latencyMs) {
  rpcMetrics[method]++;
  logger.debug({ method, latencyMs, totalCalls: rpcMetrics[method] }, 'RPC call completed');
}

export function getRpcMetrics() {
  return { ...rpcMetrics };
}

export function resetRpcMetrics() {
  rpcMetrics.getAccount = 0;
  rpcMetrics.simulateTransaction = 0;
  rpcMetrics.sendTransaction = 0;
  rpcMetrics.getTransaction = 0;
}

const submitQueue = new PQueue({ concurrency: 1 });
let currentSeqNum = null;
let lastSeqSyncTime = 0;
const preparedRegistrySubmissions = new Map();
let assembleTransactionForSubmit = rpc.assembleTransaction;

// Pending transaction tracking is now imported from ./pendingTx.js
// (trackPendingTransaction, removePendingTransaction, getPendingTransactionCount,
// getPendingTransactions, dumpPendingTransactions, resumePendingTransactions,
// __resetPendingTransactions).

export function __setAssembleTransactionForTest(fn) {
  assembleTransactionForSubmit = fn ?? rpc.assembleTransaction;
}

export function getSubmitQueueDepth() {
  return submitQueue.size + submitQueue.pending;
}

export async function drainSubmitQueue() {
  await submitQueue.onIdle();
}

function getContract() {
  return new Contract(config.contract.id);
}

/**
 * Allowlist of demo-agent signing keys the backend may cast reputation votes
 * with, keyed by public address. Built lazily from config so an invalid secret
 * surfaces clearly instead of crashing module load. The on-chain contract is the
 * real enforcement (require_auth + is_registered); this just bounds which agents
 * the hosted backend is willing to act for.
 */
let reputationVoters = null;
function getReputationVoters() {
  if (reputationVoters) return reputationVoters;
  reputationVoters = new Map();
  for (const secret of config.demo.voterSecrets) {
    try {
      const kp = Keypair.fromSecret(secret);
      reputationVoters.set(kp.publicKey(), kp);
    } catch {
      logger.warn('Skipping invalid reputation voter secret in config');
    }
  }
  return reputationVoters;
}

/**
 * Whether the hosted backend is permitted to sign a reputation vote on behalf
 * of `agentAddress` (i.e. it holds that demo agent's key).
 */
export function isAllowedReputationAgent(agentAddress) {
  return getReputationVoters().has(agentAddress);
}

function getAgentsContract() {
  if (!config.contract.agentsId) {
    throw new Error('AGENTS_CONTRACT_ID is not set — deploy the agents contract first');
  }
  return new Contract(config.contract.agentsId);
}

function getServerKeypair() {
  return Keypair.fromSecret(config.server.secret);
}

async function _simulateAndSubmit(operation, signer, retryCount = 0) {
  const server = getStellarServer();
  const keypair = signer ?? getServerKeypair();
  const passphrase = getNetworkPassphrase();

  const now = Date.now();
  if (retryCount > 0 || currentSeqNum === null || (now - lastSeqSyncTime > 5000)) {
    const acctStart = Date.now();
    const account = await server.getAccount(keypair.publicKey());
    logRpcCall('getAccount', Date.now() - acctStart);
    currentSeqNum = BigInt(account.sequence);
    lastSeqSyncTime = now;
  }

  const txAccount = new Account(keypair.publicKey(), currentSeqNum.toString());

  const tx = new TransactionBuilder(txAccount, {
    fee: BASE_FEE,
    networkPassphrase: passphrase,
  })
    .addOperation(operation)
    .setTimeout(TIMEOUT)
    .build();

  const simStart = Date.now();
  const simResult = await server.simulateTransaction(tx);
  logRpcCall('simulateTransaction', Date.now() - simStart);

  if (rpc.Api.isSimulationError(simResult)) {
    throw new SimulationError(`Simulation failed: ${simResult.error}`, simResult.error);
  }

  const preparedTx = assembleTransactionForSubmit(tx, simResult).build();
  preparedTx.sign(keypair);

  const sendStart = Date.now();
  const sendResult = await server.sendTransaction(preparedTx);
  logRpcCall('sendTransaction', Date.now() - sendStart);
  if (sendResult.status === 'ERROR') {
    let isBadSeq = false;
    if (sendResult.errorResultXdr) {
      try {
        const txResult = xdr.TransactionResult.fromXDR(sendResult.errorResultXdr, 'base64');
        const code = txResult.result().switch().name;
        if (code === 'txBadSeq' || code === 'txBAD_SEQ') {
          isBadSeq = true;
        }
      } catch (e) {
        // Ignore parse errors here
      }
    }
    if (!isBadSeq && (JSON.stringify(sendResult).includes('txBAD_SEQ') || JSON.stringify(sendResult).includes('txBadSeq'))) {
      isBadSeq = true;
    }

    if (isBadSeq && retryCount < 3) {
      logger.warn({ retryCount }, 'txBAD_SEQ encountered, retrying transaction');
      return _simulateAndSubmit(operation, signer, retryCount + 1);
    }
    throw new TransactionFailedError(`Transaction failed: ${JSON.stringify(sendResult.errorResult || sendResult)}`, sendResult.hash, sendResult.errorResult || sendResult);
  }

  const txHash = sendResult.hash;
  trackPendingTransaction(txHash, operation);

  logger.debug({ hash: txHash }, 'Submitted Soroban transaction');

  let getResult;
  for (let i = 0; i < 20; i++) {
    const txStart = Date.now();
    getResult = await server.getTransaction(sendResult.hash);
    logRpcCall('getTransaction', Date.now() - txStart);
    if (getResult.status !== 'NOT_FOUND') break;
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (!getResult || getResult.status === 'NOT_FOUND') {
    // Leave in pendingTransactions — the tx may still confirm on-chain
    throw new TransactionTimeoutError(`Transaction not confirmed after polling: ${sendResult.hash}`, sendResult.hash);
  }

  // Transaction confirmed (SUCCESS or FAILED) — stop tracking
  removePendingTransaction(txHash);

  if (getResult.status === 'FAILED') {
    throw new TransactionFailedError(`Transaction failed on-chain: ${sendResult.hash}`, sendResult.hash, getResult);
  }

  if (getResult.returnValue) {
    try {
      getResult.nativeReturnValue = scValToNative(getResult.returnValue);
    } catch (err) {
      throw new ReturnValueParseError(`Transaction succeeded but return value could not be parsed: ${sendResult.hash}`, sendResult.hash, err);
    }
  }

  // Optimistic increment on success
  currentSeqNum += 1n;

  return getResult;
}

export function simulateAndSubmit(operation, signer) {
  return submitQueue.add(() => _simulateAndSubmit(operation, signer, 0));
}

function prunePreparedRegistrySubmissions(now = Date.now()) {
  for (const [token, entry] of preparedRegistrySubmissions.entries()) {
    if (entry.expiresAt <= now) {
      preparedRegistrySubmissions.delete(token);
    }
  }
}

function createPreparedRegistrySubmission(action, xdrBase64) {
  prunePreparedRegistrySubmissions();
  const submitToken = randomUUID();
  preparedRegistrySubmissions.set(submitToken, {
    action,
    expiresAt: Date.now() + REGISTRY_SUBMIT_TOKEN_TTL_MS,
  });
  return { xdr: xdrBase64, submitToken };
}

async function buildUnsignedTx(operation) {
  const server = getStellarServer();
  const keypair = getServerKeypair();
  const passphrase = getNetworkPassphrase();

  const account = await server.getAccount(keypair.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: passphrase,
  })
    .addOperation(operation)
    .setTimeout(TIMEOUT)
    .build();

  const simResult = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simResult)) {
    throw new ContractError(`Simulation failed: ${simResult.error}`, 'SIMULATION_FAILED');
  }

  return assembleTransactionForSubmit(tx, simResult).build().toXDR();
}

async function simulateRead(operation) {
  const server = getStellarServer();
  const keypair = getServerKeypair();
  const passphrase = getNetworkPassphrase();

  const account = new Account(keypair.publicKey(), '0');

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: passphrase,
  })
    .addOperation(operation)
    .setTimeout(TIMEOUT)
    .build();

  const simStart = Date.now();
  const simResult = await server.simulateTransaction(tx);
  logRpcCall('simulateTransaction', Date.now() - simStart);

  if (rpc.Api.isSimulationError(simResult)) {
    throw new ContractError(`Simulation failed: ${simResult.error}`, 'SIMULATION_FAILED');
  }

  return simResult.result?.retval;
}

export async function simulateReadBatch(operations) {
  if (operations.length === 0) return [];

  const server = getStellarServer();
  const keypair = getServerKeypair();
  const passphrase = getNetworkPassphrase();

  const results = [];
  for (const op of operations) {
    const account = new Account(keypair.publicKey(), '0');
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: passphrase,
    })
      .addOperation(op)
      .setTimeout(TIMEOUT)
      .build();

    const simStart = Date.now();
    const simResult = await server.simulateTransaction(tx);
    logRpcCall('simulateTransaction', Date.now() - simStart);

    if (rpc.Api.isSimulationError(simResult)) {
      throw new ContractError(`Batch simulation failed: ${simResult.error}`, 'SIMULATION_FAILED');
    }

    results.push(simResult.result?.retval);
  }

  return results;
}


export async function listServices({ category, offset = 0, limit = 20 } = {}) {
  try {
    const contract = getContract();

    const optionArg = category
      ? nativeToScVal(category, { type: 'string' })
      : xdr.ScVal.scvVoid();

    const callOp = contract.call(
      'list_services',
      nativeToScVal(offset, { type: 'u32' }),
      nativeToScVal(limit, { type: 'u32' }),
      optionArg,
    );
    const retval = await simulateRead(callOp);
    if (!retval) return [];

    const vec = scValToNative(retval);
    if (!Array.isArray(vec)) return [];

    return vec.map((item) => ({
      id: Number(item.id),
      name: item.name,
      description: item.description,
      endpoint: item.endpoint,
      price_usdc: item.price_usdc,
      pay_to: item.pay_to,
      category: item.category,
      provider: item.provider?.toString() ?? item.provider,
      reputation: Number(item.reputation),
      active: item.active,
      registered_at: Number(item.registered_at),
    }));
  } catch (err) {
    logger.error({ err }, 'listServices failed');
    throw err;
  }
}

export async function getService(id) {
  try {
    const contract = getContract();
    const op = contract.call('get_service', nativeToScVal(BigInt(id), { type: 'u64' }));
    const retval = await simulateRead(op);
    if (!retval) return null;
    const native = scValToNative(retval);
    return {
      id: Number(native.id),
      name: native.name,
      description: native.description,
      endpoint: native.endpoint,
      price_usdc: native.price_usdc,
      pay_to: native.pay_to,
      category: native.category,
      provider: native.provider?.toString() ?? native.provider,
      reputation: Number(native.reputation),
      active: native.active,
      registered_at: Number(native.registered_at),
    };
  } catch (err) {
    logger.error({ err, id }, 'getService failed');
    return null;
  }
}

export async function getServiceCount() {
  try {
    const contract = getContract();
    const op = contract.call('get_service_count');
    const retval = await simulateRead(op);
    if (!retval) return 0;
    return Number(scValToNative(retval));
  } catch (err) {
    logger.error({ err }, 'getServiceCount failed');
    return 0;
  }
}

export const contractHelpers = {
  activeServiceExists: async function (provider, endpoint, fetchServices = listServices) {
    let offset = 0;
    const limit = 20;

    while (true) {
      const services = await fetchServices({ offset, limit });
      if (!services.length) {
        return false;
      }

      if (services.some((s) => s.provider === provider && s.endpoint === endpoint)) {
        return true;
      }

      offset += limit;
    }
  },

  activeServiceExistsByName: async function (provider, name, fetchServices = listServices) {
    let offset = 0;
    const limit = 20;

    while (true) {
      const services = await fetchServices({ offset, limit });
      if (!services.length) {
        return false;
      }

      if (services.some((s) => s.provider === provider && s.name === name)) {
        return true;
      }

      offset += limit;
    }
  },
};

export async function activeServiceExists(provider, endpoint, fetchServices = listServices) {
  return contractHelpers.activeServiceExists(provider, endpoint, fetchServices);
}

export async function activeServiceExistsByName(provider, name, fetchServices = listServices) {
  return contractHelpers.activeServiceExistsByName(provider, name, fetchServices);
}

export async function listServicesByProvider(provider, fetchServices = listServices) {
  let offset = 0;
  const limit = 20;
  const matches = [];

  while (true) {
    const services = await fetchServices({ offset, limit });
    if (!services.length) {
      return matches;
    }

    matches.push(...services.filter((service) => service.provider === provider));
    offset += limit;
  }
}

/**
 * Register a service on-chain.
 * Only available to seed/ops scripts that explicitly opt into SEEDING_MODE.
 */
export async function registerServiceOnChain(
  name,
  description,
  endpoint,
  priceUsdc,
  category,
  payTo
) {
  try {
    if (process.env.SEEDING_MODE !== 'true') {
      throw new ContractError(
        'Server-signed service registration is disabled. Set SEEDING_MODE=true for seed scripts or use the wallet-signed registry flow.',
        'SEEDING_MODE_REQUIRED'
      );
    }

    const keypair = getServerKeypair();
    const providerAddress = Address.fromString(keypair.publicKey());
    const provider = providerAddress.toString();

    if (await contractHelpers.activeServiceExists(provider, endpoint)) {
      const err = new Error(
        'Active service with same provider and endpoint already exists'
      );
      logger.warn({ provider, endpoint }, 'Duplicate active service registration blocked');
      throw err;
    }

    if (await contractHelpers.activeServiceExistsByName(provider, name)) {
      const err = new Error(
        'Active service with same provider and name already exists'
      );
      logger.warn({ provider, name }, 'Duplicate active service registration blocked');
      throw err;
    }

    const contract = getContract();
    const payToAddress = payTo || config.x402.payTo;

    const op = contract.call(
      'register_service',
      nativeToScVal(providerAddress, { type: 'address' }),
      nativeToScVal(name, { type: 'string' }),
      nativeToScVal(description, { type: 'string' }),
      nativeToScVal(endpoint, { type: 'string' }),
      nativeToScVal(priceUsdc, { type: 'string' }),
      nativeToScVal(payToAddress, { type: 'string' }),
      nativeToScVal(category, { type: 'string' })
    );

    const result = await simulateAndSubmit(op);
    return result.nativeReturnValue !== undefined ? Number(result.nativeReturnValue) : null;
  } catch (err) {
    logger.error({ err, name }, 'registerServiceOnChain failed');
    throw err;
  }
}

/**
 * Deactivate a service on-chain.
 *
 * Validates service existence, provider ownership, and active status, then
 * builds an unsigned transaction XDR for the provider to sign with their
 * wallet (e.g. Freighter). The contract enforces `provider.require_auth()`
 * so the transaction must be authorized by the provider's key, not the
 * server key.
 *
 * @param {number} id - The numeric service ID to deactivate
 * @param {string} providerAddress - Stellar address of the provider who owns the service
 * @returns {Promise<{xdr: string, submitToken: string}>} prepared tx for wallet signing
 * @throws {ContractError} if the service is not found, provider doesn't match, or already inactive
 */
export async function deactivateServiceOnChain(id, providerAddress) {
  try {
    // Read the service directly from chain to distinguish "not found" from
    // backend/RPC failures — getService() swallows errors and returns null.
    const contract = getContract();
    const readOp = contract.call('get_service', nativeToScVal(BigInt(id), { type: 'u64' }));
    let retval;
    try {
      retval = await simulateRead(readOp);
    } catch (readErr) {
      // simulateRead threw — this is an RPC/simulation failure, not "not found"
      logger.error({ err: readErr, id }, 'deactivateServiceOnChain: failed to read service from chain');
      throw new ContractError(
        `Failed to read service ${id}: ${readErr.message ?? 'RPC error'}`,
        'SERVICE_READ_FAILED'
      );
    }

    if (!retval) {
      throw new ContractError(`Service ${id} not found`, 'SERVICE_NOT_FOUND');
    }

    const native = scValToNative(retval);
    const serviceProvider = native.provider?.toString() ?? native.provider;

    if (serviceProvider !== providerAddress) {
      throw new ContractError(
        'Only the provider that registered this service can deactivate it',
        'PROVIDER_MISMATCH'
      );
    }
    if (!native.active) {
      throw new ContractError(`Service ${id} is already deactivated`, 'ALREADY_INACTIVE');
    }

    // Build unsigned tx — the provider must sign with their wallet to satisfy
    // the on-chain `provider.require_auth()` check.
    const prepared = await buildUnsignedRegistryTx('deactivate', providerAddress, { id });
    logger.info({ id, providerAddress }, 'Built unsigned deactivation tx for provider signing');
    return prepared;
  } catch (err) {
    if (!(err instanceof ContractError)) {
      logger.error({ err, id, providerAddress }, 'deactivateServiceOnChain failed');
    }
    throw err;
  }
}

export async function buildUnsignedRegistryTx(action, providerAddress, params = {}) {
  const contract = getContract();
  const provider = Address.fromString(providerAddress);

  if (action === 'register') {
    if (await contractHelpers.activeServiceExists(providerAddress, params.endpoint)) {
      logger.warn({ provider: providerAddress, endpoint: params.endpoint }, 'Duplicate active service registration blocked');
      throw new ContractError(
        'Active service with same provider and endpoint already exists',
        'DUPLICATE_SERVICE'
      );
    }

    const op = contract.call(
      'register_service',
      nativeToScVal(provider, { type: 'address' }),
      nativeToScVal(params.name, { type: 'string' }),
      nativeToScVal(params.description, { type: 'string' }),
      nativeToScVal(params.endpoint, { type: 'string' }),
      nativeToScVal(String(params.priceUsdc), { type: 'string' }),
      nativeToScVal(params.payTo || config.x402.payTo, { type: 'string' }),
      nativeToScVal(params.category, { type: 'string' })
    );

    const xdr = await buildUnsignedTx(op);
    return createPreparedRegistrySubmission(action, xdr);
  }

  if (action === 'deactivate') {
    const op = contract.call(
      'deactivate_service',
      nativeToScVal(provider, { type: 'address' }),
      nativeToScVal(BigInt(params.id), { type: 'u64' })
    );

    const xdr = await buildUnsignedTx(op);
    return createPreparedRegistrySubmission(action, xdr);
  }

  throw new Error(`Unknown registry action: ${action}`);
}

export function validatePreparedRegistrySubmission(submitToken, signedXdr) {
  prunePreparedRegistrySubmissions();

  if (!submitToken || typeof submitToken !== 'string') {
    throw new ContractError('`submitToken` is required', 'INVALID_BODY');
  }

  const prepared = preparedRegistrySubmissions.get(submitToken);
  if (!prepared) {
    throw new ContractError('Registry submission token is missing or expired', 'INVALID_SUBMIT_TOKEN');
  }

  let tx;
  try {
    tx = new Transaction(signedXdr, getNetworkPassphrase());
  } catch {
    throw new ContractError('`signedXdr` must be a valid transaction XDR', 'INVALID_BODY');
  }

  const [operation] = tx.operations;
  const expectedFunctionName = prepared.action === 'register'
    ? 'register_service'
    : 'deactivate_service';

  const isRegistryInvocation = Boolean(
    operation &&
    tx.operations.length === 1 &&
    operation.type === 'invokeHostFunction' &&
    operation.func.switch().name === 'hostFunctionTypeInvokeContract' &&
    StrKey.encodeContract(operation.func.invokeContract().contractAddress().contractId()) === config.contract.id &&
    operation.func.invokeContract().functionName().toString() === expectedFunctionName
  );

  if (!isRegistryInvocation) {
    throw new ContractError('signedXdr does not match the prepared registry transaction', 'SUBMISSION_MISMATCH');
  }

  preparedRegistrySubmissions.delete(submitToken);
  return prepared;
}

/**
 * Update a service's reputation on-chain and record the change history.
 *
 * The vote is cast as `agentAddress`, which must be a registered agent the
 * backend is allowed to sign for (see {@link isAllowedReputationAgent}). The
 * on-chain contract independently enforces `require_auth` + agent registration +
 * a per-(service, agent) cooldown, so this can never push an anonymous vote.
 * @param {number} id - The ID of the service to update
 * @param {boolean} positive - Whether to increase (true) or decrease (false) reputation by 1
 * @param {string} agentAddress - Stellar address of the registered agent casting the vote
 * @returns {Promise<number>} The new reputation value
 * @throws {ContractError} If the agent is not permitted, or the contract call fails
 */
export async function updateReputation(id, positive, agentAddress) {
  try {
    const voter = getReputationVoters().get(agentAddress);
    if (!voter) {
      throw new ContractError(
        'This agent is not permitted to vote through the hosted backend. Only registered demo agents may; other agents must submit a wallet-signed transaction.',
        'AGENT_NOT_ALLOWED'
      );
    }

    const before = await getService(id);
    if (!before) {
      throw new Error(`Service ${id} not found before reputation update`);
    }

    const contract = getContract();
    const op = contract.call(
      'update_reputation',
      nativeToScVal(BigInt(id), { type: 'u64' }),
      nativeToScVal(positive, { type: 'bool' }),
      nativeToScVal(Address.fromString(agentAddress), { type: 'address' })
    );
    await simulateAndSubmit(op, voter);

    const after = await getService(id);
    if (!after) {
      throw new Error(`Failed to read updated reputation for service ${id}`);
    }

    const newReputation = after.reputation;
    const delta = newReputation - before.reputation;

    recordReputationChange(id, Date.now(), delta, newReputation);

    return newReputation;
  } catch (err) {
    logger.error({ err, id, positive }, 'updateReputation failed');
    throw err;
  }
}

// ── Agent Credit Scoring ──────────────────────────────────────────────────────

/**
 * Safely convert a BigInt (or other value) to a Number.
 * Falls back to String for values outside the safe integer range
 * to prevent silent precision loss on i128/u64 values.
 */
function toNumber(value) {
  if (typeof value === 'bigint' && (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER))) {
    return value.toString();
  }
  return Number(value);
}

export function mapAgent(raw) {
  return {
    address: raw.address?.toString() ?? raw.address,
    name: raw.name,
    description: raw.description,
    owner: raw.owner?.toString() ?? raw.owner,
    score: toNumber(raw.score),
    total_payments: String(raw.total_payments),
    successful_payments: String(raw.successful_payments),
    failed_payments: String(raw.failed_payments),
    total_volume_stroops: String(raw.total_volume_stroops),
    registered_at: String(raw.registered_at),
    last_active: String(raw.last_active),
    active: raw.active,
    flagged: raw.flagged,
    flag_reason: raw.flag_reason ?? '',
  };
}

export function mapPolicy(raw) {
  return {
    agent_address: raw.agent_address?.toString() ?? raw.agent_address,
    max_per_tx_stroops: String(raw.max_per_tx_stroops),
    max_per_day_stroops: String(raw.max_per_day_stroops),
    allowed_categories: Array.isArray(raw.allowed_categories) ? raw.allowed_categories : [],
    min_score_to_earn: toNumber(raw.min_score_to_earn),
    daily_spent_stroops: String(raw.daily_spent_stroops),
    last_reset_ledger: String(raw.last_reset_ledger),
  };
}

export async function listAgents(limit = 50) {
  try {
    const contract = getAgentsContract();
    const op = contract.call('list_agents', nativeToScVal(limit, { type: 'u32' }));
    const retval = await simulateRead(op);
    if (!retval) return [];
    const vec = scValToNative(retval);
    if (!Array.isArray(vec)) return [];
    return vec.map(mapAgent);
  } catch (err) {
    logger.error({ err }, 'listAgents failed');
    throw err;
  }
}

export async function listAgentsPage(page = 0, pageSize = 20) {
  try {
    const contract = getAgentsContract();
    const op = contract.call(
      'list_agents_page',
      nativeToScVal(page, { type: 'u32' }),
      nativeToScVal(pageSize, { type: 'u32' })
    );
    const retval = await simulateRead(op);
    if (!retval) return [];
    const vec = scValToNative(retval);
    if (!Array.isArray(vec)) return [];
    return vec.map(mapAgent);
  } catch (err) {
    logger.error({ err, page, pageSize }, 'listAgentsPage failed');
    throw err;
  }
}

export async function getAgent(agentAddress) {
  try {
    const contract = getAgentsContract();
    const op = contract.call(
      'get_agent',
      nativeToScVal(Address.fromString(agentAddress), { type: 'address' })
    );
    const retval = await simulateRead(op);
    if (!retval) return null;
    const native = scValToNative(retval);
    if (!native) return null;
    return mapAgent(native);
  } catch (err) {
    logger.error({ err, agentAddress }, 'getAgent failed');
    return null;
  }
}

/**
 * Checks if an agent is already registered on-chain.
 * 
 * @param {string} agentAddress - Stellar address of the agent
 * @returns {Promise<boolean>} True if registered, false otherwise
 * @throws {ContractError|Error} If the read call or simulation fails
 */
export async function isAgentRegistered(agentAddress) {
  try {
    const contract = getAgentsContract();
    const op = contract.call(
      'is_registered',
      nativeToScVal(Address.fromString(agentAddress), { type: 'address' })
    );
    const retval = await simulateRead(op);
    if (!retval) return false;
    return scValToNative(retval);
  } catch (err) {
    logger.error({ err, agentAddress }, 'isAgentRegistered failed');
    throw err;
  }
}

export async function getAgentPolicy(agentAddress) {
  try {
    const contract = getAgentsContract();
    const op = contract.call(
      'get_policy',
      nativeToScVal(Address.fromString(agentAddress), { type: 'address' })
    );
    const retval = await simulateRead(op);
    if (!retval) return null;
    const native = scValToNative(retval);
    if (!native) return null;
    return mapPolicy(native);
  } catch (err) {
    logger.error({ err, agentAddress }, 'getAgentPolicy failed');
    return null;
  }
}

export async function getAgentScore(agentAddress) {
  try {
    const contract = getAgentsContract();
    const op = contract.call(
      'get_score',
      nativeToScVal(Address.fromString(agentAddress), { type: 'address' })
    );
    const retval = await simulateRead(op);
    if (!retval) return -1;
    return Number(scValToNative(retval));
  } catch (err) {
    logger.error({ err, agentAddress }, 'getAgentScore failed');
    return -1;
  }
}

export async function getAgentCount() {
  try {
    const contract = getAgentsContract();
    const op = contract.call('get_agent_count');
    const retval = await simulateRead(op);
    if (!retval) return 0;
    return Number(scValToNative(retval));
  } catch (err) {
    logger.error({ err }, 'getAgentCount failed');
    return 0;
  }
}

export async function registerAgentOnChain(agentAddress, name, description) {
  try {
    const contract = getAgentsContract();
    const agentAddr = Address.fromString(agentAddress);
    // owner = the agent's own wallet address (self-owned), not the server key
    const ownerAddress = agentAddr;

    const op = contract.call(
      'register_agent',
      nativeToScVal(agentAddr, { type: 'address' }),
      nativeToScVal(name, { type: 'string' }),
      nativeToScVal(description, { type: 'string' }),
      nativeToScVal(ownerAddress, { type: 'address' })
    );

    const result = await simulateAndSubmit(op);
    return result.nativeReturnValue !== undefined ? Number(result.nativeReturnValue) : null;
  } catch (err) {
    logger.error({ err, agentAddress, name }, 'registerAgentOnChain failed');
    throw err;
  }
}

export async function recordPaymentOnChain(agentAddress, serviceId, amountStroops, success) {
  try {
    const contract = getAgentsContract();
    const agentAddr = Address.fromString(agentAddress);
    const callerAddr = Address.fromString(getServerKeypair().publicKey());

    const op = contract.call(
      'record_payment',
      nativeToScVal(agentAddr, { type: 'address' }),
      nativeToScVal(BigInt(serviceId), { type: 'u64' }),
      nativeToScVal(BigInt(amountStroops), { type: 'i128' }),
      nativeToScVal(success, { type: 'bool' }),
      nativeToScVal(callerAddr, { type: 'address' })
    );

    await simulateAndSubmit(op);
    return true;
  } catch (err) {
    logger.error({ err, agentAddress }, 'recordPaymentOnChain failed');
    throw err;
  }
}

export async function isAgentEligible(agentAddress, minScore) {
  try {
    const contract = getAgentsContract();
    const op = contract.call(
      'is_eligible',
      nativeToScVal(Address.fromString(agentAddress), { type: 'address' }),
      nativeToScVal(minScore, { type: 'i32' })
    );
    const retval = await simulateRead(op);
    if (!retval) return false;
    return Boolean(scValToNative(retval));
  } catch (err) {
    logger.error({ err, agentAddress, minScore }, 'isAgentEligible failed');
    return false;
  }
}

export async function checkSpendingAllowed(agentAddress, amountStroops) {
  try {
    const contract = getAgentsContract();
    const op = contract.call(
      'check_spending_allowed',
      nativeToScVal(Address.fromString(agentAddress), { type: 'address' }),
      nativeToScVal(BigInt(amountStroops), { type: 'i128' })
    );
    const retval = await simulateRead(op);
    if (!retval) return false;
    return Boolean(scValToNative(retval));
  } catch (err) {
    logger.error({ err, agentAddress }, 'checkSpendingAllowed failed');
    return false;
  }
}

export async function flagAgentOnChain(agentAddress, reason, callerAddress) {
  try {
    const contract = getAgentsContract();
    const keypair = getServerKeypair();
    const caller = Address.fromString(callerAddress ?? keypair.publicKey());

    const op = contract.call(
      'flag_agent',
      nativeToScVal(Address.fromString(agentAddress), { type: 'address' }),
      nativeToScVal(reason, { type: 'string' }),
      nativeToScVal(caller, { type: 'address' })
    );

    await simulateAndSubmit(op);
    return true;
  } catch (err) {
    logger.error({ err, agentAddress, reason }, 'flagAgentOnChain failed');
    throw err;
  }
}

export async function deactivateAgentOnChain(agentAddress, callerAddress) {
  try {
    const contract = getAgentsContract();
    const keypair = getServerKeypair();
    const caller = Address.fromString(callerAddress ?? keypair.publicKey());

    const op = contract.call(
      'deactivate_agent',
      nativeToScVal(Address.fromString(agentAddress), { type: 'address' }),
      nativeToScVal(caller, { type: 'address' })
    );

    await simulateAndSubmit(op);
    return true;
  } catch (err) {
    logger.error({ err, agentAddress }, 'deactivateAgentOnChain failed');
    throw err;
  }
}

export async function adminDeactivateAgentOnChain(agentAddress) {
  try {
    const contract = getAgentsContract();
    const keypair = getServerKeypair();
    const caller = Address.fromString(keypair.publicKey());

    const op = contract.call(
      'admin_deactivate_agent',
      nativeToScVal(Address.fromString(agentAddress), { type: 'address' }),
      nativeToScVal(caller, { type: 'address' })
    );

    await simulateAndSubmit(op);
    return true;
  } catch (err) {
    logger.error({ err, agentAddress }, 'adminDeactivateAgentOnChain failed');
    throw err;
  }
}

export async function updatePolicyOnChain(
  agentAddress,
  maxPerTxStroops,
  maxPerDayStroops,
  allowedCategories,
  minScoreToEarn,
  callerAddress
) {
  try {
    const contract = getAgentsContract();
    const keypair = getServerKeypair();
    const caller = Address.fromString(callerAddress ?? keypair.publicKey());

    const op = contract.call(
      'update_policy',
      nativeToScVal(Address.fromString(agentAddress), { type: 'address' }),
      nativeToScVal(BigInt(maxPerTxStroops), { type: 'i128' }),
      nativeToScVal(BigInt(maxPerDayStroops), { type: 'i128' }),
      nativeToScVal(allowedCategories ?? []),
      nativeToScVal(minScoreToEarn, { type: 'i32' }),
      nativeToScVal(caller, { type: 'address' })
    );

    await simulateAndSubmit(op);
    return true;
  } catch (err) {
    logger.error({ err, agentAddress }, 'updatePolicyOnChain failed');
    throw err;
  }
}

/**
 * Build an unsigned, simulated transaction XDR for a mutating agent operation.
 * The frontend wallet (Freighter) will sign the returned XDR and POST it back
 * via submitSignedAgentTx.
 *
 * @param {'deactivate'|'update_policy'} action
 * @param {string} agentAddress  - the agent's Stellar address (also the owner/caller)
 * @param {object} params        - action-specific params
 * @returns {Promise<string>}    - base64-encoded transaction XDR ready for signing
 */
export async function buildUnsignedAgentTx(action, agentAddress, params = {}) {
  const contract = getAgentsContract();
  const callerAddr = Address.fromString(agentAddress);

  let op;
  if (action === 'deactivate') {
    op = contract.call(
      'deactivate_agent',
      nativeToScVal(Address.fromString(agentAddress), { type: 'address' }),
      nativeToScVal(callerAddr, { type: 'address' })
    );
  } else if (action === 'update_policy') {
    op = contract.call(
      'update_policy',
      nativeToScVal(Address.fromString(agentAddress), { type: 'address' }),
      nativeToScVal(BigInt(params.maxPerTxStroops), { type: 'i128' }),
      nativeToScVal(BigInt(params.maxPerDayStroops), { type: 'i128' }),
      nativeToScVal(params.allowedCategories ?? []),
      nativeToScVal(params.minScoreToEarn ?? 0, { type: 'i32' }),
      nativeToScVal(callerAddr, { type: 'address' })
    );
  } else {
    throw new Error(`Unknown action: ${action}`);
  }

  return buildUnsignedTx(op);
}

async function submitSignedTx(signedXdr) {
  const server = getStellarServer();
  const passphrase = getNetworkPassphrase();
  const keypair = getServerKeypair();

  const tx = new Transaction(signedXdr, passphrase);
  tx.sign(keypair);

  const sendStart = Date.now();
  const sendResult = await server.sendTransaction(tx);
  logRpcCall('sendTransaction', Date.now() - sendStart);
  if (sendResult.status === 'ERROR') {
    throw new TransactionFailedError(`Transaction failed: ${JSON.stringify(sendResult.errorResult)}`, sendResult.hash, sendResult.errorResult);
  }

  const signedTxHash = sendResult.hash;
  trackPendingTransaction(signedTxHash, 'signed-transaction');

  logger.debug({ hash: signedTxHash }, 'Submitted signed Soroban transaction');

  let getResult;
  for (let i = 0; i < 20; i++) {
    const txStart = Date.now();
    getResult = await server.getTransaction(sendResult.hash);
    logRpcCall('getTransaction', Date.now() - txStart);
    if (getResult.status !== 'NOT_FOUND') break;
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (!getResult || getResult.status === 'NOT_FOUND') {
    throw new TransactionTimeoutError(`Transaction not confirmed: ${sendResult.hash}`, sendResult.hash);
  }

  removePendingTransaction(signedTxHash);

  if (getResult.status === 'FAILED') {
    throw new TransactionFailedError(`Transaction failed on-chain: ${sendResult.hash}`, sendResult.hash, getResult);
  }

  let nativeReturnValue;
  if (getResult.returnValue) {
    try {
      nativeReturnValue = scValToNative(getResult.returnValue);
    } catch (err) {
      throw new ReturnValueParseError(`Transaction succeeded but return value could not be parsed: ${sendResult.hash}`, sendResult.hash, err);
    }
  }

  return {
    hash: sendResult.hash,
    returnValue: getResult.returnValue ?? null,
    nativeReturnValue,
  };
}

/**
 * Submit a pre-signed transaction XDR (signed by the agent's Freighter wallet).
 * @param {string} signedXdr - base64-encoded signed transaction XDR
 * @returns {Promise<string>} - transaction hash
 */
export async function submitSignedAgentTx(signedXdr) {
  const { hash } = await submitSignedTx(signedXdr);
  return hash;
}

export async function submitSignedRegistryTx(signedXdr) {
  const { hash, nativeReturnValue } = await submitSignedTx(signedXdr);
  return {
    hash,
    id: nativeReturnValue !== undefined ? Number(nativeReturnValue) : null,
  };
}
