'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { FreighterStatus } from '@/lib/types';
import { initKit, connectWithWallet, getBalance } from '@/lib/wallet';

interface WalletContextValue {
  status: FreighterStatus;
  address: string;
  balance: string;
  connect: (walletId: string) => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextValue>({
  status: 'not-connected',
  address: '',
  balance: '',
  connect: async () => {},
  disconnect: () => {},
});

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus]   = useState<FreighterStatus>('not-connected');
  const [address, setAddress] = useState('');
  const [balance, setBalance] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') initKit();
  }, []);

  const connect = useCallback(async (walletId: string) => {
    try {
      const addr = await connectWithWallet(walletId);
      setAddress(addr);
      setStatus('connected');
      const bal = await getBalance(addr);
      setBalance(bal);
    } catch {
      setStatus('not-connected');
      throw new Error('Failed to connect wallet');
    }
  }, []);

  const disconnect = useCallback(() => {
    setStatus('not-connected');
    setAddress('');
    setBalance('');
  }, []);

  return (
    <WalletContext.Provider value={{ status, address, balance, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  return useContext(WalletContext);
}
