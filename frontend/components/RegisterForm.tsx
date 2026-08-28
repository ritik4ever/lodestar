'use client';

import { useState } from 'react';
import type { Category } from '@/lib/types';
import { registerService, type RegisterFormData } from '@/lib/contract';

const CATEGORIES: Category[] = ['search', 'weather', 'finance', 'ai', 'data', 'compute'];

const PRICE_USDC_REGEX = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

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
  
  const trimmedName = f.name.trim();
  if (trimmedName.length < 3 || trimmedName.length > 64)
    errors.name = 'Name must be 3–64 characters';
  
  const trimmedDescription = f.description.trim();
  if (trimmedDescription.length < 10 || trimmedDescription.length > 256)
    errors.description = 'Description must be 10–256 characters';
  
  const trimmedEndpoint = f.endpoint.trim();
  if (!trimmedEndpoint.startsWith('https://'))
    errors.endpoint = 'Endpoint must start with https://';
  else if (trimmedEndpoint.length > 256)
    errors.endpoint = 'Endpoint must be at most 256 characters';
  
  const trimmedPrice = f.price_usdc.trim();
  if (trimmedPrice.length === 0 || trimmedPrice !== f.price_usdc || !PRICE_USDC_REGEX.test(trimmedPrice)) {
    errors.price_usdc = 'Invalid price format';
  } else {
    const price = parseFloat(trimmedPrice);
    if (isNaN(price) || price < 0.0001)
      errors.price_usdc = 'Price must be at least 0.0001 USDC';
  }
  
  return errors;
}

export default function RegisterForm({ walletAddress }: Props) {
  const [form, setForm]     = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [pendingTx, setPendingTx] = useState<{ txHash: string } | null>(null);
  const [result, setResult] = useState<{ txHash: string; id: number } | null>(null);
  const [submitError, setSubmitError] = useState('');

  function set(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    // Validate on change
    const updatedForm = { ...form, [field]: value };
    const errs = validate(updatedForm);
    setErrors(errs);
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
    setPendingTx(null);
    try {
      const res = await registerService(form as RegisterFormData, walletAddress);
      setPendingTx({ txHash: res.txHash });
      // Wait a moment to show the pending state before showing success
      await new Promise(resolve => setTimeout(resolve, 2000));
      setResult(res);
      setForm(EMPTY);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (pendingTx) {
    return (
      <div className="card p-8 text-center fade-in">
        <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4">
          <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full spinner" />
        </div>
        <h3 className="font-semibold text-lg mb-2">Confirming transaction</h3>
        <p className="text-secondary text-sm mb-4">
          Your registration is being confirmed on the network.
        </p>
        <a
          href={`${EXPLORER_URL}/tx/${pendingTx.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mono text-xs text-accent break-all hover:underline"
        >
          {pendingTx.txHash}
        </a>
      </div>
    );
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
        hint="3–64 characters"
      >
        <input
          type="text"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="My Weather API"
          disabled={submitting}
          className={input(!!errors.name)}
        />
      </Field>

      <Field
        label="Description"
        error={errors.description}
        hint="10–256 characters"
      >
        <textarea
          rows={3}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Describe what your service does and what data it returns..."
          disabled={submitting}
          className={input(!!errors.description)}
        />
      </Field>

      <Field
        label="Endpoint URL"
        error={errors.endpoint}
        hint="https://, max 256 characters"
      >
        <input
          type="url"
          value={form.endpoint}
          onChange={(e) => set('endpoint', e.target.value)}
          placeholder="https://api.example.com/weather"
          disabled={submitting}
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
            disabled={submitting}
            className={`mono ${input(!!errors.price_usdc)}`}
          />
        </Field>

        <Field label="Category" error={errors.category}>
          <select
            value={form.category}
            onChange={(e) => set('category', e.target.value as Category)}
            disabled={submitting}
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
        disabled={submitting || Object.keys(errors).length > 0}
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
