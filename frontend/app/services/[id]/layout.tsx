import type { Metadata } from 'next';
import { fetchServiceById } from '@/lib/contract';

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://lodestar.app';

interface Props {
  params: { id: string };
  children: React.ReactNode;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const serviceId = Number(params.id);

  if (!/^\d+$/.test(params.id) || !Number.isSafeInteger(serviceId)) {
    return {
      title: 'Service Not Found',
    };
  }

  try {
    const service = await fetchServiceById(serviceId);

    const title = `${service.name} — Lodestar Service Registry`;
    const description =
      service.description.length > 0
        ? service.description
        : `${service.name} — a ${service.category} service available on Lodestar for ${service.price_usdc} USDC.`;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        url: `${baseUrl}/services/${serviceId}`,
        type: 'article',
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
  } catch {
    return {
      title: `Service #${serviceId} | Lodestar`,
      description: 'View service details on Lodestar — the on-chain discovery layer for x402 AI agents on Stellar.',
      openGraph: {
        title: `Service #${serviceId} | Lodestar`,
        description: 'View service details on Lodestar.',
        url: `${baseUrl}/services/${serviceId}`,
        type: 'article',
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
        title: `Service #${serviceId} | Lodestar`,
        description: 'View service details on Lodestar.',
        images: ['/opengraph-image'],
      },
    };
  }
}

export default function ServiceDetailLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
