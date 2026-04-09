'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { AgentEntry } from '@/lib/types';
import AgentCard from '@/components/AgentCard';
import ScoreBadge from '@/components/ScoreBadge';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/api/agents`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setAgents(data.agents ?? []);
        }
      })
      .catch(() => setError('Could not reach the Lodestar backend'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="flex items-start justify-between mb-10 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight mb-2">Agent Registry</h1>
          <p className="text-secondary text-sm leading-relaxed max-w-xl">
            On-chain trust scores for x402 AI agents. Every payment recorded. Every reputation earned.
          </p>
        </div>
        <Link href="/agents/register" className="btn-primary px-5 py-2.5 text-sm shrink-0">
          Register Agent
        </Link>
      </div>

      {/* Score tiers legend */}
      <div className="card p-5 mb-8 flex flex-wrap gap-3 items-center">
        <span className="text-xs text-secondary font-medium uppercase tracking-widest mr-2">Tiers</span>
        {([0, 150, 450, 750, 1000] as const).map((score) => (
          <ScoreBadge key={score} score={score} showScore={false} />
        ))}
        <span className="text-xs text-secondary ml-2">
          Score = 100 base · +10 per success · −25 per failure
        </span>
      </div>

      {/* Content */}
      {loading && (
        <div className="text-center py-24 text-secondary text-sm">Loading agents…</div>
      )}

      {error && (
        <div className="card p-8 text-center">
          <p className="text-error text-sm mb-2">{error}</p>
          {error.includes('AGENTS_NOT_CONFIGURED') || error.includes('not yet deployed') ? (
            <p className="text-secondary text-xs">
              Deploy the agents contract and set <code className="mono">AGENTS_CONTRACT_ID</code> in your .env
            </p>
          ) : null}
        </div>
      )}

      {!loading && !error && agents.length === 0 && (
        <div className="card p-12 text-center">
          <p className="text-secondary text-sm mb-4">No agents registered yet.</p>
          <Link href="/agents/register" className="btn-primary px-5 py-2.5 text-sm">
            Be the first
          </Link>
        </div>
      )}

      {!loading && !error && agents.length > 0 && (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
          {agents
            .sort((a, b) => b.score - a.score)
            .map((agent) => (
              <AgentCard key={agent.address} agent={agent} />
            ))}
        </div>
      )}
    </div>
  );
}
