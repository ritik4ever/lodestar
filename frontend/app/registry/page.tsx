'use client';

import { useEffect, useState, useCallback } from 'react';
import ServiceCard from '@/components/ServiceCard';
import { fetchServices } from '@/lib/contract';
import type { ServiceEntry, Category, SortOption } from '@/lib/types';

const CATEGORIES: { label: string; value: Category | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Search', value: 'search' },
  { label: 'Weather', value: 'weather' },
  { label: 'Finance', value: 'finance' },
  { label: 'AI', value: 'ai' },
  { label: 'Data', value: 'data' },
  { label: 'Compute', value: 'compute' },
];

const SORTS: { label: string; value: SortOption }[] = [
  { label: 'Newest', value: 'newest' },
  { label: 'Highest Reputation', value: 'reputation' },
  { label: 'Lowest Price', value: 'price' },
];

function sortServices(services: ServiceEntry[], sort: SortOption): ServiceEntry[] {
  return [...services].sort((a, b) => {
    if (sort === 'reputation') return b.reputation - a.reputation;
    if (sort === 'price')      return parseFloat(a.price_usdc) - parseFloat(b.price_usdc);
    return b.registered_at - a.registered_at;
  });
}

export default function RegistryPage() {
  const [services, setServices]     = useState<ServiceEntry[]>([]);
  const [loading, setLoading]       = useState(true);
  const [activeCategory, setActive] = useState<Category | 'all'>('all');
  const [sort, setSort]             = useState<SortOption>('newest');

  const load = useCallback(async () => {
    try {
      const cat = activeCategory === 'all' ? undefined : activeCategory;
      const data = await fetchServices(cat);
      setServices(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [activeCategory]);

  useEffect(() => {
    setLoading(true);
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  const sorted = sortServices(services, sort);

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Service Registry</h1>
          <span className="badge bg-primary text-white mono">
            {services.length}
          </span>
        </div>

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

      {/* Category tabs */}
      <div className="flex flex-wrap gap-2 mb-8">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            onClick={() => setActive(c.value)}
            className={`px-4 py-1.5 rounded-full text-sm border transition-colors ${
              activeCategory === c.value
                ? 'bg-primary text-white border-primary'
                : 'border-border text-secondary hover:border-primary hover:text-primary'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid sm:grid-cols-2 gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card p-6 h-64 animate-pulse bg-border/40" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-24 text-secondary">
          <p className="text-base font-medium">No services found</p>
          <p className="text-sm mt-2">
            {activeCategory !== 'all'
              ? `No active services in the "${activeCategory}" category.`
              : 'The registry is empty. Be the first to register a service.'}
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-5">
          {sorted.map((svc) => (
            <ServiceCard key={svc.id} service={svc} />
          ))}
        </div>
      )}
    </div>
  );
}
