'use client';

import { useState } from 'react';
import { getCategoryMeta } from '@/lib/categoryMeta';
import type { ServiceEntry } from '@/lib/types';
import { submitReputation } from '@/lib/contract';

const EXPLORER_URL =
  process.env.NEXT_PUBLIC_EXPLORER_URL ?? 'https://stellar.expert/explorer/testnet';

function truncateAddr(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function truncateEndpoint(url: string) {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname !== '/' ? u.pathname : '');
  } catch {
    return url.length > 40 ? url.slice(0, 40) + '…' : url;
  }
}

interface Props {
  service: ServiceEntry;
  onReputationChange?: (id: number, newRep: number) => void;
}

export default function ServiceCard({ service, onReputationChange }: Props) {
  const [copied, setCopied] = useState(false);
  const [reputation, setReputation] = useState(service.reputation);
  const [voting, setVoting] = useState(false);
  const [pendingTx, setPendingTx] = useState<string | null>(null);
  const [voteError, setVoteError] = useState('');
  const category = getCategoryMeta(service.category);

  function copyEndpoint() {
    navigator.clipboard.writeText(service.endpoint);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function vote(positive: boolean) {
    if (voting) return;
    setVoting(true);
    setVoteError('');
    setPendingTx(null);
    try {
      const res = await submitReputation(service.id, positive);
      if (res.txHash) {
        setPendingTx(res.txHash);
        // Show pending state briefly before updating reputation
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      setReputation(res.newReputation);
      onReputationChange?.(service.id, res.newReputation);
    } catch (err) {
      setVoteError(err instanceof Error ? err.message : 'Vote failed');
    } finally {
      setVoting(false);
    }
  }

  const ledger =
  service.registered_at != null
    ? `Ledger #${service.registered_at.toLocaleString()}`
    : "Ledger unavailable";

  return (
    <div className="card p-6 flex flex-col gap-4 fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-base leading-snug">{service.name}</h3>
        <span className={`badge shrink-0 gap-1 ${category.badgeClass}`}>
          {category.icon}
          {category.label}
        </span>
      </div>

      {/* Description */}
      <p className="text-sm text-secondary leading-relaxed line-clamp-2">
        {service.description}
      </p>

      {/* Endpoint */}
      <div className="flex items-center gap-2 bg-background rounded-lg px-3 py-2 border border-border">
        <span className="mono text-xs text-secondary truncate flex-1">
          {truncateEndpoint(service.endpoint)}
        </span>
        <button
          onClick={copyEndpoint}
          className="text-xs text-secondary hover:text-primary transition-colors shrink-0"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* Price + reputation row */}
      <div className="flex items-center justify-between">
        <span className="mono text-sm font-medium text-accent">
          ${service.price_usdc} USDC
        </span>

        <div className="flex items-center gap-2">
          <button
            onClick={() => vote(false)}
            disabled={voting}
            className="text-secondary hover:text-error transition-colors text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            −
          </button>
          <span className={`mono text-xs font-medium ${reputation > 0 ? 'text-success' : reputation < 0 ? 'text-error' : 'text-secondary'}`}>
            {reputation > 0 ? '+' : ''}{reputation}
          </span>
          <button
            onClick={() => vote(true)}
            disabled={voting}
            className="text-secondary hover:text-success transition-colors text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            +
          </button>
        </div>
      </div>

      {pendingTx && (
        <div className="flex items-center gap-2 text-xs text-secondary bg-background rounded-lg px-3 py-2 border border-border">
          <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full spinner" />
          <span className="truncate flex-1">Confirming vote...</span>
          <a
            href={`${EXPLORER_URL}/tx/${pendingTx}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline shrink-0"
          >
            View
          </a>
        </div>
      )}

      {voteError && (
        <p className="text-error text-xs bg-error/5 border border-error/20 rounded-lg px-3 py-2">
          {voteError}
        </p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border pt-3 mt-1">
        <a
          href={`${EXPLORER_URL}/account/${service.provider}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mono text-xs text-secondary hover:text-primary transition-colors"
        >
          {truncateAddr(service.provider)}
        </a>
        <span className="text-xs text-secondary mono">{ledger}</span>
      </div>

      <button
        onClick={copyEndpoint}
        disabled={voting}
        className="btn-secondary w-full text-center text-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Use Endpoint
      </button>
    </div>
  );
}
