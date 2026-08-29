import { sortServices, sortAgents, sortServicesWithTieBreaker, sortAgentsWithTieBreaker } from './sort';
import type { ServiceEntry, AgentEntry, SortOption, AgentSortOption } from './types';

function makeAgent(overrides: Partial<AgentEntry> = {}): AgentEntry {
  return {
    address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWFL',
    score: 0,
    total_payments: '0',
    registered_at: '100',
    active: true,
    ...overrides,
  };
}

function makeService(overrides: Partial<ServiceEntry> = {}): ServiceEntry {
  return {
    id: 1,
    name: 'Test',
    description: 'Test service',
    endpoint: 'https://example.com',
    price_usdc: '1.00',
    category: 'weather',
    provider: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWFL',
    reputation: 0,
    active: true,
    registered_at: 100,
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentEntry> = {}): AgentEntry {
  return {
    address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWFL',
    name: 'Test Agent',
    description: 'A test agent',
    owner: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWFL',
    score: 100,
    total_payments: '0',
    successful_payments: '0',
    failed_payments: '0',
    total_volume_stroops: '0',
    registered_at: '100',
    last_active: '100',
    active: true,
    flagged: false,
    flag_reason: '',
    ...overrides,
  };
}describe('sortServices', () => {
  it('sorts by newest (registered_at descending)', () => {
    const services = [
      makeService({ id: 1, registered_at: 100 }),
      makeService({ id: 2, registered_at: 300 }),
      makeService({ id: 3, registered_at: 200 }),
    ];
    const result = sortServices(services, 'newest');
    expect(result.map((s) => s.id)).toEqual([2, 3, 1]);
  });

  it('sorts by reputation descending', () => {
    const services = [
      makeService({ id: 1, reputation: 10 }),
      makeService({ id: 2, reputation: 30 }),
      makeService({ id: 3, reputation: 20 }),
    ];
    const result = sortServices(services, 'reputation');
    expect(result.map((s) => s.id)).toEqual([2, 3, 1]);
  });

  it('sorts by price ascending', () => {
    const services = [
      makeService({ id: 1, price_usdc: '1.50' }),
      makeService({ id: 2, price_usdc: '0.25' }),
      makeService({ id: 3, price_usdc: '0.75' }),
    ];
    const result = sortServices(services, 'price');
    expect(result.map((s) => s.id)).toEqual([2, 3, 1]);
  });

  it('does not mutate the original array', () => {
    const services = [
      makeService({ id: 1, registered_at: 100 }),
      makeService({ id: 2, registered_at: 300 }),
    ];
    const original = [...services];
    sortServices(services, 'newest');
    expect(services).toEqual(original);
  });
});

describe('sortAgents', () => {
  it('sorts by score descending', () => {
    const agents = [
      makeAgent({ address: 'A', score: 100 }),
      makeAgent({ address: 'B', score: 300 }),
      makeAgent({ address: 'C', score: 200 }),
    ];
    const result = sortAgents(agents, 'score');
    expect(result.map((a) => a.address)).toEqual(['B', 'C', 'A']);
  });

  it('sorts by total_payments descending', () => {
    const agents = [
      makeAgent({ address: 'A', total_payments: '10' }),
      makeAgent({ address: 'B', total_payments: '30' }),
      makeAgent({ address: 'C', total_payments: '20' }),
    ];
    const result = sortAgents(agents, 'payments');
    expect(result.map((a) => a.address)).toEqual(['B', 'C', 'A']);
  });

  it('sorts by newest (registered_at descending)', () => {
    const agents = [
      makeAgent({ address: 'A', registered_at: '100' }),
      makeAgent({ address: 'B', registered_at: '300' }),
      makeAgent({ address: 'C', registered_at: '200' }),
    ];
    const result = sortAgents(agents, 'newest');
    expect(result.map((a) => a.address)).toEqual(['B', 'C', 'A']);
  });

  it('does not mutate the original array', () => {
    const agents = [
      makeAgent({ address: 'A', registered_at: '100' }),
      makeAgent({ address: 'B', registered_at: '300' }),
    ];
    const original = [...agents];
    sortAgents(agents, 'score');
    expect(agents).toEqual(original);
  });
});

describe('sortServicesWithTieBreaker', () => {
  it('uses tie-breaker when primary sort values are equal', () => {
    const services = [
      makeService({ id: 1, reputation: 10, price_usdc: '1.00' }),
      makeService({ id: 2, reputation: 10, price_usdc: '0.50' }),
    ];
    const result = sortServicesWithTieBreaker(services, 'reputation', (a, b) =>
      parseFloat(a.price_usdc) - parseFloat(b.price_usdc)
    );
    expect(result.map((s) => s.id)).toEqual([2, 1]);
  });

  it('does not call tie-breaker when primary sort values differ', () => {
    const tieBreaker = jest.fn();
    const services = [
      makeService({ id: 1, reputation: 10 }),
      makeService({ id: 2, reputation: 20 }),
    ];
    sortServicesWithTieBreaker(services, 'reputation', tieBreaker);
    expect(tieBreaker).not.toHaveBeenCalled();
  });

  it('preserves original order for equal values without tie-breaker', () => {
    const services = [
      makeService({ id: 1, reputation: 10 }),
      makeService({ id: 2, reputation: 10 }),
    ];
    const result = sortServicesWithTieBreaker(services, 'reputation');
    expect(result.map((s) => s.id)).toEqual([1, 2]);
  });
});

describe('sortAgentsWithTieBreaker', () => {
  it('uses tie-breaker when primary sort values are equal', () => {
    const agents = [
      makeAgent({ address: 'A', score: 100, total_payments: '10' }),
      makeAgent({ address: 'B', score: 100, total_payments: '20' }),
    ];
    const result = sortAgentsWithTieBreaker(agents, 'score', (a, b) =>
      parseInt(b.total_payments) - parseInt(a.total_payments)
    );
    expect(result.map((a) => a.address)).toEqual(['B', 'A']);
  });

  it('preserves original order for equal values without tie-breaker', () => {
    const agents = [
      makeAgent({ address: 'A', score: 100 }),
      makeAgent({ address: 'B', score: 100 }),
    ];
    const result = sortAgentsWithTieBreaker(agents, 'score');
    expect(result.map((a) => a.address)).toEqual(['A', 'B']);
  });
});
