'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import type { AgentEntry, AgentStats } from '@/lib/types';
import { fetchAgents, fetchAgentStats } from '@/lib/contract';
import AgentCard from '@/components/AgentCard';
import ScoreBadge from '@/components/ScoreBadge';

type SortOption = 'score' | 'payments' | 'newest';

const SORTS: { label: string; value: SortOption }[] = [
  { label: 'Highest Score', value: 'score' },
  { label: 'Most Active', value: 'payments' },
  { label: 'Newest', value: 'newest' },
];

function sortAgents(agents: AgentEntry[], sort: SortOption): AgentEntry[] {
  return [...agents].sort((a, b) => {
    if (sort === 'score') return b.score - a.score;
    if (sort === 'payments') return b.total_payments - a.total_payments;
    return b.registered_at - a.registered_at;
  });
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [stats, setStats] = useState<AgentStats | null>(null);
  const [sort, setSort] = useState<SortOption>('score');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [agentsData, statsData] = await Promise.all([
        fetchAgents(100),
        fetchAgentStats(),
      ]);
      setAgents(agentsData.agents);
      setStats(statsData);
      setError(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  const sorted = sortAgents(agents, sort);

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-semibold">Agent Registry</h1>
            {!loading && (
              <span className="badge bg-primary text-white mono">{agents.length}</span>
            )}
          </div>
          <p className="text-secondary text-sm leading-relaxed max-w-xl">
            On-chain trust scores for x402 AI agents. Every payment recorded. Every reputation earned.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            className="border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <Link href="/agents/register" className="btn-primary px-5 py-2.5 text-sm">
            Register Agent
          </Link>
        </div>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <StatBox label="Total Agents" value={String(stats.totalAgents)} />
          <StatBox label="Average Score" value={String(stats.avgScore)} />
          <StatBox label="Total Volume" value={`$${stats.totalVolume} USDC`} />
          <StatBox
            label="Top Agent"
            value={stats.topAgent ? stats.topAgent.name : '—'}
            sub={stats.topAgent ? <ScoreBadge score={stats.topAgent.score} showScore size="sm" /> : undefined}
          />
        </div>
      )}

      {/* Score tier legend */}
      <div className="card p-4 mb-8 flex flex-wrap gap-3 items-center">
        <span className="text-xs text-secondary font-medium uppercase tracking-widest mr-2">Score tiers</span>
        {([100, 450, 700, 950, 1000] as const).map((score) => (
          <ScoreBadge key={score} score={score} showScore={false} />
        ))}
        <span className="text-xs text-secondary ml-auto">
          +10 per success · −25 per failure · cap 1000
        </span>
      </div>

      {/* Content */}
      {loading && (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card p-6 h-64 animate-pulse bg-border/40" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="card p-8 text-center">
          <p className="text-error text-sm mb-2">{error}</p>
          {error.includes('AGENTS_NOT_CONFIGURED') || error.includes('not yet deployed') ? (
            <p className="text-secondary text-xs mt-1">
              Deploy the agents contract and set <span className="mono">AGENTS_CONTRACT_ID</span> in your .env
            </p>
          ) : null}
        </div>
      )}

      {!loading && !error && sorted.length === 0 && (
        <div className="card p-12 text-center">
          <p className="text-secondary text-sm mb-4">No agents registered yet.</p>
          <Link href="/agents/register" className="btn-primary px-5 py-2.5 text-sm">
            Be the first
          </Link>
        </div>
      )}

      {!loading && !error && sorted.length > 0 && (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
          {sorted.map((agent) => (
            <AgentCard key={agent.address} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatBox({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
}) {
  return (
    <div className="card p-4 text-center">
      <div className="text-lg font-semibold mono truncate">{value}</div>
      {sub && <div className="flex justify-center mt-1">{sub}</div>}
      <div className="text-xs text-secondary mt-1">{label}</div>
    </div>
  );
}
