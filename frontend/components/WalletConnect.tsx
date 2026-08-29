'use client';

import { useState } from 'react';
import { useWallet } from './WalletContext';
import WalletPickerModal from './WalletPickerModal';

function truncate(addr: string) {
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

export default function WalletConnect() {
  const { status, address, balance, walletError, disconnect, refreshState } = useWallet();
  const [showPicker, setShowPicker] = useState(false);

  // ── Connected state ──────────────────────────────────────────────
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
            aria-label="Disconnect wallet"
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  // ── Not installed ────────────────────────────────────────────────
  if (status === 'not-installed') {
    return (
      <div className="flex items-center gap-2">
        <a
          href="https://www.freighter.app"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary flex items-center gap-1.5"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7,10 12,15 17,10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Install Freighter
        </a>
        <button
          onClick={refreshState}
          className="text-xs text-secondary hover:text-primary transition-colors"
          title="Re-check for Freighter"
        >
          ↻
        </button>
      </div>
    );
  }

  // ── Locked ───────────────────────────────────────────────────────
  if (status === 'locked') {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600 shrink-0">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span className="text-xs font-medium text-amber-700 whitespace-nowrap">
            Unlock Freighter
          </span>
        </div>
        <button
          onClick={refreshState}
          className="text-xs text-secondary hover:text-primary transition-colors"
          title="Re-check Freighter state"
        >
          ↻
        </button>
      </div>
    );
  }

  // ── Wrong network ────────────────────────────────────────────────
  if (status === 'wrong-network') {
    const current = walletError?.currentNetwork ?? 'unknown network';
    const required = walletError?.requiredNetwork ?? 'Testnet';
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-orange-600 shrink-0">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span className="text-xs text-orange-700 whitespace-nowrap">
            <span className="font-medium">{current}</span>
            <span className="mx-1 text-orange-400">→</span>
            <span className="font-medium">{required}</span>
          </span>
        </div>
        <button
          onClick={refreshState}
          className="text-xs text-secondary hover:text-primary transition-colors"
          title="Re-check network"
        >
          ↻
        </button>
      </div>
    );
  }

  // ── Not connected (default) ──────────────────────────────────────
  return (
    <>
      <button onClick={() => setShowPicker(true)} className="btn-primary">
        Connect Wallet
      </button>
      {showPicker && <WalletPickerModal onClose={() => setShowPicker(false)} />}
    </>
  );
}
