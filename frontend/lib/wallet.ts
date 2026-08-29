import { StellarWalletsKit } from '@creit-tech/stellar-wallets-kit/sdk';
import { FreighterModule, FREIGHTER_ID } from '@creit-tech/stellar-wallets-kit/modules/freighter';
import { AlbedoModule, ALBEDO_ID } from '@creit-tech/stellar-wallets-kit/modules/albedo';
import { xBullModule, XBULL_ID } from '@creit-tech/stellar-wallets-kit/modules/xbull';
import { LobstrModule, LOBSTR_ID } from '@creit-tech/stellar-wallets-kit/modules/lobstr';
import { Networks } from '@creit-tech/stellar-wallets-kit/types';

export { Networks as WalletNetworks };
export { FREIGHTER_ID, ALBEDO_ID, XBULL_ID, LOBSTR_ID };

/** The Stellar network passphrase expected by Lodestar */
export const EXPECTED_NETWORK_PASSPHRASE = Networks.TESTNET;

export enum WalletErrorType {
  WALLET_NOT_FOUND = 'WALLET_NOT_FOUND',
  UNSUPPORTED_BROWSER = 'UNSUPPORTED_BROWSER',
  USER_REJECTED = 'USER_REJECTED',
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  UNKNOWN = 'UNKNOWN'
}

export class WalletError extends Error {
  constructor(public type: WalletErrorType, message: string, public rawError?: any) {
    super(message);
    this.name = 'WalletError';
  }
}

export interface WalletOption {
  id: string;
  name: string;
}

export const WALLET_OPTIONS: WalletOption[] = [
  { id: FREIGHTER_ID, name: 'Freighter' },
  { id: ALBEDO_ID,    name: 'Albedo'    },
  { id: XBULL_ID,     name: 'xBull'     },
  { id: LOBSTR_ID,    name: 'Lobstr'    },
];

let _initialized = false;

export function initKit() {
  if (_initialized || typeof window === 'undefined') return;
  StellarWalletsKit.init({
    network: Networks.TESTNET,
    modules: [
      new FreighterModule(),
      new AlbedoModule(),
      new xBullModule(),
      new LobstrModule(),
    ],
  });
  _initialized = true;
}

export function disconnectWallet(): void {
  _initialized = false;
  console.info(JSON.stringify({ event: 'wallet_disconnected' }));
}

export async function connectWithWallet(walletId: string): Promise<string> {
  try {
    if (typeof window === 'undefined') {
      throw new WalletError(WalletErrorType.UNSUPPORTED_BROWSER, 'Window is not defined. Are you running on the server?');
    }

    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile && walletId === FREIGHTER_ID) {
      console.error(JSON.stringify({ event: 'unsupported_browser', walletId }));
      throw new WalletError(WalletErrorType.UNSUPPORTED_BROWSER, 'This browser does not support Stellar wallet extensions.');
    }

    initKit();
    await StellarWalletsKit.setWallet(walletId);
    const result = await StellarWalletsKit.fetchAddress();
    const address = typeof result === 'string' ? result : result.address;
    return address;
  } catch (error: any) {
    if (error instanceof WalletError) {
      throw error;
    }

    const errorMessage = error?.message?.toLowerCase() || String(error).toLowerCase();
    
    if (errorMessage.includes('not installed') || errorMessage.includes('not found') || errorMessage.includes('is not available')) {
      console.error(JSON.stringify({ event: 'wallet_not_found', walletId, message: error?.message }));
      throw new WalletError(WalletErrorType.WALLET_NOT_FOUND, 'Please install a supported Stellar wallet such as Freighter to continue.', error);
    }
    
    if (errorMessage.includes('reject') || errorMessage.includes('cancel') || errorMessage.includes('decline') || errorMessage.includes('user rejected')) {
      console.error(JSON.stringify({ event: 'wallet_connection_rejected', walletId, message: error?.message }));
      throw new WalletError(WalletErrorType.USER_REJECTED, 'Wallet connection was cancelled.', error);
    }
    
    console.error(JSON.stringify({ event: 'wallet_connection_failed', walletId, message: error?.message }));
    throw new WalletError(WalletErrorType.CONNECTION_FAILED, 'Unable to connect wallet. Please try again.', error);
  }
}

export async function kitSignTransaction(xdr: string): Promise<string> {
  const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
    networkPassphrase: Networks.TESTNET,
  });
  return signedTxXdr;
}

export async function getBalance(address: string): Promise<string> {
  try {
    const horizonUrl =
      process.env.NEXT_PUBLIC_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
    const res = await fetch(`${horizonUrl}/accounts/${address}`);
    if (!res.ok) return '0.0000';
    const data = (await res.json()) as {
      balances: Array<{ asset_type: string; asset_code?: string; balance: string }>;
    };
    const usdc = data.balances.find(
      (b) => b.asset_type === 'credit_alphanum4' && b.asset_code === 'USDC'
    );
    return usdc ? parseFloat(usdc.balance).toFixed(4) : '0.0000';
  } catch {
    return '0.0000';
  }
}
