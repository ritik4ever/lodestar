'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { FreighterStatus } from '@/lib/types';
import { isFreighterInstalled, connectWallet, getBalance } from '@/lib/freighter';

interface WalletContextValue {
  status: FreighterStatus;
  address: string;
  balance: string;
  connect: () => Promise<void>;
}

const WalletContext = createContext<WalletContextValue>({
  status: 'not-installed',
  address: '',
  balance: '',
  connect: async () => {},
});

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<FreighterStatus>('not-installed');
  const [address, setAddress] = useState('');
  const [balance, setBalance] = useState('');

  useEffect(() => {
    if (isFreighterInstalled()) {
      setStatus('not-connected');
    }
  }, []);

  const connect = useCallback(async () => {
    try {
      const addr = await connectWallet();
      setAddress(addr);
      setStatus('connected');
      const bal = await getBalance(addr);
      setBalance(bal);
    } catch {
      setStatus('not-connected');
    }
  }, []);

  return (
    <WalletContext.Provider value={{ status, address, balance, connect }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  return useContext(WalletContext);
}
