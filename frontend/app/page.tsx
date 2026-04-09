import Link from 'next/link';
import StatsBar from '@/components/StatsBar';

export default function HomePage() {
  return (
    <div className="max-w-6xl mx-auto px-6">
      {/* Hero */}
      <section className="py-24 text-center">
        <h1 className="text-5xl sm:text-6xl font-semibold tracking-tight leading-tight mb-6">
          Navigate the{' '}
          <span className="text-accent italic">agent economy</span>
        </h1>
        <p className="text-lg text-secondary max-w-2xl mx-auto mb-10 leading-relaxed">
          The on-chain discovery layer that lets AI agents find, evaluate, and
          pay for x402 services on Stellar — autonomously.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link href="/registry" className="btn-primary px-7 py-3 text-base">
            Browse Registry
          </Link>
          <Link href="/agents" className="btn-secondary px-7 py-3 text-base">
            Agent Scores
          </Link>
          <Link href="/register" className="btn-secondary px-7 py-3 text-base">
            Register a Service
          </Link>
        </div>
      </section>

      {/* Stats */}
      <StatsBar />

      {/* Feature blocks */}
      <section className="grid md:grid-cols-3 gap-6 py-20">
        <FeatureBlock
          title="For Providers"
          description="Register your x402-enabled service once. It becomes permanently discoverable by any AI agent querying the Lodestar registry — no integration work required."
        />
        <FeatureBlock
          title="For Agents"
          description="Query the registry by category, sort by reputation, and pay with x402 — all without a single hardcoded URL. Full autonomy from discovery to payment."
        />
        <FeatureBlock
          title="On Stellar"
          description="Lodestar runs on Soroban, Stellar's smart contract platform. Permanent, neutral, permissionless. No owner, no gatekeeping, no downtime."
        />
      </section>

      {/* Agent Credit Scoring callout */}
      <section className="border-t border-border py-16">
        <div className="card p-8 md:p-12 flex flex-col md:flex-row items-start gap-8">
          <div className="flex-1">
            <span className="badge bg-violet-50 text-violet-700 mb-4 inline-block">New</span>
            <h2 className="text-2xl font-semibold tracking-tight mb-3">
              Agent Credit Scoring
            </h2>
            <p className="text-secondary text-sm leading-relaxed mb-6 max-w-lg">
              Every AI agent that pays for services through Lodestar builds an on-chain
              credit score. Providers can gate access by score, set per-transaction and
              daily spend limits, and detect misbehaving agents — all enforced by Soroban.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/agents" className="btn-primary px-5 py-2.5 text-sm">
                View Agent Scores
              </Link>
              <Link href="/agents/register" className="btn-secondary px-5 py-2.5 text-sm">
                Register Your Agent
              </Link>
            </div>
          </div>
          <div className="flex flex-col gap-3 shrink-0 w-full md:w-auto">
            {[
              { score: 100, name: 'New agent', detail: 'Just starting out' },
              { score: 600, name: 'Established agent', detail: '50 successful payments' },
              { score: 950, name: 'Trusted agent', detail: '85 payments, consistent record' },
            ].map(({ score, name, detail }) => (
              <div key={score} className="bg-background border border-border rounded-lg px-4 py-3 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{name}</div>
                  <div className="text-xs text-secondary">{detail}</div>
                </div>
                <ScorePill score={score} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-16 border-t border-border">
        <h2 className="text-2xl font-semibold mb-12 text-center">How it works</h2>
        <div className="grid md:grid-cols-2 gap-12">
          <Flow
            title="Provider flow"
            steps={[
              'Deploy your x402-enabled service endpoint',
              'Call register_service on the Lodestar contract',
              'Set your price, category, and description',
              'Agents discover you automatically — forever',
            ]}
          />
          <Flow
            title="Agent flow"
            steps={[
              'Query list_services by category',
              'Sort results by reputation',
              'Hit the endpoint — receive a 402 response',
              'Pay via x402 on Stellar and receive the data',
            ]}
          />
        </div>
      </section>
    </div>
  );
}

function ScorePill({ score }: { score: number }) {
  const tier =
    score >= 1000 ? 'elite' :
    score >= 900  ? 'trusted' :
    score >= 600  ? 'established' :
    score >= 300  ? 'building' : 'new';
  const colors: Record<string, string> = {
    new: 'text-gray-500 bg-gray-50',
    building: 'text-blue-600 bg-blue-50',
    established: 'text-violet-600 bg-violet-50',
    trusted: 'text-emerald-600 bg-emerald-50',
    elite: 'text-amber-600 bg-amber-50',
  };
  const dot: Record<string, string> = {
    new: 'bg-gray-400', building: 'bg-blue-500',
    established: 'bg-violet-500', trusted: 'bg-emerald-500', elite: 'bg-amber-500',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${colors[tier]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot[tier]}`} />
      {score}
    </span>
  );
}

function FeatureBlock({ title, description }: { title: string; description: string }) {
  return (
    <div className="card p-8 fade-in">
      <h3 className="font-semibold text-base mb-3">{title}</h3>
      <p className="text-secondary text-sm leading-relaxed">{description}</p>
    </div>
  );
}

function Flow({ title, steps }: { title: string; steps: string[] }) {
  return (
    <div>
      <h3 className="font-semibold mb-5 text-sm uppercase tracking-widest text-secondary">
        {title}
      </h3>
      <ol className="space-y-4">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-4">
            <span className="mono text-xs text-accent font-medium mt-0.5 shrink-0">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="text-sm text-secondary leading-relaxed">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
