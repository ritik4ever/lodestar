import { filterServices } from './registry';
import type { ServiceEntry } from './types';

const SERVICES: ServiceEntry[] = [
  {
    id: 1,
    name: 'Alpha Weather',
    description: 'Hourly weather forecasts for agents',
    endpoint: 'https://weather.example.com',
    price_usdc: '1.50',
    category: 'weather',
    provider: 'GBALPHA123',
    reputation: 10,
    active: true,
    registered_at: 100,
  },
  {
    id: 2,
    name: 'Beta Search',
    description: 'Web results and snippets',
    endpoint: 'https://search.example.com',
    price_usdc: '0.25',
    category: 'search',
    provider: 'GBBETA123',
    reputation: 30,
    active: true,
    registered_at: 300,
  },
  {
    id: 3,
    name: 'Gamma Data',
    description: 'Weather archives and climate datasets',
    endpoint: 'https://data.example.com',
    price_usdc: '0.75',
    category: 'data',
    provider: 'GBGAMMA123',
    reputation: 30,
    active: true,
    registered_at: 200,
  },
];

// sortServices tests removed (moved to sort.test.ts)

describe('filterServices', () => {
  it('returns all services when the query is empty', () => {
    expect(filterServices(SERVICES, '   ')).toEqual(SERVICES);
  });

  it('matches service names case-insensitively', () => {
    expect(filterServices(SERVICES, 'beta').map((service) => service.id)).toEqual([2]);
  });

  it('matches service descriptions case-insensitively', () => {
    expect(filterServices(SERVICES, 'climate').map((service) => service.id)).toEqual([3]);
  });

  it('returns multiple matches when the query appears in multiple services', () => {
    expect(filterServices(SERVICES, 'weather').map((service) => service.id)).toEqual([1, 3]);
  });

  it('matches service category', () => {
    const categoryOnlyMatch: ServiceEntry = {
      ...SERVICES[1],
      id: 6,
      category: 'web-search',
    };
    expect(filterServices([...SERVICES, categoryOnlyMatch], 'web-search')
      .map((service) => service.id)).toEqual([6]);
  });

  it('matches service endpoint', () => {
    expect(filterServices(SERVICES, 'data.example.com').map((service) => service.id)).toEqual([3]);
  });

  it('matches service provider', () => {
    expect(filterServices(SERVICES, 'GBBETA123').map((service) => service.id)).toEqual([2]);
  });

  it('ranks name matches before other field matches', () => {
    const servicesWithOverlap: ServiceEntry[] = [
      ...SERVICES,
      {
        id: 4,
        name: 'Delta Finance',
        description: 'Financial data API',
        endpoint: 'https://finance.example.com',
        price_usdc: '2.00',
        category: 'finance',
        provider: 'GBDELTA123',
        reputation: 20,
        active: true,
        registered_at: 400,
      },
      {
        id: 5,
        name: 'Epsilon Compute',
        description: 'Distributed compute for finance workloads',
        endpoint: 'https://compute.example.com',
        price_usdc: '5.00',
        category: 'compute',
        provider: 'GBEPSILON123',
        reputation: 15,
        active: true,
        registered_at: 500,
      },
    ];
    // 'finance' appears in Delta Finance (name) and Epsilon Compute (description).
    // Name match (Delta) should come before description match (Epsilon).
    const result = filterServices(servicesWithOverlap, 'finance');
    expect(result.map((service) => service.id)).toEqual([4, 5]);
  });
});