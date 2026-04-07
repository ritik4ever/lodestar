import {
  Contract,
  Keypair,
  TransactionBuilder,
  BASE_FEE,
  xdr,
  Address,
  nativeToScVal,
  scValToNative,
} from '@stellar/stellar-sdk';
import { SorobanRpc } from '@stellar/stellar-sdk';
import config from '../config.js';
import { getStellarServer, getNetworkPassphrase } from './stellar.js';
import logger from './logger.js';

const TIMEOUT = 30;

function getContract() {
  return new Contract(config.contract.id);
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

  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  const preparedTx = SorobanRpc.assembleTransaction(tx, simResult).build();
  preparedTx.sign(keypair);

  const sendResult = await server.sendTransaction(preparedTx);
  if (sendResult.status === 'ERROR') {
    throw new Error(`Transaction failed: ${JSON.stringify(sendResult.errorResult)}`);
  }

  let getResult = await server.getTransaction(sendResult.hash);
  for (let i = 0; i < 20 && getResult.status === 'NOT_FOUND'; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    getResult = await server.getTransaction(sendResult.hash);
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

  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  return simResult.result?.retval;
}

function parseServiceEntry(scVal) {
  if (!scVal) return null;
  const native = scValToNative(scVal);
  return {
    id: Number(native.id),
    name: native.name,
    description: native.description,
    endpoint: native.endpoint,
    price_usdc: native.price_usdc,
    category: native.category,
    provider: native.provider.toString(),
    reputation: Number(native.reputation),
    active: native.active,
    registered_at: Number(native.registered_at),
  };
}

export async function listServices(category) {
  try {
    const contract = getContract();
    const categoryArg = category
      ? xdr.ScVal.scvVec([nativeToScVal(category, { type: 'string' })])
      : xdr.ScVal.scvVoid();

    const op = contract.call(
      'list_services',
      xdr.ScVal.scvVec(
        category
          ? [
              xdr.ScVal.scvVec([nativeToScVal(category, { type: 'string' })]),
            ]
          : []
      )
    );

    // Use Option<String> — pass Some(string) or None
    const optionArg = category
      ? nativeToScVal({ some: category }, { type: 'option' })
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
