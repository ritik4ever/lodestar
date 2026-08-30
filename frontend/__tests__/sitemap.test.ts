/**
 * Sitemap dynamic routes (#849).
 *
 * The registry is the content most worth indexing, so these tests pin that
 * service and agent detail pages are enumerated, that generation stays bounded,
 * and that a registry outage degrades to the static routes instead of failing
 * the build.
 */

const mockFetchServices = jest.fn();
const mockFetchAgents = jest.fn();

jest.mock('@/lib/contract', () => ({
  fetchServices: (...args: unknown[]) => mockFetchServices(...args),
  fetchAgents: (...args: unknown[]) => mockFetchAgents(...args),
}));

import sitemap, { MAX_DYNAMIC_ENTRIES, revalidate } from '@/app/sitemap';

const BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://lodestar.app';

function service(id: string) {
  return { id, name: `Service ${id}`, category: 'weather', registered_at: 1000 };
}

function agent(address: string) {
  return { address, score: 500 };
}

describe('sitemap (#849)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchServices.mockResolvedValue([]);
    mockFetchAgents.mockResolvedValue({ agents: [] });
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('static routes', () => {
    it('always includes the core pages', async () => {
      const urls = (await sitemap()).map((e) => e.url);

      expect(urls).toEqual(
        expect.arrayContaining([BASE, `${BASE}/registry`, `${BASE}/agents`, `${BASE}/register`]),
      );
    });
  });

  describe('dynamic routes', () => {
    it('includes a route per registered service', async () => {
      mockFetchServices.mockResolvedValue([service('1'), service('2')]);

      const urls = (await sitemap()).map((e) => e.url);

      expect(urls).toContain(`${BASE}/services/1`);
      expect(urls).toContain(`${BASE}/services/2`);
    });

    it('includes a route per registered agent', async () => {
      mockFetchAgents.mockResolvedValue({ agents: [agent('GABC'), agent('GDEF')] });

      const urls = (await sitemap()).map((e) => e.url);

      expect(urls).toContain(`${BASE}/agents/GABC`);
      expect(urls).toContain(`${BASE}/agents/GDEF`);
    });

    it('sets a deliberate change frequency and priority on dynamic entries', async () => {
      mockFetchServices.mockResolvedValue([service('1')]);
      mockFetchAgents.mockResolvedValue({ agents: [agent('GABC')] });

      const entries = await sitemap();
      const svc = entries.find((e) => e.url === `${BASE}/services/1`)!;
      const agt = entries.find((e) => e.url === `${BASE}/agents/GABC`)!;

      expect(svc.changeFrequency).toBe('weekly');
      expect(agt.changeFrequency).toBe('weekly');
      // Detail pages rank below the listing pages, which are 'daily'.
      expect(svc.priority).toBeLessThan(0.9);
      expect(agt.priority).toBeLessThan(0.9);
    });

    it('gives every entry a lastModified date', async () => {
      mockFetchServices.mockResolvedValue([service('1')]);

      for (const entry of await sitemap()) {
        expect(entry.lastModified).toBeInstanceOf(Date);
      }
    });
  });

  describe('bounded generation', () => {
    it('caps service entries', async () => {
      mockFetchServices.mockResolvedValue(
        Array.from({ length: MAX_DYNAMIC_ENTRIES + 250 }, (_, i) => service(String(i))),
      );

      const serviceEntries = (await sitemap()).filter((e) => e.url.includes('/services/'));

      expect(serviceEntries).toHaveLength(MAX_DYNAMIC_ENTRIES);
    });

    it('asks the agents API for no more than the cap', async () => {
      await sitemap();

      expect(mockFetchAgents).toHaveBeenCalledWith(0, MAX_DYNAMIC_ENTRIES);
    });

    it('caps agent entries even if the API returns more than requested', async () => {
      mockFetchAgents.mockResolvedValue({
        agents: Array.from({ length: MAX_DYNAMIC_ENTRIES + 50 }, (_, i) => agent(`G${i}`)),
      });

      const agentEntries = (await sitemap()).filter((e) => e.url.includes('/agents/'));

      // The /agents listing URL has no trailing slash, so this counts detail routes only.
      expect(agentEntries).toHaveLength(MAX_DYNAMIC_ENTRIES);
    });
  });

  describe('fetch failure', () => {
    it('still returns the static routes when services cannot be fetched', async () => {
      mockFetchServices.mockRejectedValue(new Error('RPC down'));

      const urls = (await sitemap()).map((e) => e.url);

      expect(urls).toContain(BASE);
      expect(urls).toContain(`${BASE}/registry`);
      expect(urls.some((u) => u.includes('/services/'))).toBe(false);
    });

    it('still includes services when only the agents fetch fails', async () => {
      mockFetchServices.mockResolvedValue([service('1')]);
      mockFetchAgents.mockRejectedValue(new Error('RPC down'));

      const urls = (await sitemap()).map((e) => e.url);

      expect(urls).toContain(`${BASE}/services/1`);
      expect(urls.some((u) => u.startsWith(`${BASE}/agents/`))).toBe(false);
    });

    it('never rejects, so a registry outage cannot fail the build', async () => {
      mockFetchServices.mockRejectedValue(new Error('boom'));
      mockFetchAgents.mockRejectedValue(new Error('boom'));

      await expect(sitemap()).resolves.toEqual(expect.any(Array));
    });
  });

  describe('revalidation', () => {
    it('regenerates on a schedule rather than only at build time', () => {
      expect(typeof revalidate).toBe('number');
      expect(revalidate).toBeGreaterThan(0);
    });
  });
});
