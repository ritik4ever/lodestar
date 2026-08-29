'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { FreighterStatus, WalletErrorState } from '@/lib/types';
import { initKit, connectWithWallet, getBalance, disconnectWallet, EXPECTED_NETWORK_PASSPHRASE } from '@/lib/wallet';
import { probeFreighterState, getNetworkDisplayName } from '@/lib/freighter';
import { getNetwork } from '@stellar/freighter-api';

interface WalletContextValue {
  status: FreighterStatus;
  address: string;
  balance: string;
  connect: (walletId: string) => Promise<void>;
  disconnect: () => void;
  /** Detailed error information for rendering actionable UI messages */
  walletError: WalletErrorState | null;
  /** Re-probe Freighter state (e.g., after user installed/unlocked the extension) */
  refreshState: () => Promise<void>;
}

const WalletContext = createContext<WalletContextValue>({
  status: 'not-connected',
  address: '',
  balance: '',
  connect: async () => {},
  disconnect: () => {},
  walletError: null,
  refreshState: async () => {},
});

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus]   = useState<FreighterStatus>('not-connected');
  const [address, setAddress] = useState('');
  const [balance, setBalance] = useState('');
  const [walletError, setWalletError] = useState<WalletErrorState | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      initKit();
      refreshState();
    }
  }, []);

  const refreshState = useCallback(async () => {
    // Only probe if we're not already connected
    if (status === 'connected') return;

    try {
      const result = await probeFreighterState(EXPECTED_NETWORK_PASSPHRASE);
      setStatus(result.status);
      if (result.status !== 'not-connected' && result.message) {
        setWalletError({
          type: result.status,
          message: result.message,
          currentNetwork: result.currentNetwork,
          requiredNetwork: result.requiredNetwork,
        });
      } else {
        setWalletError(null);
      }
    } catch {
      // If probing fails entirely, default to not-connected
      setStatus('not-connected');
      setWalletError(null);
    }
  }, [status]);

  const connect = useCallback(async (walletId: string) => {
    try {
      const addr = await connectWithWallet(walletId);
      setAddress(addr);
      setStatus('connected');
      setWalletError(null);

      // After connecting, verify the network
      try {
        const networkResult = await getNetwork();
        if (!networkResult.error && networkResult.networkPassphrase !== EXPECTED_NETWORK_PASSPHRASE) {
          const currentName = getNetworkDisplayName(networkResult.networkPassphrase);
          const requiredName = getNetworkDisplayName(EXPECTED_NETWORK_PASSPHRASE);
          setStatus('wrong-network');
          setWalletError({
            type: 'wrong-network',
            message: `Freighter is connected to ${currentName} but Lodestar requires ${requiredName}.`,
            currentNetwork: currentName,
            requiredNetwork: requiredName,
          });
          return; // Don't fetch balance on wrong network
        }
      } catch {
        // Network check failed silently; proceed optimistically
      }

      const bal = await getBalance(addr);
      setBalance(bal);
    } catch (error: any) {
      const errMsg = error?.message?.toLowerCase() || String(error).toLowerCase();

      if (
        error?.type === 'WALLET_NOT_FOUND' ||
        errMsg.includes('not installed') ||
        errMsg.includes('not found') ||
        errMsg.includes('is not available')
      ) {
        setStatus('not-installed');
        setWalletError({
          type: 'not-installed',
          message: 'Freighter extension is not installed.',
        });
      } else if (
        errMsg.includes('locked') ||
        errMsg.includes('log in') ||
        errMsg.includes('login') ||
        errMsg.includes('unlock') ||
        errMsg.includes('password')
      ) {
        setStatus('locked');
        setWalletError({
          type: 'locked',
          message: 'Freighter is locked. Please unlock the extension to continue.',
        });
      } else {
        setStatus('not-connected');
        setWalletError({
          type: 'not-connected',
          message: error?.message || 'Unable to connect wallet. Please try again.',
        });
      }
      throw error;
    }
  }, []);

  const disconnect = useCallback(() => {
    disconnectWallet();
    setStatus('not-connected');
    setAddress('');
    setBalance('');
    setWalletError(null);
  }, []);

  return (
    <WalletContext.Provider value={{ status, address, balance, connect, disconnect, walletError, refreshState }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  return useContext(WalletContext);
}
