/**
 * Wallet connection persistence across reloads (#838).
 *
 * Covers the storage helpers (what is written, and what is deliberately not),
 * the re-verification path on restore, and the WalletProvider mount behaviour.
 *
 * The wallet kit itself is stubbed — everything in `lib/wallet.ts` and
 * `WalletContext` runs for real against it, so the restore path exercises the
 * actual provider round trip rather than a mocked shortcut.
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';

// The wallet-kit ships ESM that Jest cannot transform; every entrypoint
// lib/wallet.ts imports is stubbed so the module under test can load.
jest.mock('@creit-tech/stellar-wallets-kit/sdk', () => ({
  StellarWalletsKit: {
    init: jest.fn(),
    setWallet: jest.fn(),
    fetchAddress: jest.fn(),
    signTransaction: jest.fn(),
  },
}));
jest.mock('@creit-tech/stellar-wallets-kit/modules/freighter', () => ({
  FreighterModule: class {},
  FREIGHTER_ID: 'freighter',
}));
jest.mock('@creit-tech/stellar-wallets-kit/modules/albedo', () => ({
  AlbedoModule: class {},
  ALBEDO_ID: 'albedo',
}));
jest.mock('@creit-tech/stellar-wallets-kit/modules/xbull', () => ({
  xBullModule: class {},
  XBULL_ID: 'xbull',
}));
jest.mock('@creit-tech/stellar-wallets-kit/modules/lobstr', () => ({
  LobstrModule: class {},
  LOBSTR_ID: 'lobstr',
}));
jest.mock('@creit-tech/stellar-wallets-kit/types', () => ({
  Networks: { TESTNET: 'Test SDF Network ; September 2015' },
}));

import { StellarWalletsKit } from '@creit-tech/stellar-wallets-kit/sdk';
import {
  persistWalletHint,
  getWalletHint,
  clearWalletHint,
  restoreWalletConnection,
  disconnectWallet,
  FREIGHTER_ID,
} from '@/lib/wallet';
import { WalletProvider, useWallet } from '@/components/WalletContext';

const kit = StellarWalletsKit as unknown as {
  init: jest.Mock;
  setWallet: jest.Mock;
  fetchAddress: jest.Mock;
};

const ADDRESS = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTU';
const OTHER_ADDRESS = 'GZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ';
const HINT_KEY = 'lodestar.wallet.hint';

function Probe() {
  const { status, address, balance, restoring } = useWallet();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="address">{address}</span>
      <span data-testid="balance">{balance}</span>
      <span data-testid="restoring">{String(restoring)}</span>
    </div>
  );
}

describe('wallet persistence (#838)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.clearAllMocks();
    kit.setWallet.mockResolvedValue(undefined);
    kit.fetchAddress.mockResolvedValue(ADDRESS);

    // getBalance hits Horizon directly.
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        balances: [{ asset_type: 'credit_alphanum4', asset_code: 'USDC', balance: '12.34000' }],
      }),
    }) as unknown as typeof fetch;
  });

  describe('stored hint', () => {
    it('persists the wallet id and public address', () => {
      persistWalletHint(FREIGHTER_ID, ADDRESS);

      expect(getWalletHint()).toMatchObject({ walletId: FREIGHTER_ID, address: ADDRESS });
    });

    it('persists no secret material', () => {
      persistWalletHint(FREIGHTER_ID, ADDRESS);

      const raw = window.localStorage.getItem(HINT_KEY)!;
      const parsed = JSON.parse(raw);

      // Only three keys: a wallet id, a public address, a timestamp.
      expect(Object.keys(parsed).sort()).toEqual(['address', 'savedAt', 'walletId']);
      for (const forbidden of ['secret', 'seed', 'privatekey', 'signature', 'token', 'xdr', 'mnemonic']) {
        expect(raw.toLowerCase()).not.toContain(forbidden);
      }
    });

    it('ignores a corrupt entry', () => {
      window.localStorage.setItem(HINT_KEY, 'not json');

      expect(getWalletHint()).toBeNull();
    });

    it('ignores a hint naming an unknown wallet', () => {
      window.localStorage.setItem(
        HINT_KEY,
        JSON.stringify({ walletId: 'evil-wallet', address: ADDRESS, savedAt: Date.now() }),
      );

      expect(getWalletHint()).toBeNull();
    });

    it('clears on request', () => {
      persistWalletHint(FREIGHTER_ID, ADDRESS);
      clearWalletHint();

      expect(getWalletHint()).toBeNull();
    });

    it('is dropped on explicit disconnect', () => {
      persistWalletHint(FREIGHTER_ID, ADDRESS);
      disconnectWallet();

      expect(getWalletHint()).toBeNull();
    });
  });

  describe('restoration re-verifies with the provider', () => {
    it('asks the provider rather than trusting the stored address', async () => {
      persistWalletHint(FREIGHTER_ID, ADDRESS);

      const restored = await restoreWalletConnection();

      expect(kit.setWallet).toHaveBeenCalledWith(FREIGHTER_ID);
      expect(kit.fetchAddress).toHaveBeenCalled();
      expect(restored).toBe(ADDRESS);
    });

    it('trusts the provider when the account changed since the last visit', async () => {
      persistWalletHint(FREIGHTER_ID, ADDRESS);
      kit.fetchAddress.mockResolvedValue(OTHER_ADDRESS);

      const restored = await restoreWalletConnection();

      expect(restored).toBe(OTHER_ADDRESS);
      expect(getWalletHint()?.address).toBe(OTHER_ADDRESS);
    });

    it('clears the hint when the user rejects', async () => {
      persistWalletHint(FREIGHTER_ID, ADDRESS);
      kit.fetchAddress.mockRejectedValue(new Error('User rejected the request'));

      expect(await restoreWalletConnection()).toBeNull();
      expect(getWalletHint()).toBeNull();
    });

    it('clears the hint when the wallet is no longer installed', async () => {
      persistWalletHint(FREIGHTER_ID, ADDRESS);
      kit.fetchAddress.mockRejectedValue(new Error('Freighter is not installed'));

      expect(await restoreWalletConnection()).toBeNull();
      expect(getWalletHint()).toBeNull();
    });

    it('does nothing when there is no hint', async () => {
      expect(await restoreWalletConnection()).toBeNull();
      expect(kit.fetchAddress).not.toHaveBeenCalled();
    });
  });

  describe('WalletProvider on mount', () => {
    it('restores a connection after a reload', async () => {
      persistWalletHint(FREIGHTER_ID, ADDRESS);

      render(
        <WalletProvider>
          <Probe />
        </WalletProvider>,
      );

      await waitFor(() => expect(screen.getByTestId('address')).toHaveTextContent(ADDRESS));
      expect(screen.getByTestId('status')).toHaveTextContent('connected');
      await waitFor(() => expect(screen.getByTestId('balance')).toHaveTextContent('12.3400'));
    });

    it('stays disconnected when nothing was persisted', async () => {
      render(
        <WalletProvider>
          <Probe />
        </WalletProvider>,
      );

      // initKit() has a module-level once-guard, so its call count is not a
      // reliable per-test signal; assert the observable state instead.
      await waitFor(() => expect(screen.getByTestId('restoring')).toHaveTextContent('false'));
      expect(screen.getByTestId('status')).toHaveTextContent('not-connected');
      expect(screen.getByTestId('restoring')).toHaveTextContent('false');
      expect(kit.fetchAddress).not.toHaveBeenCalled();
    });

    it('falls back to disconnected when restoration fails', async () => {
      persistWalletHint(FREIGHTER_ID, ADDRESS);
      kit.fetchAddress.mockRejectedValue(new Error('Wallet is locked'));

      render(
        <WalletProvider>
          <Probe />
        </WalletProvider>,
      );

      await waitFor(() => expect(screen.getByTestId('restoring')).toHaveTextContent('false'));
      expect(screen.getByTestId('status')).toHaveTextContent('not-connected');
      expect(screen.getByTestId('address')).toHaveTextContent('');
      expect(getWalletHint()).toBeNull();
    });

    it('signals restoring only while a hint is being verified', async () => {
      persistWalletHint(FREIGHTER_ID, ADDRESS);
      let resolveFetch: (value: string) => void = () => {};
      kit.fetchAddress.mockReturnValue(new Promise<string>((r) => { resolveFetch = r; }));

      render(
        <WalletProvider>
          <Probe />
        </WalletProvider>,
      );

      await waitFor(() => expect(screen.getByTestId('restoring')).toHaveTextContent('true'));

      await act(async () => {
        resolveFetch(ADDRESS);
      });

      await waitFor(() => expect(screen.getByTestId('restoring')).toHaveTextContent('false'));
      expect(screen.getByTestId('status')).toHaveTextContent('connected');
    });
  });
});
