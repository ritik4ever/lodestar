import { StellarWalletsKit } from '@creit-tech/stellar-wallets-kit/sdk';
import { FreighterModule, FREIGHTER_ID } from '@creit-tech/stellar-wallets-kit/modules/freighter';
import { AlbedoModule, ALBEDO_ID } from '@creit-tech/stellar-wallets-kit/modules/albedo';
import { xBullModule, XBULL_ID } from '@creit-tech/stellar-wallets-kit/modules/xbull';
import { LobstrModule, LOBSTR_ID } from '@creit-tech/stellar-wallets-kit/modules/lobstr';
import { Networks } from '@creit-tech/stellar-wallets-kit/types';

export { Networks as WalletNetworks };
export { FREIGHTER_ID, ALBEDO_ID, XBULL_ID, LOBSTR_ID };

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
  // Drop the persisted hint too, otherwise the next page load would restore the
  // connection the user just ended (#838).
  clearWalletHint();
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

// ── connection persistence (#838) ─────────────────────────────────────────────
//
// A refresh previously dropped the connection entirely. We persist a *hint* —
// which wallet was used, and the address it reported — so the session can be
// restored on mount.
//
// Nothing secret is stored. A wallet id is a public identifier and a Stellar
// address is public by definition; no key, seed, signature or session token is
// written. The stored address is treated as a cache for optimistic UI only: the
// restore path always re-asks the provider and trusts the provider's answer.

const WALLET_HINT_KEY = 'lodestar.wallet.hint';

export interface WalletConnectionHint {
  walletId: string;
  address: string;
  savedAt: number;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function persistWalletHint(walletId: string, address: string): void {
  if (!isBrowser()) return;
  try {
    const hint: WalletConnectionHint = { walletId, address, savedAt: Date.now() };
    window.localStorage.setItem(WALLET_HINT_KEY, JSON.stringify(hint));
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). Persistence is
    // an enhancement — never let it break connecting.
  }
}

export function getWalletHint(): WalletConnectionHint | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(WALLET_HINT_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<WalletConnectionHint>;
    if (typeof parsed?.walletId !== 'string' || !parsed.walletId) return null;
    if (!WALLET_OPTIONS.some((w) => w.id === parsed.walletId)) return null;

    return {
      walletId: parsed.walletId,
      address: typeof parsed.address === 'string' ? parsed.address : '',
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
    };
  } catch {
    return null;
  }
}

export function clearWalletHint(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(WALLET_HINT_KEY);
  } catch {
    // ignore
  }
}

/**
 * Restore a previous connection.
 *
 * The stored address is never trusted: the wallet provider is re-queried and its
 * answer wins. If the provider reports a different address — the user switched
 * accounts in the extension since the last visit — the new address is returned
 * and the hint updated. If the provider refuses, is locked, or is no longer
 * installed, the hint is cleared and null is returned so the UI shows a
 * disconnected state rather than a stale one.
 */
export async function restoreWalletConnection(): Promise<string | null> {
  const hint = getWalletHint();
  if (!hint) return null;

  try {
    const address = await connectWithWallet(hint.walletId);
    if (!address) {
      clearWalletHint();
      return null;
    }

    if (address !== hint.address) {
      console.info(
        JSON.stringify({ event: 'wallet_restored_address_changed', walletId: hint.walletId }),
      );
    }

    persistWalletHint(hint.walletId, address);
    return address;
  } catch (error: any) {
    console.info(
      JSON.stringify({
        event: 'wallet_restore_failed',
        walletId: hint.walletId,
        reason: error instanceof WalletError ? error.type : 'UNKNOWN',
      }),
    );
    clearWalletHint();
    return null;
  }
}
