'use client';

import { useState } from 'react';

interface Props {
  address: string;
  className?: string;
}

const EXPLORER_URL =
  process.env.NEXT_PUBLIC_EXPLORER_URL ?? 'https://stellar.expert/explorer/testnet';

export default function StellarAddress({ address, className = '' }: Props) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  if (!address) return null;

  const truncated = address.length >= 10
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : address;

  return (
    <div className={`inline-flex items-center gap-1.5 mono ${className}`}>
      {/* Screen reader only full address description */}
      <span className="sr-only">Stellar address: {address}</span>

      {/* Address Link & Tooltip wrapper */}
      <div className="relative group">
        <a
          href={`${EXPLORER_URL}/account/${address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-secondary hover:text-primary transition-colors hover:underline"
          aria-label={`View account ${address} on Stellar Expert`}
        >
          {truncated}
        </a>

        {/* Custom Premium Tooltip */}
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-primary text-white text-xs px-2.5 py-1.5 rounded-lg whitespace-nowrap z-50 shadow-lg pointer-events-none transition-opacity duration-200">
          <span className="font-mono text-[11px] select-all">{address}</span>
          {/* Arrow indicator */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-primary" />
        </div>
      </div>

      {/* Copy Action Button */}
      <button
        onClick={copyToClipboard}
        className="p-1 rounded text-secondary hover:text-primary hover:bg-border/30 transition-all focus:outline-none focus:ring-1 focus:ring-primary/20 shrink-0"
        title="Copy full address"
        aria-label={copied ? "Address copied" : "Copy Stellar address"}
      >
        {copied ? (
          <span className="text-[10px] font-medium text-success bg-success/10 px-1.5 py-0.5 rounded leading-none">
            Copied
          </span>
        ) : (
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
            />
          </svg>
        )}
      </button>
    </div>
  );
}
