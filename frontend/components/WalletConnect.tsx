'use client';

import { useState } from 'react';
import { useWallet } from './WalletContext';
import WalletPickerModal from './WalletPickerModal';

function truncate(addr: string) {
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

export default function WalletConnect() {
  const { status, address, balance, disconnect } = useWallet();
  const [showPicker, setShowPicker] = useState(false);

  if (status === 'connected') {
    return (
      <div className="flex items-center gap-3">
        <span className="mono text-xs text-secondary hidden sm:block">
          {balance} USDC
        </span>
        <div className="flex items-center gap-2 border border-border rounded-full px-3 py-1.5">
          <span className="w-2 h-2 rounded-full bg-success inline-block" />
          <span className="mono text-xs font-medium">{truncate(address)}</span>
          <button
            onClick={disconnect}
            className="text-secondary hover:text-error text-xs ml-1 transition-colors"
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <button onClick={() => setShowPicker(true)} className="btn-primary">
        Connect Wallet
      </button>
      {showPicker && <WalletPickerModal onClose={() => setShowPicker(false)} />}
    </>
  );
}
