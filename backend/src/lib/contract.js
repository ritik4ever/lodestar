import pkg from '@stellar/stellar-sdk';
const {
  Contract,
  Keypair,
  TransactionBuilder,
  BASE_FEE,
  xdr,
  Address,
  nativeToScVal,
  scValToNative,
  rpc,
} = pkg;
import config from '../config.js';
import { getStellarServer, getNetworkPassphrase } from './stellar.js';
import logger from './logger.js';

const TIMEOUT = 30;

function getContract() {
  return new Contract(config.contract.id);
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

async function simulateAndSubmit(operation) {
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
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  const preparedTx = rpc.assembleTransaction(tx, simResult).build();
  preparedTx.sign(keypair);

  const sendResult = await server.sendTransaction(preparedTx);
  if (sendResult.status === 'ERROR') {
    throw new Error(`Transaction failed: ${JSON.stringify(sendResult.errorResult)}`);
  }

  let getResult;
  for (let i = 0; i < 20; i++) {
    try {
      getResult = await server.getTransaction(sendResult.hash);
      if (getResult.status !== 'NOT_FOUND') break;
    } catch (parseErr) {
      // Protocol-22 XDR parse errors on confirmed txs — treat as SUCCESS
      if (parseErr.message?.includes('Bad union switch') || parseErr.message?.includes('XDR')) {
        logger.warn({ hash: sendResult.hash }, 'getTransaction XDR parse error — assuming confirmed');
        return { status: 'SUCCESS', returnValue: null };
      }
      throw parseErr;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (!getResult || getResult.status === 'NOT_FOUND') {
    throw new Error(`Transaction not confirmed after polling: ${sendResult.hash}`);
  }

  if (getResult.status === 'FAILED') {
    throw new Error(`Transaction failed on-chain: ${sendResult.hash}`);
  }

  return getResult;
}

async function simulateRead(operation) {
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
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  return simResult.result?.retval;
}


export async function listServices(category) {
  try {
    const contract = getContract();

    // Option<String>: Some(s) = the string value directly; None = scvVoid
    const optionArg = category
      ? nativeToScVal(category, { type: 'string' })
      : xdr.ScVal.scvVoid();

    const callOp = contract.call('list_services', optionArg);
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

export async function updateReputation(id, positive) {
  try {
    const contract = getContract();
    const op = contract.call(
      'update_reputation',
      nativeToScVal(BigInt(id), { type: 'u64' }),
      nativeToScVal(positive, { type: 'bool' })
    );
    await simulateAndSubmit(op);
    const updated = await getService(id);
    return updated?.reputation ?? 0;
  } catch (err) {
    logger.error({ err, id, positive }, 'updateReputation failed');
    throw err;
  }
}

export async function registerServiceOnChain(
  name,
  description,
  endpoint,
  priceUsdc,
  category
) {
  try {
    const contract = getContract();
    const keypair = getServerKeypair();
    const providerAddress = Address.fromString(keypair.publicKey());

    const op = contract.call(
      'register_service',
      nativeToScVal(providerAddress, { type: 'address' }),
      nativeToScVal(name, { type: 'string' }),
      nativeToScVal(description, { type: 'string' }),
      nativeToScVal(endpoint, { type: 'string' }),
      nativeToScVal(priceUsdc, { type: 'string' }),
      nativeToScVal(category, { type: 'string' })
    );

    const result = await simulateAndSubmit(op);
    const retval = result.returnValue;
    return retval ? Number(scValToNative(retval)) : null;
  } catch (err) {
    logger.error({ err, name }, 'registerServiceOnChain failed');
    throw err;
  }
}

// ── Agent Credit Scoring ──────────────────────────────────────────────────────

function mapAgent(raw) {
  return {
    address: raw.address?.toString() ?? raw.address,
    name: raw.name,
    description: raw.description,
    owner: raw.owner?.toString() ?? raw.owner,
    score: Number(raw.score),
    total_payments: Number(raw.total_payments),
    successful_payments: Number(raw.successful_payments),
    failed_payments: Number(raw.failed_payments),
    total_volume_stroops: String(raw.total_volume_stroops),
    registered_at: Number(raw.registered_at),
    last_active: Number(raw.last_active),
    active: raw.active,
    flagged: raw.flagged,
    flag_reason: raw.flag_reason ?? '',
  };
}

function mapPolicy(raw) {
  return {
    agent_address: raw.agent_address?.toString() ?? raw.agent_address,
    max_per_tx_stroops: String(raw.max_per_tx_stroops),
    max_per_day_stroops: String(raw.max_per_day_stroops),
    allowed_categories: Array.isArray(raw.allowed_categories) ? raw.allowed_categories : [],
    min_score_to_earn: Number(raw.min_score_to_earn),
    daily_spent_stroops: String(raw.daily_spent_stroops),
    last_reset_ledger: Number(raw.last_reset_ledger),
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
    const keypair = getServerKeypair();
    const ownerAddress = Address.fromString(keypair.publicKey());
    const agentAddr = Address.fromString(agentAddress);

    const op = contract.call(
      'register_agent',
      nativeToScVal(agentAddr, { type: 'address' }),
      nativeToScVal(name, { type: 'string' }),
      nativeToScVal(description, { type: 'string' }),
      nativeToScVal(ownerAddress, { type: 'address' })
    );

    const result = await simulateAndSubmit(op);
    const retval = result.returnValue;
    return retval ? Number(scValToNative(retval)) : null;
  } catch (err) {
    logger.error({ err, agentAddress, name }, 'registerAgentOnChain failed');
    throw err;
  }
}

export async function recordPaymentOnChain(agentAddress, amountStroops, success) {
  try {
    const contract = getAgentsContract();
    const agentAddr = Address.fromString(agentAddress);

    const op = contract.call(
      'record_payment',
      nativeToScVal(agentAddr, { type: 'address' }),
      nativeToScVal(BigInt(amountStroops), { type: 'i128' }),
      nativeToScVal(success, { type: 'bool' })
    );

    await simulateAndSubmit(op);
    return true;
  } catch (err) {
    logger.error({ err, agentAddress }, 'recordPaymentOnChain failed');
    throw err;
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
