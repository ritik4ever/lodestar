'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { FreighterStatus } from '@/lib/types';
import {
  initKit,
  connectWithWallet,
  getBalance,
  disconnectWallet,
  getWalletHint,
  persistWalletHint,
  restoreWalletConnection,
} from '@/lib/wallet';

interface WalletContextValue {
  status: FreighterStatus;
  address: string;
  balance: string;
  /** True while a persisted connection is being restored on mount (#838). */
  restoring: boolean;
  connect: (walletId: string) => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextValue>({
  status: 'not-connected',
  address: '',
  balance: '',
  restoring: false,
  connect: async () => {},
  disconnect: () => {},
});

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus]   = useState<FreighterStatus>('not-connected');
  const [address, setAddress] = useState('');
  const [balance, setBalance] = useState('');
  // Start in the restoring state only when a hint actually exists, so a first-time
  // visitor never sees a spinner for a connection that was never made.
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    initKit();

    if (!getWalletHint()) return;

    let cancelled = false;
    setRestoring(true);

    // Re-verify with the provider rather than trusting the stored address: the
    // user may have locked the wallet, revoked the site, switched accounts, or
    // uninstalled the extension since the last visit.
    (async () => {
      try {
        const restored = await restoreWalletConnection();
        if (cancelled) return;

        if (!restored) {
          setStatus('not-connected');
          return;
        }

        setAddress(restored);
        setStatus('connected');

        const bal = await getBalance(restored);
        if (!cancelled) setBalance(bal);
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async (walletId: string) => {
    try {
      const addr = await connectWithWallet(walletId);
      setAddress(addr);
      setStatus('connected');
      // Persist only the wallet id and public address — never key material (#838).
      persistWalletHint(walletId, addr);
      const bal = await getBalance(addr);
      setBalance(bal);
    } catch (error: any) {
      setStatus('not-connected');
      throw error;
    }
  }, []);

  const disconnect = useCallback(() => {
    disconnectWallet();
    setStatus('not-connected');
    setAddress('');
    setBalance('');
  }, []);

  return (
    <WalletContext.Provider value={{ status, address, balance, restoring, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  return useContext(WalletContext);
}
