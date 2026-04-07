import {
  isConnected,
  getAddress,
  signTransaction,
  requestAccess,
} from '@stellar/freighter-api';

export function isFreighterInstalled(): boolean {
  try {
    return typeof window !== 'undefined' && typeof (window as Window & { freighter?: unknown }).freighter !== 'undefined';
  } catch {
    return false;
  }
}

export async function connectWallet(): Promise<string> {
  const connected = await isConnected();
  if (!connected.isConnected) {
    await requestAccess();
  }
  const result = await getAddress();
  if (result.error) {
    throw new Error(result.error);
  }
  return result.address;
}

export async function signTx(xdr: string, network: string): Promise<string> {
  const result = await signTransaction(xdr, { networkPassphrase: network });
  if (result.error) {
    throw new Error(result.error);
  }
  return result.signedTxXdr;
}

export async function getBalance(address: string): Promise<string> {
  try {
    const horizonUrl =
      process.env.NEXT_PUBLIC_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
    const usdcContractId = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';

    const res = await fetch(`${horizonUrl}/accounts/${address}`);
    if (!res.ok) return '0.00';

    const data = (await res.json()) as {
      balances: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string; balance: string }>;
    };

    const usdc = data.balances.find(
      (b) =>
        b.asset_code === 'USDC' ||
        (b.asset_type === 'credit_alphanum4' && b.asset_code === 'USDC')
    );

    return usdc ? parseFloat(usdc.balance).toFixed(4) : '0.0000';
  } catch {
    return '0.0000';
  }
}
