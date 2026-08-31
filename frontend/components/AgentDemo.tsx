'use client';

import { useState, useRef } from 'react';
import type { AgentStep } from '@/lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const EXPLORER_URL =
  process.env.NEXT_PUBLIC_EXPLORER_URL ?? 'https://stellar.expert/explorer/testnet';
// Registered demo agent the backend signs reputation votes as.
const DEMO_AGENT_ADDRESS = process.env.NEXT_PUBLIC_DEMO_AGENT_ADDRESS ?? '';

type ServiceNeed = 'weather' | 'search';

const SERVICE_OPTIONS: { label: string; value: ServiceNeed }[] = [
  { label: 'Weather Data', value: 'weather' },
  { label: 'Web Search', value: 'search' },
];

interface DemoResult {
  data: unknown;
  txHash: string;
  serviceName: string;
  price: string;
}

function StepIndicator({ status }: { status: AgentStep['status'] }) {
  if (status === 'pending')
    return <span className="w-2.5 h-2.5 rounded-full bg-border inline-block shrink-0 mt-1" />;
  if (status === 'active')
    return (
      <span className="w-2.5 h-2.5 rounded-full border-2 border-accent border-t-transparent inline-block spinner shrink-0 mt-1" />
    );
  if (status === 'complete')
    return <span className="w-2.5 h-2.5 rounded-full bg-success inline-block shrink-0 mt-1" />;
  return <span className="w-2.5 h-2.5 rounded-full bg-error inline-block shrink-0 mt-1" />;
}

export default function AgentDemo() {
  const [need, setNeed] = useState<ServiceNeed>('weather');
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DemoResult | null>(null);
  const [error, setError] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);

  function pushStep(label: string, status: AgentStep['status'], detail?: string) {
    setSteps((prev) => [...prev, { label, status, detail }]);
  }

  function completeLastStep(detail?: string) {
    setSteps((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last) next[next.length - 1] = { ...last, status: 'complete', detail: detail ?? last.detail };
      return next;
    });
  }

  async function runAgent() {
    setRunning(true);
    setSteps([]);
    setResult(null);
    setError('');

    // Hoisted so the catch block can reference it for negative reputation votes.
    let best: { id: number; name: string; endpoint: string; price_usdc: string; reputation: number } | undefined;

    try {
      abortControllerRef.current = new AbortController();
      const { signal } = abortControllerRef.current;

      // Step 1 — query registry
      pushStep('Querying Lodestar registry…', 'active');
      const servicesRes = await fetch(`${API_URL}/api/services?category=${need}`, { signal });
      const servicesData = (await servicesRes.json()) as { services: Array<{ id: number; name: string; endpoint: string; price_usdc: string; reputation: number }> };
      const services = servicesData.services;
      completeLastStep();

      if (!services || services.length === 0) {
        pushStep('No services found in registry', 'error');
        setError('No services registered for this category. Run the seed script first.');
        setRunning(false);
        return;
      }

      // Step 2 — found services
      pushStep(`Found ${services.length} matching service${services.length > 1 ? 's' : ''}`, 'complete');

      // Step 3 — select best
      best = [...services].sort((a, b) => b.reputation - a.reputation)[0];
      pushStep(`Selected "${best.name}" at $${best.price_usdc} USDC`, 'complete');

      // Step 4 — send payment
      pushStep('Sending x402 payment on Stellar…', 'active');
      await new Promise((r) => setTimeout(r, 800));

      // The backend demo agent handles payment internally
      const demoRes = await fetch(`${API_URL}/api/demo-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId: best.id, category: need }),
        signal,
      });

      if (!demoRes.ok) {
        const errBody = (await demoRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? 'Demo request failed');
      }

      const demoData = (await demoRes.json()) as { data: unknown; txHash: string; dataValid: boolean };

      // Gate on the data-quality flag surfaced by the backend.
      // A missing flag (older backend) is treated as valid to stay backwards-compatible.
      const dataValid = demoData.dataValid !== false;

      if (!dataValid) {
        // Payment went through but the service returned empty or error data —
        // mark the step as an error and penalise reputation.
        setSteps((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.status === 'active') {
            next[next.length - 1] = { ...last, status: 'error' };
          }
          return next;
        });
        pushStep('Service returned invalid data', 'error');
        setError('The service returned empty or invalid data.');

        if (DEMO_AGENT_ADDRESS) {
          await fetch(`${API_URL}/api/reputation/${best.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ positive: false, agent: DEMO_AGENT_ADDRESS }),
          }).catch(() => {});
        }
        return;
      }

      completeLastStep();

      // Step 5 — confirmed
      pushStep('Payment confirmed — data received', 'complete');

      setResult({
        data: demoData.data,
        txHash: demoData.txHash,
        serviceName: best.name,
        price: best.price_usdc,
      });

      // Update reputation based on verified data quality, signed on-chain as the
      // demo agent. Best-effort: a missing agent config or the on-chain cooldown
      // shouldn't fail the demo run that already succeeded.
      if (DEMO_AGENT_ADDRESS) {
        await fetch(`${API_URL}/api/reputation/${best.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ positive: true, agent: DEMO_AGENT_ADDRESS }),
          signal,
        }).catch(() => {});
      }
    } catch (err: any) {
      const isAbort = err.name === 'AbortError';
      setError(isAbort ? 'Agent run was cancelled.' : (err instanceof Error ? err.message : 'Agent run failed'));
      setSteps((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.status === 'active') {
          next[next.length - 1] = { ...last, status: 'error', detail: isAbort ? 'Cancelled' : last.detail };
        }
        return next;
      });

      // Penalise reputation for hard failures (network error, non-2xx response,
      // payment error). Best-effort — swallow any reputation submission errors.
      if (DEMO_AGENT_ADDRESS && best) {
        await fetch(`${API_URL}/api/reputation/${best.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ positive: false, agent: DEMO_AGENT_ADDRESS }),
        }).catch(() => {});
      }
    } finally {
      setRunning(false);
      abortControllerRef.current = null;
    }
  }

  return (
    <div className="card p-6 flex flex-col gap-6">
      <div>
        <h2 className="font-semibold text-sm mb-4">Agent Simulator</h2>

        <div className="flex gap-3">
          <select
            value={need}
            onChange={(e) => setNeed(e.target.value as ServiceNeed)}
            disabled={running}
            className="flex-1 border border-border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
          >
            {SERVICE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                Agent needs: {o.label}
              </option>
            ))}
          </select>

          <button
            onClick={runAgent}
            disabled={running}
            className="btn-accent shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {running ? 'Running…' : 'Run Agent'}
          </button>
          {running && (
            <button
              onClick={() => abortControllerRef.current?.abort()}
              className="px-4 py-2.5 rounded-lg bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors text-sm font-medium shrink-0"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Steps */}
      {steps.length > 0 && (
        <div className="space-y-3">
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-3 fade-in">
              <StepIndicator status={step.status} />
              <div>
                <p className="text-sm">{step.label}</p>
                {step.detail && (
                  <p className="text-xs text-secondary mono mt-0.5">{step.detail}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-error/5 border border-error/20 rounded-lg px-4 py-3 text-sm text-error fade-in">
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="border border-border rounded-xl p-4 space-y-3 fade-in">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-secondary uppercase tracking-wide">
              Data received
            </p>
            <span className="mono text-xs text-accent">${result.price} USDC paid</span>
          </div>
          <pre className="mono text-xs bg-background rounded-lg p-3 overflow-auto max-h-48 text-primary">
            {JSON.stringify(result.data, null, 2)}
          </pre>
          <a
            href={result.txHash ? `${EXPLORER_URL}/tx/${result.txHash}` : `${EXPLORER_URL}/account/GAY42LBQWN7LSFV3F6AFNEET2NVLY2JJ7KAEN4E5SNNT4RIEJLAQKGU3`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-accent/30 bg-accent/5 hover:bg-accent/10 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent shrink-0">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            <span className="text-xs text-accent font-medium">
              {result.txHash ? 'View transaction on Stellar Explorer' : 'View payment account on Stellar Explorer'}
            </span>
            {result.txHash && (
              <span className="mono text-xs text-secondary ml-auto">{result.txHash.slice(0, 8)}…</span>
            )}
          </a>
        </div>
      )}
    </div>
  );
}
