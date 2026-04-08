'use client';

import { useState } from 'react';
import { useWallet } from './WalletContext';
import { WALLET_OPTIONS } from '@/lib/wallet';

interface Props {
  onClose: () => void;
}

export default function WalletPickerModal({ onClose }: Props) {
  const { connect } = useWallet();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function handleSelect(walletId: string) {
    setLoading(walletId);
    setError('');
    try {
      await connect(walletId);
      onClose();
    } catch {
      setError('Could not connect. Make sure the wallet extension is installed.');
    } finally {
      setLoading(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-base">Connect Wallet</h2>
          <button
            onClick={onClose}
            className="text-secondary hover:text-primary text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="space-y-2">
          {WALLET_OPTIONS.map((w) => (
            <button
              key={w.id}
              onClick={() => handleSelect(w.id)}
              disabled={loading !== null}
              className="w-full flex items-center gap-4 px-4 py-3 rounded-xl border border-border hover:border-primary hover:bg-background transition-colors text-left disabled:opacity-50"
            >
              <span className="font-medium text-sm flex-1">{w.name}</span>
              {loading === w.id && (
                <span className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full spinner inline-block" />
              )}
            </button>
          ))}
        </div>

        {error && (
          <p className="mt-4 text-xs text-error bg-error/5 border border-error/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <p className="mt-4 text-xs text-secondary text-center">
          Don&apos;t have a wallet?{' '}
          <a
            href="https://www.freighter.app"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            Install Freighter
          </a>
        </p>
      </div>
    </div>
  );
}
