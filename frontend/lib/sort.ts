import type { ServiceEntry, AgentEntry, SortOption, AgentSortOption } from './types';

/**
 * Sort services by the given option.
 * 
 * @param services - Array of service entries to sort
 * @param sort - Sort option ('newest' | 'reputation' | 'price')
 * @returns A new sorted array (does not mutate the original)
 */
export function sortServices(
  services: ServiceEntry[],
  sort: SortOption,
): ServiceEntry[] {
  return [...services].sort((a, b) => {
    if (sort === 'reputation') {
      return b.reputation - a.reputation;
    }
    if (sort === 'price') {
      return parseFloat(a.price_usdc) - parseFloat(b.price_usdc);
    }
    // 'newest' - highest registered_at first
    return (b.registered_at ?? 0) - (a.registered_at ?? 0);
  });
}

/**
 * Sort agents by the given option.
 * 
 * @param agents - Array of agent entries to sort
 * @param sort - Sort option ('score' | 'payments' | 'newest')
 * @returns A new sorted array (does not mutate the original)
 */
export function sortAgents(
  agents: AgentEntry[],
  sort: AgentSortOption,
): AgentEntry[] {
  return [...agents].sort((a, b) => {
    if (sort === 'score') {
      return b.score - a.score;
    }
    if (sort === 'payments') {
      return Number(b.total_payments) - Number(a.total_payments);
    }
    // 'newest' - highest registered_at first
    return Number(b.registered_at ?? 0) - Number(a.registered_at ?? 0);
  });
}

/**
 * Sort services by the given option with support for equal values.
 * This is useful for testing edge cases where values are equal.
 * 
 * @param services - Array of service entries to sort
 * @param sort - Sort option ('newest' | 'reputation' | 'price')
 * @param tieBreaker - Optional tie-breaker function
 * @returns A new sorted array (does not mutate the original)
 */
export function sortServicesWithTieBreaker(
  services: ServiceEntry[],
  sort: SortOption,
  tieBreaker?: (a: ServiceEntry, b: ServiceEntry) => number,
): ServiceEntry[] {
  return [...services].sort((a, b) => {
    let result = 0;
    if (sort === 'reputation') {
      result = b.reputation - a.reputation;
    } else if (sort === 'price') {
      result = parseFloat(a.price_usdc) - parseFloat(b.price_usdc);
    } else {
      result = (b.registered_at ?? 0) - (a.registered_at ?? 0);
    }
    if (result === 0 && tieBreaker) {
      return tieBreaker(a, b);
    }
    return result;
  });
}

/**
 * Sort agents by the given option with support for equal values.
 * 
 * @param agents - Array of agent entries to sort
 * @param sort - Sort option ('score' | 'payments' | 'newest')
 * @param tieBreaker - Optional tie-breaker function
 * @returns A new sorted array (does not mutate the original)
 */
export function sortAgentsWithTieBreaker(
  agents: AgentEntry[],
  sort: AgentSortOption,
  tieBreaker?: (a: AgentEntry, b: AgentEntry) => number,
): AgentEntry[] {
  return [...agents].sort((a, b) => {
    let result = 0;
    if (sort === 'score') {
      result = b.score - a.score;
    } else if (sort === 'payments') {
      result = Number(b.total_payments) - Number(a.total_payments);
    } else {
      result = Number(b.registered_at ?? 0) - Number(a.registered_at ?? 0);
    }
    if (result === 0 && tieBreaker) {
      return tieBreaker(a, b);
    }
    return result;
  });
}