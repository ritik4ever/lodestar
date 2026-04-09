import Link from 'next/link';
import type { AgentEntry } from '@/lib/types';
import ScoreBadge from './ScoreBadge';

function truncateAddr(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

const EXPLORER_URL =
  process.env.NEXT_PUBLIC_EXPLORER_URL ?? 'https://stellar.expert/explorer/testnet';

interface Props {
  agent: AgentEntry;
}

export default function AgentCard({ agent }: Props) {
  const successRate =
    agent.total_payments > 0
      ? Math.round((agent.successful_payments / agent.total_payments) * 100)
      : null;

  return (
    <div className={`card p-6 flex flex-col gap-4 fade-in ${agent.flagged ? 'border-error/40' : ''}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <Link
            href={`/agents/${agent.address}`}
            className="font-semibold text-base leading-snug hover:text-accent transition-colors truncate block"
          >
            {agent.name}
          </Link>
          <a
            href={`${EXPLORER_URL}/account/${agent.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mono text-xs text-secondary hover:text-primary transition-colors"
          >
            {truncateAddr(agent.address)}
          </a>
        </div>
        <ScoreBadge score={agent.score} />
      </div>

      {/* Description */}
      <p className="text-sm text-secondary leading-relaxed line-clamp-2">
        {agent.description}
      </p>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Payments" value={agent.total_payments.toLocaleString()} />
        <Stat
          label="Success rate"
          value={successRate !== null ? `${successRate}%` : '—'}
          highlight={successRate !== null && successRate >= 90}
        />
        <Stat
          label="Status"
          value={agent.flagged ? 'Flagged' : agent.active ? 'Active' : 'Inactive'}
          error={agent.flagged || !agent.active}
        />
      </div>

      {/* Footer */}
      <div className="border-t border-border pt-3 mt-1 flex items-center justify-between">
        <span className="text-xs text-secondary">Ledger #{agent.registered_at.toLocaleString()}</span>
        <Link
          href={`/agents/${agent.address}`}
          className="text-xs text-accent hover:underline font-medium"
        >
          View profile →
        </Link>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
  error,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  error?: boolean;
}) {
  return (
    <div className="bg-background rounded-lg px-3 py-2 border border-border text-center">
      <div
        className={`mono text-sm font-semibold ${
          error ? 'text-error' : highlight ? 'text-success' : 'text-primary'
        }`}
      >
        {value}
      </div>
      <div className="text-xs text-secondary mt-0.5">{label}</div>
    </div>
  );
}
