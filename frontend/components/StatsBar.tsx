'use client';

import { useEffect, useState } from 'react';
import { fetchStats } from '@/lib/contract';
import type { StatsResponse } from '@/lib/types';

export default function StatsBar() {
  const [stats, setStats] = useState<StatsResponse | null>(null);

  async function load() {
    try {
      const data = await fetchStats();
      setStats(data);
    } catch {
      // silently ignore — stats are non-critical
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-wrap justify-center gap-8 sm:gap-16 py-8 border-t border-b border-border">
      <Stat
        label="Total Services"
        value={stats ? String(stats.totalServices) : '—'}
      />
      <Stat
        label="Categories"
        value={stats ? String(stats.categories.length) : '—'}
      />
      <Stat
        label="Latest Registration"
        value={stats?.latestService ? stats.latestService.name : '—'}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-2xl font-semibold text-primary truncate max-w-[180px]">{value}</p>
      <p className="text-sm text-secondary mt-1">{label}</p>
    </div>
  );
}
