import { AGENTS_CONTRACT_ID, DEMO_AGENT_ADDRESS, fetchServices } from '../lib/contract';
import type { ServiceEntry } from '../lib/types';

const mockFetch = jest.fn();

function makeService(id: number, category: string = 'weather'): ServiceEntry {
  return {
    id,
    name: `Service ${id}`,
    description: `Description ${id}`,
    endpoint: `https://example.com/${id}`,
    price_usdc: '0.001',
    category: category as ServiceEntry['category'],
    provider: `G${'A'.repeat(55)}`,
    reputation: 0,
    active: true,
    registered_at: 1000 + id,
  };
}

function mockApiResponse(services: ServiceEntry[]) {
  return {
    ok: true,
    json: async () => ({ services, count: services.length }),
  } as unknown as Response;
}

describe('fetchServices pagination walk (#300)', () => {
  beforeAll(() => {
    // jsdom's AbortSignal predates AbortSignal.timeout, which apiFetch uses.
    if (typeof AbortSignal.timeout !== 'function') {
      Object.defineProperty(AbortSignal, 'timeout', {
        configurable: true,
        value: () =>
          typeof AbortController !== 'undefined'
            ? new AbortController().signal
            : undefined,
      });
    }
  });

  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it('walks all pages until a short page when no active count is available', async () => {
    // 120 services across 3 pages of 50: 50 + 50 + 20 (short page). The stats
    // call fails, so the walk falls back to stopping at the short page.
    const page1 = Array.from({ length: 50 }, (_, i) => makeService(i + 1));
    const page2 = Array.from({ length: 50 }, (_, i) => makeService(i + 51));
    const page3 = Array.from({ length: 20 }, (_, i) => makeService(i + 101));
    mockFetch
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
      .mockResolvedValueOnce(mockApiResponse(page1))
      .mockResolvedValueOnce(mockApiResponse(page2))
      .mockResolvedValueOnce(mockApiResponse(page3));

    const services = await fetchServices(undefined);

    expect(services).toHaveLength(120);
    expect(services[0].id).toBe(1);
    expect(services[119].id).toBe(120);
    // stats call + 3 service pages
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('stops exactly at the active count bound for the unfiltered view', async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => makeService(i + 1));
    const page2 = Array.from({ length: 50 }, (_, i) => makeService(i + 51));
    // 100 active services → exactly 2 full pages, no trailing empty request.
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          totalServices: 120,
          activeServices: 100,
          categories: [],
          latestService: null,
        }),
      })
      .mockResolvedValueOnce(mockApiResponse(page1))
      .mockResolvedValueOnce(mockApiResponse(page2));

    const services = await fetchServices(undefined);

    expect(services).toHaveLength(100);
    // stats + exactly 2 pages — the bound avoids a third (empty) request
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('walks until a short page for a category (no global bound)', async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => makeService(i + 1, 'weather'));
    const page2 = Array.from({ length: 8 }, (_, i) => makeService(i + 51, 'weather'));
    mockFetch
      .mockResolvedValueOnce(mockApiResponse(page1))
      .mockResolvedValueOnce(mockApiResponse(page2));

    const services = await fetchServices('weather');

    expect(services).toHaveLength(58);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // Category requests never hit /api/stats.
    expect(mockFetch.mock.calls[0][0]).toContain('category=weather');
    expect(String(mockFetch.mock.calls[0][0])).not.toContain('/api/stats');
  });

  it('passes offset/limit params on every page request', async () => {
    mockFetch.mockResolvedValueOnce(mockApiResponse([]));

    await fetchServices('weather');

    expect(String(mockFetch.mock.calls[0][0])).toBe(
      'http://localhost:3001/api/services?offset=0&limit=50&category=weather'
    );
  });
});

describe('contract module constants', () => {
  describe('AGENTS_CONTRACT_ID', () => {
    it('is exported as a string', () => {
      expect(typeof AGENTS_CONTRACT_ID).toBe('string');
    });

    it('falls back to empty string when NEXT_PUBLIC_AGENTS_CONTRACT_ID is not set', () => {
      // In the test environment no env var is configured, so the default kicks in.
      expect(AGENTS_CONTRACT_ID).toBe('');
    });
  });

  describe('DEMO_AGENT_ADDRESS', () => {
    it('is exported as a string', () => {
      expect(typeof DEMO_AGENT_ADDRESS).toBe('string');
    });

    it('falls back to empty string when NEXT_PUBLIC_DEMO_AGENT_ADDRESS is not set', () => {
      expect(DEMO_AGENT_ADDRESS).toBe('');
    });
  });
});
