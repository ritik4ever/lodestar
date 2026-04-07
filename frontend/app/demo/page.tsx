import AgentDemo from '@/components/AgentDemo';
import ActivityFeed from '@/components/ActivityFeed';

export default function DemoPage() {
  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="mb-10 max-w-2xl">
        <h1 className="text-2xl font-semibold mb-3">Live Agent Demo</h1>
        <p className="text-secondary text-sm leading-relaxed">
          Watch an AI agent discover and pay for services using Lodestar — with zero
          hardcoded URLs. The agent queries the on-chain registry, selects the best
          service by reputation, and pays via x402 on Stellar in real time.
        </p>
      </div>

      {/* Split layout */}
      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <AgentDemo />
        <ActivityFeed />
      </div>
    </div>
  );
}
