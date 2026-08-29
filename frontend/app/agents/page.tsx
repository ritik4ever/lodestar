'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import type { AgentsResponse, AgentStats, AgentSortOption, ScoreTier } from '@/lib/types';
import { scoreTier, TIER_LABELS, TIER_COLORS } from '@/lib/types';
import { fetchAgents, fetchAgentStats } from '@/lib/contract';
import { sortAgents } from '@/lib/sort';
import AgentCard from '@/components/AgentCard';
import AgentCardSkeleton from '@/components/AgentCardSkeleton';
import ScoreBadge from '@/components/ScoreBadge';

const SORTS: { label: string; value: AgentSortOption }[] = [
  { label: 'Highest Score', value: 'score' },
  { label: 'Most Active', value: 'payments' },
  { label: 'Newest', value: 'newest' },
];

import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from '@/lib/pagination';

export default function AgentsPage() {
  const [sort, setSort] = useState<AgentSortOption>('score');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE);
  const [tierFilter, setTierFilter] = useState<ScoreTier | null>(null);

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
    ['agents', page, pageSize, sort],
    () => fetchAgents(page, pageSize, sort),
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

  const allAgents = data?.agents ?? [];
  const agents = tierFilter
    ? allAgents.filter((a) => scoreTier(a.score) === tierFilter)
    : allAgents;
  const total = data?.total ?? 0;
  const loading = isLoading && !data;
  const refreshing = isValidating && !isLoading;
  const error = agentsError
    ? agentsError instanceof Error
      ? agentsError.message
      : 'Failed to load'
    : null;

  // Sort agents locally based on the selected sort option
  const sortedAgents = sortAgents(agents, sort);

  // Clamp the page if the dataset shrank (e.g. agents removed between polls).
  useEffect(() => {
    if (!data) return;
    const maxPage = data.total > 0 ? Math.max(0, Math.ceil(data.total / pageSize) - 1) : 0;
    if (page > maxPage) setPage(maxPage);
  }, [data, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageStart = page * pageSize;

  function handleSortChange(next: AgentSortOption) {
    setSort(next);
    setPage(0);
  }

  function handlePageSizeChange(next: number) {
    setPageSize(next);
    setPage(0);
  }

  function handleTierFilter(tier: ScoreTier) {
    setTierFilter((prev) => (prev === tier ? null : tier));
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

      {/* Score tier filter chips */}
      <div className="card p-4 mb-8 flex flex-wrap gap-2 items-center">
        <span className="text-xs text-secondary font-medium uppercase tracking-widest mr-2">Filter by tier</span>
        {(['new', 'building', 'established', 'trusted', 'elite'] as ScoreTier[]).map((tier) => {
          const active = tierFilter === tier;
          return (
            <button
              key={tier}
              onClick={() => handleTierFilter(tier)}
              aria-pressed={active}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                active
                  ? `${TIER_COLORS[tier]} border-current`
                  : 'border-border text-secondary hover:border-primary hover:text-primary bg-background'
              }`}
            >
              {TIER_LABELS[tier]}
            </button>
          );
        })}
        {tierFilter && (
          <button
            onClick={() => { setTierFilter(null); setPage(0); }}
            className="ml-auto text-xs text-secondary hover:text-primary underline"
          >
            Clear filter
          </button>
        )}
        {!tierFilter && (
          <span className="text-xs text-secondary ml-auto">
            +10 per success · −25 per failure · cap 1000
          </span>
        )}
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

      {!loading && !error && total === 0 && (
        <div className="card p-12 text-center">
          <p className="text-secondary text-sm mb-4">No agents registered yet.</p>
          <Link href="/agents/register" className="btn-primary px-5 py-2.5 text-sm">
            Be the first
          </Link>
        </div>
      )}

      {!loading && !error && total > 0 && (
        <div className={refreshing ? 'opacity-60 transition-opacity duration-150' : ''}>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
            {sortedAgents.map((agent) => (
              <AgentCard key={agent.address} agent={agent} />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-8 gap-4">
              <span className="text-sm text-secondary">
                Showing {pageStart + 1}–{Math.min(pageStart + pageSize, total)} of {total}
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