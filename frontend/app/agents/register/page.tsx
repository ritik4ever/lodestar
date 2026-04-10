'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/components/WalletContext';
import ScoreBadge from '@/components/ScoreBadge';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const CATEGORY_OPTIONS = ['weather', 'search', 'finance', 'data', 'compute', 'storage', 'ai', 'other'];

export default function RegisterAgentPage() {
  const { address, status } = useWallet();
  const connected = status === 'connected';
  const router = useRouter();

  const [form, setForm] = useState({
    name: '',
    description: '',
    maxPerTxUsdc: '0.001',
    maxPerDayUsdc: '1.00',
  });
  const [agentAddress, setAgentAddress] = useState('');
  const [useConnected, setUseConnected] = useState(true);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolvedAddress = useConnected ? (address ?? '') : agentAddress;

  function toggleCategory(cat: string) {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  }

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

    const maxPerTx = parseFloat(form.maxPerTxUsdc);
    const maxPerDay = parseFloat(form.maxPerDayUsdc);
    if (isNaN(maxPerTx) || maxPerTx <= 0) {
      setError('Max per transaction must be a positive number');
      return;
    }
    if (isNaN(maxPerDay) || maxPerDay <= 0) {
      setError('Max per day must be a positive number');
      return;
    }
    if (maxPerTx > maxPerDay) {
      setError('Max per transaction cannot exceed max per day');
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
          maxPerTxUsdc: form.maxPerTxUsdc,
          maxPerDayUsdc: form.maxPerDayUsdc,
          allowedCategories: selectedCategories,
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
    <div className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight mb-2">Register Agent</h1>
      <p className="text-secondary text-sm mb-10 leading-relaxed">
        Register an AI agent address on-chain. Start with a score of{' '}
        <span className="mono font-medium text-primary">100</span> — build trust through
        successful x402 payments.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Form */}
        <form onSubmit={handleSubmit} className="lg:col-span-2 card p-8 flex flex-col gap-6">
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

          {/* Spending policy */}
          <div>
            <label className="block text-sm font-medium mb-1">Spending Policy</label>
            <p className="text-xs text-secondary mb-3">
              Enforced on-chain — cannot be bypassed even if the wallet has sufficient balance.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-secondary mb-1">Max per transaction (USDC)</label>
                <input
                  type="number"
                  min="0.000001"
                  step="0.000001"
                  value={form.maxPerTxUsdc}
                  onChange={(e) => setForm((f) => ({ ...f, maxPerTxUsdc: e.target.value }))}
                  className="input w-full text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-secondary mb-1">Max per day (USDC)</label>
                <input
                  type="number"
                  min="0.000001"
                  step="0.000001"
                  value={form.maxPerDayUsdc}
                  onChange={(e) => setForm((f) => ({ ...f, maxPerDayUsdc: e.target.value }))}
                  className="input w-full text-sm"
                />
              </div>
            </div>
          </div>

          {/* Allowed categories */}
          <div>
            <label className="block text-sm font-medium mb-1">Allowed Categories</label>
            <p className="text-xs text-secondary mb-3">
              Leave empty to allow all categories.
            </p>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_OPTIONS.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggleCategory(cat)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    selectedCategories.includes(cat)
                      ? 'bg-accent text-white border-accent'
                      : 'bg-background border-border text-secondary hover:border-accent hover:text-primary'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            {selectedCategories.length > 0 && (
              <p className="text-xs text-secondary mt-2">
                Selected: {selectedCategories.join(', ')}
              </p>
            )}
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

        {/* Preview card */}
        <div className="lg:col-span-1">
          <p className="text-xs font-medium text-secondary uppercase tracking-wider mb-3">Preview</p>
          <div className="card p-5 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">
                  {form.name.trim() || 'Agent Name'}
                </p>
                <p className="text-xs text-secondary mt-0.5 line-clamp-2">
                  {form.description.trim() || 'Agent description will appear here.'}
                </p>
              </div>
              <ScoreBadge score={100} />
            </div>

            <div className="text-xs text-secondary mono truncate">
              {resolvedAddress
                ? `${resolvedAddress.slice(0, 8)}…${resolvedAddress.slice(-6)}`
                : 'G… address'}
            </div>

            <div className="border-t border-border pt-3 grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="text-secondary">Max / tx</p>
                <p className="font-medium mono">${form.maxPerTxUsdc} USDC</p>
              </div>
              <div>
                <p className="text-secondary">Max / day</p>
                <p className="font-medium mono">${form.maxPerDayUsdc} USDC</p>
              </div>
            </div>

            {selectedCategories.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {selectedCategories.map((cat) => (
                  <span
                    key={cat}
                    className="px-2 py-0.5 bg-accent/10 text-accent rounded text-xs"
                  >
                    {cat}
                  </span>
                ))}
              </div>
            )}

            <div className="border-t border-border pt-3">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-secondary">Starting score</span>
                <span className="mono font-medium">100 / 1000</span>
              </div>
              <div className="h-1.5 bg-border rounded-full overflow-hidden">
                <div className="h-full bg-accent rounded-full" style={{ width: '10%' }} />
              </div>
              <p className="text-xs text-secondary mt-2">
                Tier: <span className="text-primary font-medium">New</span> · +10 per payment · −25 per failure
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
