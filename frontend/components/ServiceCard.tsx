'use client';

import { useState } from 'react';
import type { ServiceEntry, Category } from '@/lib/types';
import { submitReputation } from '@/lib/contract';

const CATEGORY_COLORS: Record<Category, string> = {
  search:  'bg-blue-50 text-blue-700',
  weather: 'bg-sky-50 text-sky-700',
  finance: 'bg-emerald-50 text-emerald-700',
  ai:      'bg-violet-50 text-violet-700',
  data:    'bg-amber-50 text-amber-700',
  compute: 'bg-rose-50 text-rose-700',
};

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

  function copyEndpoint() {
    navigator.clipboard.writeText(service.endpoint);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function vote(positive: boolean) {
    if (voting) return;
    setVoting(true);
    try {
      const res = await submitReputation(service.id, positive);
      setReputation(res.newReputation);
      onReputationChange?.(service.id, res.newReputation);
    } catch {
      // ignore
    } finally {
      setVoting(false);
    }
  }

  const date = new Date(service.registered_at * 1000 * 5).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="card p-6 flex flex-col gap-4 fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-base leading-snug">{service.name}</h3>
        <span className={`badge shrink-0 ${CATEGORY_COLORS[service.category] ?? 'bg-gray-50 text-gray-700'}`}>
          {service.category}
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
            className="text-secondary hover:text-error transition-colors text-sm disabled:opacity-40"
          >
            −
          </button>
          <span className={`mono text-xs font-medium ${reputation > 0 ? 'text-success' : reputation < 0 ? 'text-error' : 'text-secondary'}`}>
            {reputation > 0 ? '+' : ''}{reputation}
          </span>
          <button
            onClick={() => vote(true)}
            disabled={voting}
            className="text-secondary hover:text-success transition-colors text-sm disabled:opacity-40"
          >
            +
          </button>
        </div>
      </div>

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
        <span className="text-xs text-secondary">{date}</span>
      </div>

      <button
        onClick={copyEndpoint}
        className="btn-secondary w-full text-center text-sm"
      >
        Use Endpoint
      </button>
    </div>
  );
}
