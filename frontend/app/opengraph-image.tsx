import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export const alt = 'Lodestar — Navigate the agent economy';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
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

        {/* Star/logo icon */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 32,
          }}
        >
          <svg
            width="80"
            height="80"
            viewBox="0 0 80 80"
            fill="none"
            style={{ opacity: 0.9 }}
          >
            <path
              d="M40 0L49.8 27.6L78.4 17.4L55.4 38L80 49L52 50L48 80L34 52L4 65L22 38L0 22L32 30L40 0Z"
              fill="url(#grad)"
            />
            <defs>
              <linearGradient id="grad" x1="0" y1="0" x2="80" y2="80">
                <stop stopColor="#8B5CF6" />
                <stop offset="1" stopColor="#3B82F6" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        {/* Title */}
        <h1
          style={{
            fontSize: 72,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: '#ffffff',
            margin: 0,
            lineHeight: 1.1,
          }}
        >
          Lodestar
        </h1>

        {/* Subtitle */}
        <p
          style={{
            fontSize: 28,
            color: '#94a3b8',
            marginTop: 16,
            marginBottom: 0,
            fontWeight: 400,
            letterSpacing: '-0.01em',
          }}
        >
          Navigate the agent economy
        </p>

        {/* Tagline */}
        <p
          style={{
            fontSize: 18,
            color: '#64748b',
            marginTop: 40,
            marginBottom: 0,
            maxWidth: 700,
            textAlign: 'center',
            lineHeight: 1.5,
          }}
        >
          The on-chain discovery layer for x402 AI agents on Stellar
        </p>

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
