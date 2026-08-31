import type { Metadata } from 'next';
import { fetchAgent } from '@/lib/contract';

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://lodestar.app';

interface Props {
  params: { address: string };
  children: React.ReactNode;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const agentAddress = params.address;

  if (!agentAddress) {
    return {
      title: 'Agent Not Found',
    };
  }

  try {
    const data = await fetchAgent(agentAddress);

    if (data.agent) {
      const title = `${data.agent.name} — Lodestar Agent Score`;
      const description =
        data.agent.description.length > 0
          ? `${data.agent.description} Credit score: ${data.agent.score}/1000.`
          : `AI agent ${data.agent.name} registered on Lodestar. Credit score: ${data.agent.score}/1000.`;

      return {
        title,
        description,
        openGraph: {
          title,
          description,
          url: `${baseUrl}/agents/${agentAddress}`,
          type: 'profile',
          images: [
            {
              url: '/opengraph-image',
              width: 1200,
              height: 630,
              alt: title,
            },
          ],
        },
        twitter: {
          card: 'summary_large_image',
          title,
          description,
          images: ['/opengraph-image'],
        },
      };
    }
  } catch {
    // Fallback metadata if fetch fails
  }

  return {
    title: `Agent ${agentAddress.slice(0, 8)}… | Lodestar`,
    description: 'View agent credit score and details on Lodestar — the on-chain discovery layer for x402 AI agents on Stellar.',
    openGraph: {
      title: `Agent ${agentAddress.slice(0, 8)}… | Lodestar`,
      description: 'View agent credit score and details on Lodestar.',
      url: `${baseUrl}/agents/${agentAddress}`,
      type: 'profile',
      images: [
        {
          url: '/opengraph-image',
          width: 1200,
          height: 630,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: `Agent ${agentAddress.slice(0, 8)}… | Lodestar`,
      description: 'View agent credit score and details on Lodestar.',
      images: ['/opengraph-image'],
    },
  };
}

export default function AgentDetailLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
