import type { MetadataRoute } from 'next';
import { fetchServices, fetchAgents } from '@/lib/contract';

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://lodestar.app';

/**
 * Upper bound on dynamic entries per type (#849). Generation must stay bounded:
 * the registry grows without limit, and an unbounded sitemap turns a build into
 * an unbounded number of RPC reads.
 */
export const MAX_DYNAMIC_ENTRIES = 1000;

/**
 * Regenerate hourly rather than only at build time, so services registered after
 * a deploy become indexable without one. Chosen deliberately: the registry
 * changes far more often than the static pages, but not so often that per-request
 * generation would be worth the RPC cost.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const routes: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/registry`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/agents`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/register`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
  ];

  try {
    // Generate sitemap entries for registered services
    const services = await fetchServices();
    // Cap the entry count at 1000
    const servicesEntries: MetadataRoute.Sitemap = services.slice(0, MAX_DYNAMIC_ENTRIES).map((service) => ({
      url: `${baseUrl}/services/${service.id}`,
      // registered_at is a ledger sequence number, so we fallback to a sensible date or use it if it ever becomes a timestamp
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    }));
    routes.push(...servicesEntries);
  } catch (error) {
    console.error('Failed to generate services sitemap entries:', error);
  }

  try {
    // Generate sitemap entries for registered agents
    // Cap at 1000 entries by fetching a single large page
    const agentsResponse = await fetchAgents(0, MAX_DYNAMIC_ENTRIES);
    // Slice defensively too: the cap must hold even if the API ignores the limit.
    const agentsEntries: MetadataRoute.Sitemap = agentsResponse.agents
      .slice(0, MAX_DYNAMIC_ENTRIES)
      .map((agent) => ({
        url: `${baseUrl}/agents/${agent.address}`,
        lastModified: new Date(),
        changeFrequency: 'weekly',
        priority: 0.7,
      }));
    routes.push(...agentsEntries);
  } catch (error) {
    console.error('Failed to generate agents sitemap entries:', error);
  }

  return routes;
}
