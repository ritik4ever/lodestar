import type {
  ServiceEntry,
  StatsResponse,
  ServicesResponse,
  ReputationResponse,
  Category,
} from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchServices(category?: Category): Promise<ServiceEntry[]> {
  const query = category ? `?category=${category}` : '';
  const data = await apiFetch<ServicesResponse>(`/api/services${query}`);
  return data.services;
}

export async function fetchStats(): Promise<StatsResponse> {
  return apiFetch<StatsResponse>('/api/stats');
}

export async function fetchServiceById(id: number): Promise<ServiceEntry> {
  return apiFetch<ServiceEntry>(`/api/services/${id}`);
}

export async function submitReputation(
  id: number,
  positive: boolean
): Promise<ReputationResponse> {
  return apiFetch<ReputationResponse>(`/api/reputation/${id}`, {
    method: 'POST',
    body: JSON.stringify({ positive }),
  });
}

export interface RegisterFormData {
  name: string;
  description: string;
  endpoint: string;
  price_usdc: string;
  category: Category;
}

export async function registerService(
  formData: RegisterFormData,
  walletAddress: string
): Promise<{ txHash: string; id: number }> {
  const stellarSdk = await import('@stellar/stellar-sdk');
  const sdk = (stellarSdk as unknown as { default: typeof stellarSdk }).default ?? stellarSdk;
  const {
    Contract,
    TransactionBuilder,
    BASE_FEE,
    Networks,
    rpc,
    nativeToScVal,
    scValToNative,
    Address,
  } = sdk;

  const { kitSignTransaction: signTx } = await import('./wallet');

  const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID ?? '';
  const rpcUrl =
    process.env.NEXT_PUBLIC_STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org';
  const networkPassphrase = Networks.TESTNET;

  const server = new rpc.Server(rpcUrl);
  const contract = new Contract(contractId);
  const account = await server.getAccount(walletAddress);

  const providerAddress = Address.fromString(walletAddress);

  const op = contract.call(
    'register_service',
    nativeToScVal(providerAddress, { type: 'address' }),
    nativeToScVal(formData.name, { type: 'string' }),
    nativeToScVal(formData.description, { type: 'string' }),
    nativeToScVal(formData.endpoint, { type: 'string' }),
    nativeToScVal(formData.price_usdc, { type: 'string' }),
    nativeToScVal(formData.category, { type: 'string' })
  );

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  const preparedTx = rpc.assembleTransaction(tx, simResult).build();
  const signedXdr = await signTx(preparedTx.toXDR());

  const signedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);

  const sendResult = await server.sendTransaction(signedTx);
  if (sendResult.status === 'ERROR') {
    throw new Error('Transaction submission failed');
  }

  let getResult = await server.getTransaction(sendResult.hash);
  for (let i = 0; i < 20 && getResult.status === 'NOT_FOUND'; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    getResult = await server.getTransaction(sendResult.hash);
  }

  if (getResult.status === 'FAILED') {
    throw new Error('Transaction failed on-chain');
  }

  const id =
    getResult.status === 'SUCCESS' && getResult.returnValue
      ? Number(scValToNative(getResult.returnValue))
      : 0;
  return { txHash: sendResult.hash, id };
}
