import { ImageResponse } from 'next/og';
import { fetchServiceById } from '@/lib/contract';

export const runtime = 'edge';

export const alt = 'Lodestar Service';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

interface Props {
  params: { id: string };
}

export default async function ServiceOpenGraphImage({ params }: Props) {
  const serviceId = Number(params.id);
  let serviceName = 'Unknown Service';
  let serviceCategory = 'Service';
  let serviceReputation = 0;
  let serviceDescription = '';
  let servicePrice = '0';

  try {
    if (/^\d+$/.test(params.id) && Number.isSafeInteger(serviceId)) {
      const service = await fetchServiceById(serviceId);
      serviceName = service.name;
      serviceCategory = service.category;
      serviceReputation = service.reputation;
      serviceDescription = service.description;
      servicePrice = service.price_usdc;
    }
  } catch {
    // Fallback to default values
  }

  const categoryColor = getCategoryColor(serviceCategory);

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

        {/* Service type indicator */}
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
              background: categoryColor.background,
              border: `1px solid ${categoryColor.border}`,
              color: categoryColor.text,
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}
          >
            {serviceCategory}
          </div>
        </div>

        {/* Service name */}
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
          {serviceName}
        </h1>

        {/* Description (truncated) */}
        {serviceDescription && (
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
            {serviceDescription.length > 120
              ? serviceDescription.slice(0, 120) + '...'
              : serviceDescription}
          </p>
        )}

        {/* Stats display */}
        <div
          style={{
            display: 'flex',
            gap: 48,
            marginTop: serviceDescription ? 0 : 32,
          }}
        >
          {/* Reputation */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                fontSize: 16,
                color: '#64748b',
                fontWeight: 500,
                marginBottom: 8,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
              }}
            >
              Reputation
            </div>
            <div
              style={{
                fontSize: 48,
                fontWeight: 700,
                color: '#ffffff',
                letterSpacing: '-0.02em',
                lineHeight: 1,
              }}
            >
              {serviceReputation}
            </div>
          </div>

          {/* Price */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                fontSize: 16,
                color: '#64748b',
                fontWeight: 500,
                marginBottom: 8,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
              }}
            >
              Price
            </div>
            <div
              style={{
                fontSize: 48,
                fontWeight: 700,
                color: '#ffffff',
                letterSpacing: '-0.02em',
                lineHeight: 1,
              }}
            >
              {servicePrice}
            </div>
            <div
              style={{
                fontSize: 18,
                color: '#94a3b8',
                marginTop: 4,
              }}
            >
              USDC
            </div>
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

function getCategoryColor(
  category: string
): { background: string; border: string; text: string } {
  switch (category.toLowerCase()) {
    case 'search':
      return {
        background: 'rgba(59, 130, 246, 0.2)',
        border: 'rgba(59, 130, 246, 0.5)',
        text: '#3B82F6',
      };
    case 'weather':
      return {
        background: 'rgba(6, 182, 212, 0.2)',
        border: 'rgba(6, 182, 212, 0.5)',
        text: '#06B6D4',
      };
    case 'finance':
      return {
        background: 'rgba(16, 185, 129, 0.2)',
        border: 'rgba(16, 185, 129, 0.5)',
        text: '#10B981',
      };
    case 'ai':
      return {
        background: 'rgba(139, 92, 246, 0.2)',
        border: 'rgba(139, 92, 246, 0.5)',
        text: '#8B5CF6',
      };
    case 'data':
      return {
        background: 'rgba(245, 158, 11, 0.2)',
        border: 'rgba(245, 158, 11, 0.5)',
        text: '#F59E0B',
      };
    case 'compute':
      return {
        background: 'rgba(236, 72, 153, 0.2)',
        border: 'rgba(236, 72, 153, 0.5)',
        text: '#EC4899',
      };
    default:
      return {
        background: 'rgba(107, 114, 128, 0.2)',
        border: 'rgba(107, 114, 128, 0.5)',
        text: '#6B7280',
      };
  }
}
