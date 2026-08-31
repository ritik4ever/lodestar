'use client';

import { useState, type FormEvent, type ChangeEvent } from 'react';
import type { SpendingPolicy, Category } from '@/lib/types';

const STROOPS_PER_USDC = 10_000_000;

const ALL_CATEGORIES: Category[] = ['search', 'weather', 'finance', 'ai', 'data', 'compute'];

function stroopsToUsdc(stroops: string): string {
  const n = Number(stroops) / STROOPS_PER_USDC;
  // toFixed(4) then strip trailing zeros, keep at least one decimal if fractional
  const fixed = n.toFixed(4);
  const trimmed = fixed.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed.includes('.') ? trimmed : Number(trimmed).toLocaleString();
}

function usdcToStroops(usdc: string): string {
  const n = Math.round(parseFloat(usdc) * STROOPS_PER_USDC);
  return String(n);
}

interface Props {
  policy: SpendingPolicy;
  /** Current connected wallet address */
  walletAddress?: string;
  /** Agent owner address */
  agentOwner?: string;
  /** Called with form values when user submits update */
  onUpdate?: (params: {
    maxPerTxStroops: string;
    maxPerDayStroops: string;
    allowedCategories: string[];
    minScoreToEarn: number;
  }) => Promise<void>;
}

export default function SpendingPolicyDisplay({ policy, walletAddress, agentOwner, onUpdate }: Props) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwner = walletAddress && agentOwner && walletAddress === agentOwner;

  // Form state — initialize from current policy
  const [maxPerTx, setMaxPerTx] = useState(() => stroopsToUsdc(policy.max_per_tx_stroops));
  const [maxPerDay, setMaxPerDay] = useState(() => stroopsToUsdc(policy.max_per_day_stroops));
  const [minScore, setMinScore] = useState(policy.min_score_to_earn);
  const [categories, setCategories] = useState<string[]>(policy.allowed_categories);

  function startEdit() {
    // Reset form to current policy values
    setMaxPerTx(stroopsToUsdc(policy.max_per_tx_stroops));
    setMaxPerDay(stroopsToUsdc(policy.max_per_day_stroops));
    setMinScore(policy.min_score_to_earn);
    setCategories(policy.allowed_categories);
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setError(null);
  }

  function toggleCategory(cat: string) {
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!onUpdate) return;

    const txStroops = usdcToStroops(maxPerTx);
    const dayStroops = usdcToStroops(maxPerDay);

    if (BigInt(txStroops) <= 0n || BigInt(dayStroops) <= 0n) {
      setError('Spending limits must be greater than zero.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onUpdate({
        maxPerTxStroops: txStroops,
        maxPerDayStroops: dayStroops,
        allowedCategories: categories,
        minScoreToEarn: minScore,
      });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update policy');
    } finally {
      setSaving(false);
    }
  }

  const dailyUsed = Number(
    BigInt(policy.daily_spent_stroops) * 100n /
    BigInt(policy.max_per_day_stroops === '0' ? '1' : policy.max_per_day_stroops),
  );

  return (
    <div className="card p-6 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-base">Spending Policy</h3>
        {isOwner && !editing && (
          <button
            onClick={startEdit}
            className="text-xs font-medium text-primary hover:text-secondary transition-colors"
          >
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-secondary block mb-1">Max per transaction (USDC)</label>
              <input
                type="number"
                value={maxPerTx}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setMaxPerTx(e.target.value)}
                className="input w-full"
                min="0"
                step="0.01"
                required
              />
            </div>
            <div>
              <label className="text-xs text-secondary block mb-1">Max per day (USDC)</label>
              <input
                type="number"
                value={maxPerDay}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setMaxPerDay(e.target.value)}
                className="input w-full"
                min="0"
                step="0.01"
                required
              />
            </div>
            <div>
              <label className="text-xs text-secondary block mb-1">Min score to earn</label>
              <input
                type="number"
                value={minScore}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setMinScore(Number(e.target.value))}
                className="input w-full"
                min="0"
                max="1000"
              />
              <p className="text-[11px] text-secondary mt-1">
                Agents below this score earn at a reduced rate (+2 instead of +10). Set 0 for full rate.
              </p>
            </div>
            <div>
              <label className="text-xs text-secondary block mb-1">Allowed categories</label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {ALL_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                      categories.includes(cat)
                        ? 'bg-primary/10 border-primary text-primary'
                        : 'border-border text-secondary hover:border-primary'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-secondary mt-1">
                {categories.length === 0 ? 'All categories allowed' : `${categories.length} selected`}
              </p>
            </div>
          </div>

          {error && <p className="text-xs text-error">{error}</p>}

          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="btn-primary text-sm">
              {saving ? 'Updating…' : 'Save changes'}
            </button>
            <button type="button" onClick={cancelEdit} disabled={saving} className="btn-secondary text-sm">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 gap-4">
            <PolicyRow
              label="Max per transaction"
              value={`$${stroopsToUsdc(policy.max_per_tx_stroops)} USDC`}
            />
            <PolicyRow
              label="Max per day"
              value={`$${stroopsToUsdc(policy.max_per_day_stroops)} USDC`}
            />
            <PolicyRow
              label="Min score to earn"
              value={policy.min_score_to_earn === 0 ? 'None' : String(policy.min_score_to_earn)}
              tooltip="Agents at or above this score earn +10 per successful payment; agents below it still earn at a reduced +2 rate, so a low score is always recoverable. Set to 0 to give every agent the full rate."
            />
            <PolicyRow
              label="Allowed categories"
              value={
                policy.allowed_categories.length > 0
                  ? policy.allowed_categories.join(', ')
                  : 'All categories'
              }
            />
          </div>

          {/* Daily spend progress */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-secondary">Daily spend used</span>
              <span className="mono text-xs text-primary">
                ${stroopsToUsdc(policy.daily_spent_stroops)} / ${stroopsToUsdc(policy.max_per_day_stroops)} USDC
              </span>
            </div>
            <div className="w-full bg-border rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full transition-all ${
                  dailyUsed > 90 ? 'bg-error' : dailyUsed > 70 ? 'bg-accent' : 'bg-success'
                }`}
                style={{ width: `${Math.min(dailyUsed, 100)}%` }}
              />
            </div>
            <p className="text-xs text-secondary mt-1.5">
              Resets every ~17,280 ledgers (≈24 hours)
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function PolicyRow({ label, value, tooltip }: { label: string; value: string; tooltip?: string }) {
  return (
    <div className="bg-background rounded-lg px-4 py-3 border border-border">
      <div className="text-xs text-secondary mb-1 flex items-center gap-1">
        {label}
        {tooltip && (
          <span className="group relative cursor-help" title={tooltip}>
            <svg className="w-3.5 h-3.5 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
            </svg>
          </span>
        )}
      </div>
      <div className="text-sm font-medium mono">{value}</div>
    </div>
  );
}
