import {
  isConnected,
  getAddress,
  signTransaction,
  requestAccess,
} from '@stellar/freighter-api';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';

export function isFreighterInstalled(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof (window as Window & { freighter?: unknown }).freighter !== 'undefined'
    );
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

// Keypair wallet — signs locally in-memory, no extension required
export function signTxWithKeypair(xdr: string, secret: string): string {
  const keypair = Keypair.fromSecret(secret);
  const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
  tx.sign(keypair);
  return tx.toXDR();
}

export function publicKeyFromSecret(secret: string): string {
  return Keypair.fromSecret(secret).publicKey();
}

export async function getBalance(address: string): Promise<string> {
  try {
    const horizonUrl =
      process.env.NEXT_PUBLIC_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';

    const res = await fetch(`${horizonUrl}/accounts/${address}`);
    if (!res.ok) return '0.0000';

    const data = (await res.json()) as {
      balances: Array<{
        asset_type: string;
        asset_code?: string;
        balance: string;
      }>;
    };

    const usdc = data.balances.find(
      (b) => b.asset_type === 'credit_alphanum4' && b.asset_code === 'USDC'
    );

    return usdc ? parseFloat(usdc.balance).toFixed(4) : '0.0000';
  } catch {
    return '0.0000';
  }
}
