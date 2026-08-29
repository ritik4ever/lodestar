import {
  isConnected,
  getAddress,
  signTransaction,
  requestAccess,
  getNetwork,
} from '@stellar/freighter-api';
import type { FreighterStatus } from '@/lib/types';
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

/**
 * Probe Freighter's current state without triggering any user prompts.
 * Returns the status plus contextual information for UI messaging.
 */
export async function probeFreighterState(requiredNetworkPassphrase: string): Promise<{
  status: FreighterStatus;
  message: string;
  currentNetwork?: string;
  requiredNetwork?: string;
}> {
  // 1. Check if Freighter is installed
  if (!isFreighterInstalled()) {
    return {
      status: 'not-installed',
      message: 'Freighter extension is not installed.',
    };
  }

  try {
    // 2. Try a lightweight call to check if Freighter is unlocked / responsive
    const networkResult = await getNetwork();

    if (networkResult.error) {
      const errMsg = networkResult.error.message?.toLowerCase() || '';
      // Detect locked state — Freighter returns an error when locked
      if (
        errMsg.includes('locked') ||
        errMsg.includes('log in') ||
        errMsg.includes('login') ||
        errMsg.includes('unlock') ||
        errMsg.includes('password') ||
        errMsg.includes('not connected') ||
        networkResult.error.code === -4 // common error code for locked
      ) {
        return {
          status: 'locked',
          message: 'Freighter is locked. Please unlock the extension to continue.',
        };
      }
      // Some other error — treat as not-connected
      return {
        status: 'not-connected',
        message: 'Freighter is installed but not connected.',
      };
    }

    // 3. Check network
    const currentPassphrase = networkResult.networkPassphrase;
    if (currentPassphrase && currentPassphrase !== requiredNetworkPassphrase) {
      const currentNetworkName = getNetworkDisplayName(currentPassphrase);
      const requiredNetworkName = getNetworkDisplayName(requiredNetworkPassphrase);
      return {
        status: 'wrong-network',
        message: `Freighter is connected to ${currentNetworkName} but Lodestar requires ${requiredNetworkName}.`,
        currentNetwork: currentNetworkName,
        requiredNetwork: requiredNetworkName,
      };
    }

    // 4. Check if already connected/authorized
    const connectedResult = await isConnected();
    if (!connectedResult.error && connectedResult.isConnected) {
      return {
        status: 'connected',
        message: '',
      };
    }

    // Not connected yet but available
    return {
      status: 'not-connected',
      message: '',
    };
  } catch (error: any) {
    // If getNetwork() throws entirely (e.g., extension context invalid),
    // treat as locked or not-connected based on the error message
    const errMsg = (error?.message || String(error) || '').toLowerCase();
    if (
      errMsg.includes('locked') ||
      errMsg.includes('log in') ||
      errMsg.includes('unlock')
    ) {
      return {
        status: 'locked',
        message: 'Freighter is locked. Please unlock the extension to continue.',
      };
    }
    return {
      status: 'not-connected',
      message: '',
    };
  }
}

/** Human-readable network name from passphrase */
export function getNetworkDisplayName(passphrase: string): string {
  if (passphrase === Networks.TESTNET) return 'Testnet';
  if (passphrase === Networks.PUBLIC) return 'Mainnet';
  if (passphrase.includes('Future')) return 'Futurenet';
  return 'Custom Network';
}
