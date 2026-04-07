'use client';

import { useWallet } from './WalletContext';

function truncate(addr: string) {
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

export default function WalletConnect() {
  const { status, address, balance, connect } = useWallet();

  if (status === 'not-installed') {
    return (
      <a
        href="https://freighter.app"
        target="_blank"
        rel="noopener noreferrer"
        className="btn-secondary text-sm"
      >
        Install Freighter
      </a>
    );
  }

  if (status === 'not-connected') {
    return (
      <button onClick={connect} className="btn-primary">
        Connect Wallet
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span className="mono text-xs text-secondary hidden sm:block">
        {balance} USDC
      </span>
      <div className="flex items-center gap-2 border border-border rounded-full px-3 py-1.5">
        <span className="w-2 h-2 rounded-full bg-success inline-block" />
        <span className="mono text-xs font-medium">{truncate(address)}</span>
      </div>
    </div>
  );
}
