import { StellarWalletsKit } from '@creit-tech/stellar-wallets-kit/sdk';
import { FreighterModule, FREIGHTER_ID } from '@creit-tech/stellar-wallets-kit/modules/freighter';
import { AlbedoModule, ALBEDO_ID } from '@creit-tech/stellar-wallets-kit/modules/albedo';
import { xBullModule, XBULL_ID } from '@creit-tech/stellar-wallets-kit/modules/xbull';
import { LobstrModule, LOBSTR_ID } from '@creit-tech/stellar-wallets-kit/modules/lobstr';
import { Networks } from '@creit-tech/stellar-wallets-kit/types';

export { Networks as WalletNetworks };
export { FREIGHTER_ID, ALBEDO_ID, XBULL_ID, LOBSTR_ID };

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

export async function connectWithWallet(walletId: string): Promise<string> {
  initKit();
  StellarWalletsKit.setWallet(walletId);
  const { address } = await StellarWalletsKit.fetchAddress();
  return address;
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
