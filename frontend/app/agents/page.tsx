'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import type { AgentsResponse, AgentStats, AgentSortOption, ScoreTier } from '@/lib/types';
import { TIER_LABELS } from '@/lib/types';
import { fetchAgents, fetchAgentStats } from '@/lib/contract';
import AgentCard from '@/components/AgentCard';
import AgentCardSkeleton from '@/components/AgentCardSkeleton';
import ScoreBadge from '@/components/ScoreBadge';

const SORTS: { label: string; value: AgentSortOption }[] = [
  { label: 'Highest Score', value: 'score' },
  { label: 'Most Active', value: 'payments' },
  { label: 'Newest', value: 'newest' },
];

const TIER_FILTERS: { label: string; value: ScoreTier | 'all' }[] = [
  { label: 'All', value: 'all' },
  ...(['new', 'building', 'established', 'trusted', 'elite'] as const).map((value) => ({
    label: TIER_LABELS[value],
    value,
  })),
];

import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from '@/lib/pagination';

export default function AgentsPage() {
  const [sort, setSort] = useState<AgentSortOption>('score');
  const [activeTier, setActiveTier] = useState<ScoreTier | 'all'>('all');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE);

  // SWR replaces the manual setInterval poll: it dedupes concurrent requests,
  // revalidates every 30s, and only re-renders when the returned data changes.
  // keepPreviousData keeps the old page visible (dimmed) while a refresh is in flight.
  const {
    data,
    error: agentsError,
    isLoading,
    isValidating,
    mutate,
  } = useSWR<AgentsResponse>(
    ['agents', page, pageSize, sort, activeTier],
    () => fetchAgents(page, pageSize, sort, activeTier),
    { refreshInterval: 30_000, revalidateOnFocus: false, keepPreviousData: true }
  );

  // Stats failure is intentionally tolerated (the original code used
  // Promise.allSettled and only set stats on success) — a stats error must not
  // block the agent grid. We still expose mutateStats so Retry revalidates both.
  const { data: stats = null, mutate: mutateStats } = useSWR<AgentStats>(
    'agent-stats',
    () => fetchAgentStats(),
    { refreshInterval: 30_000, revalidateOnFocus: false, keepPreviousData: true }
  );

  const agents = data?.agents ?? [];
  const total = data?.total ?? 0;
  const loading = isLoading && !data;
  const refreshing = isValidating && !isLoading;
  const error = agentsError
    ? agentsError instanceof Error
      ? agentsError.message
      : 'Failed to load'
    : null;

  const hasAnyAgents = total > 0;
  const statsAvailable = stats !== null;
  const showNoAgentsState = !loading && !error && !hasAnyAgents && (!statsAvailable || (stats?.totalAgents ?? 0) === 0);
  const showTierEmptyState = !loading && !error && !hasAnyAgents && statsAvailable && (stats?.totalAgents ?? 0) > 0;

  const visibleCount = total;

  // Clamp the page if the filtered dataset shrank (e.g. agents removed or tier changed).
  useEffect(() => {
    const maxPage = visibleCount > 0 ? Math.max(0, Math.ceil(visibleCount / pageSize) - 1) : 0;
    if (page > maxPage) setPage(maxPage);
  }, [page, pageSize, visibleCount]);

  const totalPages = Math.max(1, Math.ceil(visibleCount / pageSize));
  const pageStart = page * pageSize;
  const pagedAgents = agents;

  function handleSortChange(next: AgentSortOption) {
    setSort(next);
    setPage(0);
  }

  function handlePageSizeChange(next: number) {
    setPageSize(next);
    setPage(0);
  }

  function handleTierChange(next: ScoreTier | 'all') {
    setActiveTier(next);
    setPage(0);
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-semibold">Agent Registry</h1>
            {!loading && (
              <span className="badge bg-primary text-white mono">{total}</span>
            )}
          </div>
          <p className="text-secondary text-sm leading-relaxed max-w-xl">
            On-chain trust scores for x402 AI agents. Every payment recorded. Every reputation earned.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <select
            value={sort}
            onChange={(e) => handleSortChange(e.target.value as AgentSortOption)}
            aria-label="Sort agents"
            className="border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <select
            value={pageSize}
            onChange={(e) => handlePageSizeChange(Number(e.target.value))}
            aria-label="Page size"
            className="border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n} per page</option>
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
      <div className="card p-4 mb-6 flex flex-wrap gap-3 items-center">
        <span className="text-xs text-secondary font-medium uppercase tracking-widest mr-2">Score tiers</span>
        {([100, 450, 700, 950, 1000] as const).map((score) => (
          <ScoreBadge key={score} score={score} showScore={false} />
        ))}
        <span className="text-xs text-secondary ml-auto">
          +10 per success · −25 per failure · cap 1000
        </span>
      </div>

      <div className="flex flex-wrap gap-2 mb-8" role="group" aria-label="Filter agents by score tier">
        {TIER_FILTERS.map((tier) => (
          <button
            key={tier.value}
            type="button"
            onClick={() => handleTierChange(tier.value)}
            aria-pressed={activeTier === tier.value}
            className={`px-4 py-1.5 rounded-full text-sm border transition-colors focus:outline-none focus:ring-1 focus:ring-primary ${
              activeTier === tier.value
                ? 'bg-primary text-white border-primary'
                : 'border-border text-secondary hover:border-primary hover:text-primary'
            }`}
          >
            {tier.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading && (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <AgentCardSkeleton key={i} />
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
          ) : (
            <button
              onClick={() => { mutate(); mutateStats(); }}
              aria-label="Retry"
              className="mt-3 px-4 py-2 text-sm rounded-lg border border-border bg-background hover:bg-border/40 transition-colors"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {!loading && !error && showNoAgentsState && (
        <div className="card p-12 text-center">
          <p className="text-secondary text-sm mb-4">No agents registered yet.</p>
          <Link href="/agents/register" className="btn-primary px-5 py-2.5 text-sm">
            Be the first
          </Link>
        </div>
      )}

      {!loading && !error && showTierEmptyState && (
        <div className="card p-12 text-center">
          <p className="text-secondary text-sm mb-4">No agents match the selected tier.</p>
          <button
            type="button"
            onClick={() => handleTierChange('all')}
            className="btn-primary px-5 py-2.5 text-sm"
          >
            Show all agents
          </button>
        </div>
      )}

      {!loading && !error && hasAnyAgents && total > 0 && (
        <div className={refreshing ? 'opacity-60 transition-opacity duration-150' : ''}>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
            {pagedAgents.map((agent) => (
              <AgentCard key={agent.address} agent={agent} />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-8 gap-4">
              <span className="text-sm text-secondary">
                Showing {pageStart + 1}–{Math.min(pageStart + pageSize, visibleCount)} of {visibleCount}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => p - 1)}
                  disabled={page === 0}
                  aria-label="Previous page"
                  className="px-4 py-2 text-sm rounded-lg border border-border bg-background hover:bg-border/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Prev
                </button>
                <span className="text-sm text-secondary mono px-2">
                  {page + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= totalPages - 1}
                  aria-label="Next page"
                  className="px-4 py-2 text-sm rounded-lg border border-border bg-background hover:bg-border/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
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