import type { ServiceEntry, AgentEntry, SortOption, AgentSortOption } from './types';

/**
 * Parse a USDC price string to a fixed-point integer (micro-USDC, 7 decimals).
 * Stellar USDC has 7 decimal places, so "1.50" → 15_000_000 micro-USDC.
 * Returns null for unparseable values (e.g. "abc", "0.001abc").
 * Exported for testing.
 */
export function parsePriceMicroUsdc(price: string): number | null {
  if (typeof price !== 'string') return null;
  const trimmed = price.trim();
  const match = trimmed.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;

  const intPart = match[1];
  const fracPart = (match[2] ?? '').padEnd(7, '0').slice(0, 7);
  const combined = `${intPart}${fracPart}`;
  const normalized = combined.replace(/^0+/, '') || '0';
  const result = Number(normalized);

  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}

/**
 * Compare two price strings as fixed-point integers.
 * Unparseable prices sort last; never returns NaN.
 */
function comparePrice(a: string, b: string): number {
  const pa = parsePriceMicroUsdc(a);
  const pb = parsePriceMicroUsdc(b);

  if (pa !== null && pb !== null) {
    if (pa < pb) return -1;
    if (pa > pb) return 1;
    return 0;
  }
  // Unparseable sorts after parseable
  if (pa !== null) return -1;
  if (pb !== null) return 1;
  return 0; // both unparseable — preserve original order
}

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
      return comparePrice(a.price_usdc, b.price_usdc);
    }
    // 'newest' - highest registered_at first
    return b.registered_at - a.registered_at;
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
    return Number(b.registered_at) - Number(a.registered_at);
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
      result = comparePrice(a.price_usdc, b.price_usdc);
    } else {
      result = b.registered_at - a.registered_at;
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
      result = Number(b.registered_at) - Number(a.registered_at);
    }
    if (result === 0 && tieBreaker) {
      return tieBreaker(a, b);
    }
    return result;
  });
}
