import { ImageResponse } from 'next/og';
import { fetchAgent } from '@/lib/contract';
import { scoreTier } from '@/lib/types';

export const runtime = 'edge';

export const alt = 'Lodestar Agent Score';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

interface Props {
  params: { address: string };
}

export default async function AgentOpenGraphImage({ params }: Props) {
  const agentAddress = params.address;
  let agentName = 'Unknown Agent';
  let agentScore = 0;
  let agentDescription = '';

  try {
    const data = await fetchAgent(agentAddress);
    if (data.agent) {
      agentName = data.agent.name;
      agentScore = data.agent.score;
      agentDescription = data.agent.description;
    }
  } catch {
    // Fallback to default values
  }

  const tier = scoreTier(agentScore);
  const tierColor = getTierColor(tier);

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          width: '100%',
          height: '100%',
          background: 'linear-gradient(135deg, #0a0a1a 0%, #1a1040 50%, #0d1b2a 100%)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          padding: 80,
        }}
      >
        {/* Decorative grid lines */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            opacity: 0.04,
          }}
        >
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={`h-${i}`}
              style={{
                width: '100%',
                height: 1,
                background: '#fff',
                marginBottom: 52,
              }}
            />
          ))}
        </div>

        {/* Agent type indicator */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 24,
          }}
        >
          <div
            style={{
              padding: '8px 24px',
              borderRadius: 20,
              background: 'rgba(139, 92, 246, 0.2)',
              border: '1px solid rgba(139, 92, 246, 0.4)',
              color: '#8B5CF6',
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}
          >
            AI Agent
          </div>
        </div>

        {/* Agent name */}
        <h1
          style={{
            fontSize: 56,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: '#ffffff',
            margin: 0,
            lineHeight: 1.1,
            textAlign: 'center',
            maxWidth: 900,
          }}
        >
          {agentName}
        </h1>

        {/* Description (truncated) */}
        {agentDescription && (
          <p
            style={{
              fontSize: 20,
              color: '#94a3b8',
              marginTop: 16,
              marginBottom: 32,
              fontWeight: 400,
              letterSpacing: '-0.01em',
              textAlign: 'center',
              maxWidth: 800,
              lineHeight: 1.4,
            }}
          >
            {agentDescription.length > 120
              ? agentDescription.slice(0, 120) + '...'
              : agentDescription}
          </p>
        )}

        {/* Score display */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            marginTop: agentDescription ? 0 : 32,
          }}
        >
          <div
            style={{
              fontSize: 18,
              color: '#64748b',
              fontWeight: 500,
              marginBottom: 8,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}
          >
            Credit Score
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
            }}
          >
            <div
              style={{
                fontSize: 96,
                fontWeight: 800,
                color: '#ffffff',
                letterSpacing: '-0.03em',
                lineHeight: 1,
              }}
            >
              {agentScore}
            </div>
            <div
              style={{
                padding: '12px 32px',
                borderRadius: 12,
                background: tierColor.background,
                border: `1px solid ${tierColor.border}`,
                color: tierColor.text,
                fontSize: 24,
                fontWeight: 700,
                letterSpacing: '0.02em',
                textTransform: 'uppercase',
              }}
            >
              {tier}
            </div>
          </div>
          <div
            style={{
              fontSize: 16,
              color: '#64748b',
              marginTop: 12,
            }}
          >
            out of 1000
          </div>
        </div>

        {/* Bottom accent line */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: '100%',
            height: 4,
            background: 'linear-gradient(90deg, #8B5CF6, #3B82F6, #06B6D4)',
          }}
        />
      </div>
    ),
    {
      ...size,
    }
  );
}

function getTierColor(tier: string): { background: string; border: string; text: string } {
  switch (tier) {
    case 'elite':
      return {
        background: 'rgba(245, 158, 11, 0.2)',
        border: 'rgba(245, 158, 11, 0.5)',
        text: '#F59E0B',
      };
    case 'trusted':
      return {
        background: 'rgba(16, 185, 129, 0.2)',
        border: 'rgba(16, 185, 129, 0.5)',
        text: '#10B981',
      };
    case 'established':
      return {
        background: 'rgba(139, 92, 246, 0.2)',
        border: 'rgba(139, 92, 246, 0.5)',
        text: '#8B5CF6',
      };
    case 'building':
      return {
        background: 'rgba(59, 130, 246, 0.2)',
        border: 'rgba(59, 130, 246, 0.5)',
        text: '#3B82F6',
      };
    default:
      return {
        background: 'rgba(107, 114, 128, 0.2)',
        border: 'rgba(107, 114, 128, 0.5)',
        text: '#6B7280',
      };
  }
}
