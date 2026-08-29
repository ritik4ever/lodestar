'use client';

import { useEffect, useState, useCallback, ChangeEvent } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { AgentEntry, SpendingPolicy } from '@/lib/types';
import { scoreTier, TIER_LABELS } from '@/lib/types';
import ScoreBadge from '@/components/ScoreBadge';
import SpendingPolicyDisplay from '@/components/SpendingPolicy';
import { fetchAgentEligibility } from '@/lib/contract';
import { useWallet } from '@/components/WalletContext';
import { kitSignTransaction } from '@/lib/wallet';
import { ScoreHistoryChart } from '@/components/ScoreHistoryChart';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const EXPLORER_URL =
  process.env.NEXT_PUBLIC_EXPLORER_URL ?? 'https://stellar.expert/explorer/testnet';

const SCORE_SUCCESS = 10;
const SCORE_FAILURE = -25;
const INITIAL_SCORE = 100;

function buildScoreHistory(totalPayments: number, successfulPayments: number): number[] {
  if (totalPayments === 0) return [INITIAL_SCORE];
  const samples = Math.min(totalPayments + 1, 26);
  const points: number[] = [];
  for (let s = 0; s < samples; s++) {
    const paid = Math.round((s / (samples - 1)) * totalPayments);
    const wins = Math.round((paid / totalPayments) * successfulPayments);
    const losses = paid - wins;
    points.push(Math.max(0, Math.min(1000, INITIAL_SCORE + wins * SCORE_SUCCESS + losses * SCORE_FAILURE)));
  }
  return points;
}

function ScoreSparkline({ points, currentScore }: { points: number[]; currentScore: number }) {
  const W = 300;
  const H = 48;
  const pad = 4;
  const minY = 0;
  const maxY = 1000;
  const toX = (i: number) => pad + (i / (points.length - 1)) * (W - pad * 2);
  const toY = (v: number) => H - pad - ((v - minY) / (maxY - minY)) * (H - pad * 2);
  const polyline = points.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');
  const lastX = toX(points.length - 1);
  const lastY = toY(points[points.length - 1]);
  const color = currentScore >= 800 ? '#f59e0b' : currentScore >= 600 ? '#10b981' : currentScore >= 300 ? '#8b5cf6' : '#3b82f6';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" points={polyline} />
      <circle cx={lastX} cy={lastY} r="3" fill={color} />
    </svg>
  );
}

const ACCESS_TIERS = [
  { label: 'Basic services', minScore: 0 },
  { label: 'Standard services', minScore: 300 },
  { label: 'Premium services', minScore: 600 },
  { label: 'Elite services', minScore: 900 },
];

/** Build an unsigned tx XDR from the backend, sign with wallet, submit. */
async function walletSignAndSubmit(
  address: string,
  callerAddress: string,
  action: string,
  params: Record<string, unknown>
): Promise<void> {
  // 1. Build unsigned XDR
  const buildRes = await fetch(`${API}/api/agents/${address}/build-tx`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-caller-address': callerAddress,
    },
    body: JSON.stringify({ action, ...params }),
  });
  const buildData = await buildRes.json();
  if (!buildRes.ok) throw new Error(buildData.error ?? 'Failed to build transaction');

  // 2. Sign with wallet (Freighter)
  const signedXdr = await kitSignTransaction(buildData.xdr);

  // 3. Submit signed XDR
  const submitRes = await fetch(`${API}/api/agents/${address}/submit-signed-tx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedXdr }),
  });
  const submitData = await submitRes.json();
  if (!submitRes.ok) throw new Error(submitData.error ?? 'Failed to submit transaction');
}

export default function AgentProfilePage() {
  const { address } = useParams<{ address: string }>();
  const { address: walletAddress } = useWallet();
  const [agent, setAgent] = useState<AgentEntry | null>(null);
  const [policy, setPolicy] = useState<SpendingPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [customMinScore, setCustomMinScore] = useState(0);
  const [isEligible, setIsEligible] = useState<boolean | null>(null);
  const [checkingEligibility, setCheckingEligibility] = useState(false);

  const load = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`${API}/api/agents/${address}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setAgent(data.agent ?? data);
        if (data.policy) setPolicy(data.policy);
      }
    } catch {
      setError('Could not reach the Lodestar backend');
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    load();
  }, [load]);

  function copyAddress() {
    if (!agent) return;
    navigator.clipboard.writeText(agent.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const checkEligibility = async () => {
    if (!address) return;
    setCheckingEligibility(true);
    try {
      const data = await fetchAgentEligibility(address, customMinScore);
      setIsEligible(data.eligible);
    } catch (err) {
      console.error('Failed to check eligibility:', err);
      setError('Failed to check eligibility');
    } finally {
      setCheckingEligibility(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="card p-8 h-64 animate-pulse bg-border/40 mb-6" />
        <div className="card p-8 h-40 animate-pulse bg-border/40" />
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-24 text-center">
        <p className="text-error text-sm mb-4">{error ?? 'Agent not found'}</p>
        <Link href="/agents" className="btn-secondary px-5 py-2.5 text-sm">
          Back to agents
        </Link>
      </div>
    );
  }

  const handlePolicyUpdate = async (params: {
    maxPerTxStroops: string;
    maxPerDayStroops: string;
    allowedCategories: string[];
    minScoreToEarn: number;
  }) => {
    if (!address || !walletAddress) throw new Error('Wallet not connected');
    await walletSignAndSubmit(address, walletAddress, 'update_policy', {
      maxPerTxStroops: params.maxPerTxStroops,
      maxPerDayStroops: params.maxPerDayStroops,
      allowedCategories: params.allowedCategories,
      minScoreToEarn: params.minScoreToEarn,
    });
    // Refresh policy after successful update
    const res = await fetch(`${API}/api/agents/${address}`);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error ?? 'Failed to reload policy');
    if (data.policy) setPolicy(data.policy);
  };

  const totalPayments = Number(agent.total_payments);
  const successfulPayments = Number(agent.successful_payments);
  const failedPayments = Number(agent.failed_payments);

  const successRate =
    totalPayments > 0
      ? Math.round((successfulPayments / totalPayments) * 100)
      : null;

  const tier = scoreTier(agent.score);
  const totalVolumeStroops = BigInt(agent.total_volume_stroops);
  const usdcWhole = totalVolumeStroops / 10_000_000n;
  const usdcCents = totalVolumeStroops % 10_000_000n;
  const totalVolumeUsdc = `${usdcWhole}.${String(usdcCents).padStart(7, '0').slice(0, 4)}`;

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <Link
        href="/agents"
        className="text-sm text-secondary hover:text-primary transition-colors mb-8 inline-block"
      >
        ← All agents
      </Link>

      {/* Profile header */}
      <div className="card p-8 mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight mb-2">{agent.name}</h1>
            <div className="flex items-center gap-2 flex-wrap">
              <a
                href={`${EXPLORER_URL}/account/${agent.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mono text-sm text-secondary hover:text-primary transition-colors truncate"
              >
                {agent.address}
              </a>
              <button
                onClick={copyAddress}
                className="text-xs text-secondary hover:text-primary transition-colors shrink-0"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <ScoreHistoryChart
              currentScore={agent.score}
              totalPayments={totalPayments}
              successfulPayments={successfulPayments}
              failedPayments={failedPayments}
            />
            <ScoreBadge score={agent.score} size="md" />
          </div>
        </div>

        <p className="text-sm text-secondary leading-relaxed mb-6">{agent.description}</p>

        {/* Flagged / inactive banner */}
        {(agent.flagged || !agent.active) && (
          <div className="bg-error/5 border border-error/20 rounded-lg px-4 py-3 mb-6">
            {agent.flagged && (
              <p className="text-sm text-error font-medium">
                Flagged: {agent.flag_reason || 'No reason provided'}
              </p>
            )}
            {!agent.active && !agent.flagged && (
              <p className="text-sm text-secondary">This agent has been deactivated.</p>
            )}
          </div>
        )}

        {/* Score bar */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-secondary">Credit score</span>
            <span className="mono text-sm font-semibold">{agent.score} / 1000</span>
          </div>
          <div className="w-full bg-border rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${
                tier === 'elite'
                  ? 'bg-amber-500'
                  : tier === 'trusted'
                  ? 'bg-emerald-500'
                  : tier === 'established'
                  ? 'bg-violet-500'
                  : tier === 'building'
                  ? 'bg-blue-500'
                  : 'bg-gray-400'
              }`}
              style={{ width: `${(agent.score / 1000) * 100}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-secondary mt-1.5">
            <span>New</span>
            <span>Building</span>
            <span>Established</span>
            <span>Trusted</span>
            <span>Elite</span>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total payments" value={totalPayments.toLocaleString()} />
          <StatCard
            label="Successful"
            value={successfulPayments.toLocaleString()}
            color="success"
          />
          <StatCard
            label="Failed"
            value={failedPayments.toLocaleString()}
            color={failedPayments > 0 ? 'error' : undefined}
          />
          <StatCard
            label="Success rate"
            value={successRate !== null ? `${successRate}%` : '—'}
            color={successRate !== null && successRate >= 90 ? 'success' : undefined}
          />
        </div>

        {/* Score history sparkline */}
        {agent.total_payments > 0 && (
          <div className="mt-4 border-t border-border pt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-secondary">Score trajectory (approx.)</span>
              <span className="mono text-xs text-secondary">100 → {agent.score}</span>
            </div>
            <ScoreSparkline
              points={buildScoreHistory(agent.total_payments, agent.successful_payments)}
              currentScore={agent.score}
            />
            <div className="flex justify-between text-xs text-secondary mt-1">
              <span>Start</span>
              <span>{agent.total_payments} payments</span>
            </div>
          </div>
        )}
      </div>

      {/* Spending policy */}
      {policy && (
        <div className="mb-6">
          <SpendingPolicyDisplay
            policy={policy}
            walletAddress={walletAddress}
            agentOwner={agent.owner}
            onUpdate={handlePolicyUpdate}
          />
        </div>
      )}

      {/* Access level */}
      <div className="card p-6 mb-6">
        <h3 className="font-semibold text-base mb-4">Access Level</h3>
        <div className="space-y-2">
          {ACCESS_TIERS.map(({ label, minScore }) => {
            const eligible = agent.score >= minScore;
            return (
              <div key={minScore} className="flex items-center gap-3">
                <span className={`text-sm ${eligible ? 'text-success' : 'text-secondary'}`}>
                  {eligible ? '✓' : '○'}
                </span>
                <span className={`text-sm ${eligible ? 'text-primary' : 'text-secondary'}`}>
                  {label}
                </span>
                <span className="mono text-xs text-secondary ml-auto">score {minScore}+</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Custom Eligibility Check */}
      <div className="card p-6 mb-6">
        <h3 className="font-semibold text-base mb-4">Custom Eligibility Check</h3>
        <p className="text-sm text-secondary mb-4">
          Verify if this agent meets a specific minimum credit score requirement.
        </p>
        <div className="flex flex-wrap gap-3">
          <input
            type="number"
            value={customMinScore}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setCustomMinScore(Number(e.target.value));
              setIsEligible(null);
            }}
            placeholder="Min score"
            className="input w-36"
            min="0"
            max="1000"
          />
          <button
            onClick={checkEligibility}
            disabled={checkingEligibility}
            className="btn-primary"
          >
            {checkingEligibility ? 'Checking...' : 'Check Eligibility'}
          </button>
        </div>
        {isEligible !== null && !checkingEligibility && (
          <div className={`mt-4 p-3 rounded-lg border flex items-center gap-3 fade-in ${
            isEligible ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-600' : 'bg-red-500/5 border-red-500/20 text-red-600'
          }`}>
            <span className="text-lg font-bold">{isEligible ? '✓' : '×'}</span>
            <span className="text-sm font-medium">
              {isEligible 
                ? `Agent is ELIGIBLE for services requiring a score of ${customMinScore}+` 
                : `Agent is NOT ELIGIBLE for services requiring a score of ${customMinScore}+`}
            </span>
          </div>
        )}
      </div>

      {/* Metadata */}
      <div className="card p-5 flex flex-wrap gap-6">
        <MetaItem label="Tier" value={TIER_LABELS[tier]} />
        <MetaItem label="Total volume" value={`$${totalVolumeUsdc} USDC`} />
        <MetaItem label="Registered at ledger" value={`#${Number(agent.registered_at).toLocaleString()}`} />
        <MetaItem label="Last active at ledger" value={`#${Number(agent.last_active).toLocaleString()}`} />
        <MetaItem label="Owner" value={`${agent.owner.slice(0, 6)}…${agent.owner.slice(-4)}`} mono />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: 'success' | 'error';
}) {
  return (
    <div className="bg-background rounded-lg px-4 py-3 border border-border text-center">
      <div
        className={`mono text-lg font-semibold ${
          color === 'success' ? 'text-success' : color === 'error' ? 'text-error' : 'text-primary'
        }`}
      >
        {value}
      </div>
      <div className="text-xs text-secondary mt-0.5">{label}</div>
    </div>
  );
}

function MetaItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-secondary mb-0.5">{label}</div>
      <div className={`text-sm font-medium ${mono ? 'mono' : ''}`}>{value}</div>
    </div>
  );
}
