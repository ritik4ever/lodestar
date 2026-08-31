'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import type { AgentEntry } from '@/lib/types';
import { fetchAgents, fetchAgentEligibility, fetchAgentSpendCheck } from '@/lib/contract';
import ScoreBadge from './ScoreBadge';

const DEFAULT_PREMIUM_MIN_SCORE = 500;
const DAILY_LIMIT_USDC = '1.00';
const SIMULATE_AMOUNT = '0.80';

type AccessResult = 'granted' | 'denied' | null;
type SpendResult = 'allowed' | 'blocked' | null;

export default function CreditScoreDemo() {
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [accessResults, setAccessResults] = useState<Record<string, AccessResult>>({});
  const [accessDetails, setAccessDetails] = useState<Record<string, string>>({});
  const [spendResult, setSpendResult] = useState<SpendResult>(null);
  const [spendDetail, setSpendDetail] = useState('');
  const [testing, setTesting] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [premiumMinScore, setPremiumMinScore] = useState(DEFAULT_PREMIUM_MIN_SCORE);

  const load = useCallback(async () => {
    try {
      const data = await fetchAgents(0, 3, 'score');
      setAgents(data.agents);
    } catch {
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, [load]);

  async function testAccess(agent: AgentEntry) {
    setTesting(agent.address);
    setAccessResults((prev) => ({ ...prev, [agent.address]: null }));
    setAccessDetails((prev) => ({ ...prev, [agent.address]: '' }));
    try {
      const res = await fetchAgentEligibility(agent.address, premiumMinScore);
      setAccessResults((prev) => ({
        ...prev,
        [agent.address]: res.eligible ? 'granted' : 'denied',
      }));
      setAccessDetails((prev) => ({
        ...prev,
        [agent.address]: res.eligible
          ? `Score ${res.score} ≥ ${premiumMinScore} — access granted`
          : `Score ${res.score} — minimum ${res.required} required`,
      }));
    } catch {
      setAccessResults((prev) => ({ ...prev, [agent.address]: 'denied' }));
      setAccessDetails((prev) => ({ ...prev, [agent.address]: 'Check failed' }));
    } finally {
      setTesting(null);
    }
  }

  async function simulateSpend() {
    if (agents.length < 2) return;
    const established = agents.find((a) => a.score >= 300 && a.score < 900) ?? agents[1];
    setSimulating(true);
    setSpendResult(null);
    setSpendDetail('');
    try {
      const res = await fetchAgentSpendCheck(established.address, SIMULATE_AMOUNT, 'weather');
      setSpendResult(res.allowed ? 'allowed' : 'blocked');
      setSpendDetail(res.allowed
        ? `$${SIMULATE_AMOUNT} USDC within daily limit of $${DAILY_LIMIT_USDC} USDC`
        : res.reason);
    } catch {
      setSpendResult('blocked');
      setSpendDetail('Policy check failed');
    } finally {
      setSimulating(false);
    }
  }

  if (unavailable) return null;

  return (
    <section className="border-t border-border pt-16">
      <div className="mb-8">
        <h2 className="text-2xl font-semibold tracking-tight mb-2">
          Agent Credit Scores — Live Demo
        </h2>
        <p className="text-secondary text-sm leading-relaxed max-w-2xl">
          Three agents, three score levels, three different levels of access. Scores are
          pulled live from the Soroban contract every 10 seconds.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <label htmlFor="premiumMinScore" className="text-sm text-secondary">
            Premium score threshold:
          </label>
          <input
            id="premiumMinScore"
            type="number"
            min={0}
            max={10000}
            step={50}
            value={premiumMinScore}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= 0) setPremiumMinScore(v);
            }}
            className="w-24 bg-background border border-border rounded px-3 py-1.5 text-sm mono text-center focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <span className="text-xs text-secondary">
            Agents scoring ≥ this value get premium access
          </span>
        </div>
      </div>

      {/* Agent cards */}
      {loading ? (
        <div className="grid md:grid-cols-3 gap-5 mb-10">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card p-6 h-48 animate-pulse bg-border/40" />
          ))}
        </div>
      ) : agents.length === 0 ? (
        <div className="card p-8 text-center mb-10">
          <p className="text-secondary text-sm mb-3">No agents seeded yet.</p>
          <p className="text-xs text-secondary mono">Run: npm run seed-agents</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-3 gap-5 mb-10">
          {agents.map((agent) => (
            <div key={agent.address} className="card p-6 flex flex-col gap-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/agents/${agent.address}`}
                    className="font-semibold text-sm leading-snug hover:text-accent transition-colors block truncate"
                  >
                    {agent.name}
                  </Link>
                  <p className="mono text-xs text-secondary mt-0.5">
                    {agent.address.slice(0, 8)}…{agent.address.slice(-4)}
                  </p>
                </div>
                <ScoreBadge score={agent.score} showScore size="sm" />
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-background border border-border rounded px-2 py-1.5 text-center">
                  <div className="mono font-semibold">{Number(agent.total_payments).toLocaleString()}</div>
                  <div className="text-secondary">payments</div>
                </div>
                <div className="bg-background border border-border rounded px-2 py-1.5 text-center">
                  <div className="mono font-semibold text-success">
                    {Number(agent.total_payments) > 0
                      ? `${Math.round((Number(agent.successful_payments) / Number(agent.total_payments)) * 100)}%`
                      : '—'}
                  </div>
                  <div className="text-secondary">success</div>
                </div>
              </div>

              {/* Access test button + result */}
              <div className="mt-auto">
                <button
                  onClick={() => testAccess(agent)}
                  disabled={testing === agent.address}
                  className="w-full btn-secondary text-sm py-2 disabled:opacity-50"
                >
                  {testing === agent.address ? 'Checking…' : `Test Access (score ${premiumMinScore}+)`}
                </button>

                {accessResults[agent.address] && (
                  <div
                    className={`mt-2 rounded-lg px-3 py-2 text-xs font-medium text-center fade-in ${
                      accessResults[agent.address] === 'granted'
                        ? 'bg-success/10 text-success border border-success/20'
                        : 'bg-error/10 text-error border border-error/20'
                    }`}
                  >
                    {accessResults[agent.address] === 'granted' ? 'Access Granted' : 'Access Denied'}
                    <div className="font-normal text-secondary mt-0.5">
                      {accessDetails[agent.address]}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Spending policy simulation */}
      {agents.length >= 2 && (
        <div className="card p-6">
          <h3 className="font-semibold text-base mb-1">Spending Policy Simulation</h3>
          <p className="text-secondary text-sm mb-5">
            The EstablishedAgent has a daily limit of ${DAILY_LIMIT_USDC} USDC.
            Simulate a ${SIMULATE_AMOUNT} USDC transaction to see if it passes.
          </p>

          <div className="flex items-center gap-4 flex-wrap">
            <button
              onClick={simulateSpend}
              disabled={simulating}
              className="btn-primary px-5 py-2.5 text-sm disabled:opacity-50"
            >
              {simulating ? 'Checking policy…' : `Simulate $${SIMULATE_AMOUNT} USDC payment`}
            </button>

            {spendResult && (
              <div
                className={`flex-1 rounded-lg px-4 py-3 text-sm font-medium fade-in ${
                  spendResult === 'allowed'
                    ? 'bg-success/10 text-success border border-success/20'
                    : 'bg-error/10 text-error border border-error/20'
                }`}
              >
                {spendResult === 'allowed' ? 'Transaction Allowed' : 'Transaction Blocked'}
                <span className="font-normal text-secondary ml-2">{spendDetail}</span>
              </div>
            )}
          </div>

          <p className="text-xs text-secondary mt-4">
            Spending limits are enforced at the Soroban contract level — they cannot be bypassed
            even if the agent wallet has sufficient USDC balance.
          </p>
        </div>
      )}
    </section>
  );
}
