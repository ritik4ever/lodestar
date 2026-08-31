'use client';

import { useState, useEffect } from 'react';
import useSWR from 'swr';
import ServiceCard from '@/components/ServiceCard';
import ServiceCardSkeleton from '@/components/ServiceCardSkeleton';
import EmptyState from '@/components/EmptyState';
import { CATEGORY_FILTERS, CATEGORY_ICONS } from '@/lib/categoryMeta';
import { EmptyRegistryIcon, SearchEmptyIcon, CategoryEmptyIcon } from '@/lib/emptyStateIcons';
import { fetchServices } from '@/lib/contract';
import { filterServices } from '@/lib/registry';
import { sortServices } from '@/lib/sort';
import type { Category, SortOption } from '@/lib/types';
import { useDebounce } from '@/hooks/useDebounce';

const SORTS: { label: string; value: SortOption }[] = [
  { label: 'Newest', value: 'newest' },
  { label: 'Highest Reputation', value: 'reputation' },
  { label: 'Lowest Price', value: 'price' },
];

import { PAGE_SIZE } from '@/lib/pagination';

export default function RegistryPage() {
  const [activeCategory, setActive] = useState<Category | 'all'>('all');
  const [sort, setSort]             = useState<SortOption>('newest');
  const [query, setQuery]           = useState('');
  const debouncedQuery              = useDebounce(query);
  const [page, setPage]             = useState(1);

  // SWR replaces the manual setInterval poll: it dedupes concurrent requests,
  // revalidates every 30s, and only re-renders when the returned data changes.
  const { data: services = [], isLoading: loading, error: swrError, mutate } = useSWR(
    ['services', activeCategory],
    () => fetchServices(activeCategory === 'all' ? undefined : activeCategory),
    { refreshInterval: 30_000, revalidateOnFocus: false, keepPreviousData: true }
  );

  const error = swrError
    ? swrError instanceof Error
      ? swrError.message
      : 'Failed to load'
    : null;

  // Reset to page 1 whenever the debounced query, sort, or category changes.
  useEffect(() => {
    setPage(1);
  }, [debouncedQuery, sort, activeCategory]);

  const sorted   = sortServices(services, sort);
  const filtered = filterServices(sorted, debouncedQuery);

  const totalPages  = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage    = Math.min(page, totalPages);
  const startIndex  = (safePage - 1) * PAGE_SIZE;
  const paginated   = filtered.slice(startIndex, startIndex + PAGE_SIZE);

  // Build a compact page-number list: always show first, last, current ±1, with ellipsis gaps
  function buildPageNumbers(total: number, current: number): (number | '…')[] {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages: (number | '…')[] = [];
    const show = new Set([1, total, current - 1, current, current + 1].filter((p) => p >= 1 && p <= total));
    let prev = 0;
    for (const p of [...show].sort((a, b) => a - b)) {
      if (p - prev > 1) pages.push('…');
      pages.push(p);
      prev = p;
    }
    return pages;
  }

  const pageNumbers = buildPageNumbers(totalPages, safePage);

  function handleCategoryChange(val: Category | 'all') {
    setActive(val);
    setPage(1);
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Service Registry</h1>
          <span className="badge bg-primary text-white mono">
            {filtered.length}
          </span>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by service name or description"
            className="w-full sm:w-80 border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            className="border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-2 mb-8">
        {CATEGORY_FILTERS.map((c) => (
          <button
            key={c.value}
            onClick={() => handleCategoryChange(c.value)}
            className={`px-4 py-1.5 rounded-full text-sm border transition-colors inline-flex items-center gap-1.5 ${
              activeCategory === c.value
                ? 'bg-primary text-white border-primary'
                : 'border-border text-secondary hover:border-primary hover:text-primary'
            }`}
          >
            {c.value !== 'all' ? CATEGORY_ICONS[c.value] : null}
            {c.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid sm:grid-cols-2 gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <ServiceCardSkeleton key={i} />
          ))}
        </div>
      ) : error && services.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-error text-sm mb-2">{error}</p>
          <button
            onClick={() => mutate()}
            aria-label="Retry"
            className="mt-3 px-4 py-2 text-sm rounded-lg border border-border bg-background hover:bg-border/40 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-24">
          {debouncedQuery.trim() ? (
            <EmptyState
              icon={<SearchEmptyIcon />}
              title="No matching services"
              message={`No services match "${debouncedQuery.trim()}". Try a different name or description keyword.`}
              action={{ label: 'Clear search', onClick: () => setQuery('') }}
            />
          ) : activeCategory !== 'all' ? (
            <EmptyState
              icon={<CategoryEmptyIcon />}
              title="Empty category"
              message={`No active services in the "${activeCategory}" category.`}
              action={{ label: 'Show all categories', onClick: () => setActive('all') }}
            />
          ) : (
            <EmptyState
              icon={<EmptyRegistryIcon />}
              title="The registry is empty"
              message="No services have been registered yet. Be the first to add a service to the registry."
              action={{ href: '/registry/register', label: 'Register a Service' }}
            />
          )}
        </div>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 gap-5">
            {paginated.map((svc) => (
              <ServiceCard key={svc.id} service={svc} />
            ))}
          </div>

          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-10 flex-wrap gap-4">
              {/* Result range label */}
              <p className="text-sm text-secondary">
                Showing{' '}
                <span className="font-medium text-foreground">
                  {startIndex + 1}–{Math.min(startIndex + PAGE_SIZE, filtered.length)}
                </span>{' '}
                of{' '}
                <span className="font-medium text-foreground">{filtered.length}</span>{' '}
                services
              </p>

              {/* Page buttons */}
              <nav aria-label="Pagination" className="flex items-center gap-1">
                {/* Prev */}
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  aria-label="Previous page"
                  className="px-3 py-1.5 rounded-lg border border-border text-sm text-secondary hover:border-primary hover:text-primary transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  ←
                </button>

                {pageNumbers.map((pn, idx) =>
                  pn === '…' ? (
                    <span
                      key={`ellipsis-${idx}`}
                      className="px-2 py-1.5 text-sm text-secondary select-none"
                    >
                      …
                    </span>
                  ) : (
                    <button
                      key={pn}
                      onClick={() => setPage(pn)}
                      aria-label={`Page ${pn}`}
                      aria-current={pn === safePage ? 'page' : undefined}
                      className={`min-w-[2rem] px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                        pn === safePage
                          ? 'bg-primary text-white border-primary font-medium'
                          : 'border-border text-secondary hover:border-primary hover:text-primary'
                      }`}
                    >
                      {pn}
                    </button>
                  )
                )}

                {/* Next */}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  aria-label="Next page"
                  className="px-3 py-1.5 rounded-lg border border-border text-sm text-secondary hover:border-primary hover:text-primary transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  →
                </button>
              </nav>
            </div>
          )}
        </>
      )}
    </div>
  );
}
