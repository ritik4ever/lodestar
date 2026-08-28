import type { ServiceEntry } from '@/lib/types';
import { categoryMeta } from './categoryMeta';

/**
 * Migration path:
 * Existing mixed-case category entries should be re-registered with the canonical lowercase form.
 * The on-chain registry now canonicalizes categories, so "Weather", "weather", and "weather " are treated as "weather".
 */

// sortServices moved to lib/sort.ts

export function filterServices(
  services: ServiceEntry[],
  query: string,
): ServiceEntry[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return services;
  }

  return services.filter((service) => {
    const haystacks = [service.name, service.description];
    return haystacks.some((value) =>
      value.toLowerCase().includes(normalizedQuery),
    );
  });
}

/**
 * Canonicalizes a category string for comparison and indexing.
 * Trims whitespace and lowercases the value.
 */
export function normalizeCategory(category: string): string {
  return category.trim().toLowerCase();
}

/**
 * Returns the list of valid categories, sourced from categoryMeta.
 * This should stay in sync with the on-chain list_categories().
 */
export function listCategories(): string[] {
  return Object.keys(categoryMeta);
}

/**
 * Filters services by a canonical category. The input category is normalized
 * before comparison, preventing case/whitespace mismatches.
 */
export function filterServicesByCategory(
  services: ServiceEntry[],
  category: string,
): ServiceEntry[] {
  const normalized = normalizeCategory(category);
  if (!normalized) return services;

  return services.filter(
    (service) => normalizeCategory(service.category) === normalized,
  );
}
