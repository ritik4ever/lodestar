'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/components/WalletContext';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function RegisterAgentPage() {
  const { address, status } = useWallet();
  const connected = status === 'connected';
  const router = useRouter();

  const [form, setForm] = useState({ name: '', description: '' });
  const [agentAddress, setAgentAddress] = useState('');
  const [useConnected, setUseConnected] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolvedAddress = useConnected ? (address ?? '') : agentAddress;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!resolvedAddress) {
      setError('Connect your wallet or enter an agent address');
      return;
    }
    if (!/^G[A-Z2-7]{55}$/.test(resolvedAddress)) {
      setError('Invalid Stellar address — must start with G and be 56 characters');
      return;
    }
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }
    if (!form.description.trim()) {
      setError('Description is required');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API}/api/agents/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentAddress: resolvedAddress,
          name: form.name.trim(),
          description: form.description.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? `Registration failed (${res.status})`);
      }

      router.push(`/agents/${resolvedAddress}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight mb-2">Register Agent</h1>
      <p className="text-secondary text-sm mb-10 leading-relaxed">
        Register an AI agent address on-chain. The server keypair will be the owner.
        Start with a score of 100 — build trust through successful x402 payments.
      </p>

      <form onSubmit={handleSubmit} className="card p-8 flex flex-col gap-6">
        {/* Address source toggle */}
        <div>
          <label className="block text-sm font-medium mb-3">Agent Address</label>
          {connected && address && (
            <label className="flex items-center gap-3 cursor-pointer mb-3 group">
              <input
                type="checkbox"
                checked={useConnected}
                onChange={(e) => setUseConnected(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm text-secondary group-hover:text-primary transition-colors">
                Use connected wallet ({address.slice(0, 6)}…{address.slice(-4)})
              </span>
            </label>
          )}
          {(!connected || !address || !useConnected) && (
            <input
              type="text"
              placeholder="G... Stellar address"
              value={agentAddress}
              onChange={(e) => setAgentAddress(e.target.value)}
              className="input w-full mono text-sm"
              spellCheck={false}
            />
          )}
          {useConnected && connected && address && (
            <p className="mono text-xs text-secondary mt-1 truncate">{address}</p>
          )}
        </div>

        {/* Name */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Agent Name <span className="text-secondary font-normal">(max 64 chars)</span>
          </label>
          <input
            type="text"
            placeholder="e.g. WeatherBot-Alpha"
            maxLength={64}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="input w-full"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Description <span className="text-secondary font-normal">(max 256 chars)</span>
          </label>
          <textarea
            placeholder="What does this agent do?"
            maxLength={256}
            rows={3}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className="input w-full resize-none"
          />
          <p className="text-xs text-secondary mt-1 text-right">
            {form.description.length}/256
          </p>
        </div>

        {/* Score info */}
        <div className="bg-background border border-border rounded-lg px-4 py-3 text-xs text-secondary leading-relaxed">
          Starting score: <span className="mono font-medium text-primary">100</span> ·
          Successful payment: <span className="text-success font-medium">+10</span> ·
          Failed payment: <span className="text-error font-medium">−25</span> ·
          Max score: <span className="mono font-medium text-primary">1000</span>
        </div>

        {error && (
          <p className="text-sm text-error bg-error/5 border border-error/20 rounded-lg px-4 py-3">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="btn-primary py-3 text-sm font-medium disabled:opacity-50"
        >
          {submitting ? 'Registering on-chain…' : 'Register Agent'}
        </button>
      </form>
    </div>
  );
}
