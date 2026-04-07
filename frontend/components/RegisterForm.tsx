'use client';

import { useState } from 'react';
import type { Category } from '@/lib/types';
import { registerService, type RegisterFormData } from '@/lib/contract';

const CATEGORIES: Category[] = ['search', 'weather', 'finance', 'ai', 'data', 'compute'];

const EXPLORER_URL =
  process.env.NEXT_PUBLIC_EXPLORER_URL ?? 'https://stellar.expert/explorer/testnet';

interface Props {
  walletAddress: string;
}

interface FormState {
  name: string;
  description: string;
  endpoint: string;
  price_usdc: string;
  category: Category;
}

const EMPTY: FormState = {
  name: '',
  description: '',
  endpoint: '',
  price_usdc: '',
  category: 'search',
};

function validate(f: FormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (f.name.length < 3 || f.name.length > 50)
    errors.name = 'Name must be 3–50 characters';
  if (f.description.length < 10 || f.description.length > 200)
    errors.description = 'Description must be 10–200 characters';
  if (!f.endpoint.startsWith('https://'))
    errors.endpoint = 'Endpoint must start with https://';
  const price = parseFloat(f.price_usdc);
  if (isNaN(price) || price < 0.0001)
    errors.price_usdc = 'Price must be at least 0.0001 USDC';
  return errors;
}

export default function RegisterForm({ walletAddress }: Props) {
  const [form, setForm]     = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ txHash: string } | null>(null);
  const [submitError, setSubmitError] = useState('');

  function set(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => { const e = { ...prev }; delete e[field]; return e; });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate(form);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await registerService(form as RegisterFormData, walletAddress);
      setResult(res);
      setForm(EMPTY);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="card p-8 text-center fade-in">
        <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-4">
          <span className="text-success text-xl">✓</span>
        </div>
        <h3 className="font-semibold text-lg mb-2">Service registered</h3>
        <p className="text-secondary text-sm mb-4">
          Your service is now live on the Lodestar registry.
        </p>
        <a
          href={`${EXPLORER_URL}/tx/${result.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mono text-xs text-accent break-all hover:underline"
        >
          {result.txHash}
        </a>
        <div className="mt-6">
          <button onClick={() => setResult(null)} className="btn-secondary">
            Register another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card p-8 space-y-5 fade-in">
      <Field
        label="Service Name"
        error={errors.name}
        hint="3–50 characters"
      >
        <input
          type="text"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="My Weather API"
          className={input(!!errors.name)}
        />
      </Field>

      <Field
        label="Description"
        error={errors.description}
        hint="10–200 characters"
      >
        <textarea
          rows={3}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Describe what your service does and what data it returns..."
          className={input(!!errors.description)}
        />
      </Field>

      <Field
        label="Endpoint URL"
        error={errors.endpoint}
        hint="Must start with https://"
      >
        <input
          type="url"
          value={form.endpoint}
          onChange={(e) => set('endpoint', e.target.value)}
          placeholder="https://api.example.com/weather"
          className={`mono ${input(!!errors.endpoint)}`}
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Price (USDC)" error={errors.price_usdc} hint="Min 0.0001">
          <input
            type="number"
            step="0.0001"
            min="0.0001"
            value={form.price_usdc}
            onChange={(e) => set('price_usdc', e.target.value)}
            placeholder="0.001"
            className={`mono ${input(!!errors.price_usdc)}`}
          />
        </Field>

        <Field label="Category" error={errors.category}>
          <select
            value={form.category}
            onChange={(e) => set('category', e.target.value as Category)}
            className={input(false)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>
      </div>

      {submitError && (
        <p className="text-error text-sm bg-error/5 border border-error/20 rounded-lg px-4 py-3">
          {submitError}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="btn-primary w-full py-3 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? 'Registering…' : 'Register Service'}
      </button>
    </form>
  );
}

function input(hasError: boolean) {
  return `w-full border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-1 transition-colors ${
    hasError
      ? 'border-error focus:ring-error'
      : 'border-border focus:ring-primary'
  }`;
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">{label}</label>
        {hint && !error && <span className="text-xs text-secondary">{hint}</span>}
        {error && <span className="text-xs text-error">{error}</span>}
      </div>
      {children}
    </div>
  );
}
