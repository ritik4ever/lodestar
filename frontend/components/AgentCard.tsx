import Link from 'next/link';
import type { AgentEntry } from '@/lib/types';
import ScoreBadge from './ScoreBadge';
import StellarAddress from './StellarAddress';

interface Props {
  agent: AgentEntry;
}

export default function AgentCard({ agent }: Props) {
  const totalPayments = Number(agent.total_payments);
  const successRate =
    totalPayments > 0
      ? Math.round((Number(agent.successful_payments) / totalPayments) * 100)
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
          <StellarAddress address={agent.address} className="text-xs" />
        </div>
        <ScoreBadge score={agent.score} />
      </div>

      {/* Description */}
      <p className="text-sm text-secondary leading-relaxed line-clamp-2">
        {agent.description}
      </p>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Payments" value={totalPayments.toLocaleString()} />
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
        <span className="text-xs text-secondary">Ledger #{Number(agent.registered_at).toLocaleString()}</span>
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
