import type { ServiceEntry } from '@/lib/types';

// sortServices moved to lib/sort.ts

export function filterServices(
  services: ServiceEntry[],
  query: string,
): ServiceEntry[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return services;
  }

  const matches = services.filter((service) => {
    const haystacks = [
      service.name,
      service.description,
      service.category,
      service.endpoint,
      service.provider,
    ];
    return haystacks.some((value) =>
      value.toLowerCase().includes(normalizedQuery),
    );
  });

  // Rank name matches first, then sort the rest by original order
  const nameMatches = matches.filter((service) =>
    service.name.toLowerCase().includes(normalizedQuery),
  );
  const otherMatches = matches.filter(
    (service) => !service.name.toLowerCase().includes(normalizedQuery),
  );

  return [...nameMatches, ...otherMatches];
}