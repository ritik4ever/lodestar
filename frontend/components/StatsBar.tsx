'use client';

import { useEffect, useState } from 'react';
import { fetchStats } from '@/lib/contract';
import type { StatsResponse } from '@/lib/types';

const REFRESH_INTERVAL_MS = 30_000;

export default function StatsBar() {
  const [stats, setStats] = useState<StatsResponse | null>(null);

  useEffect(() => {
    let active = true;
    let inFlight = false;

    async function load() {
      // Skip if a previous refresh is still pending so a fetch slower than
      // the interval can't overlap the next tick.
      if (inFlight) return;
      inFlight = true;
      try {
        const data = await fetchStats();
        if (active) setStats(data);
      } catch {
        // silently ignore — stats are non-critical
      } finally {
        inFlight = false;
      }
    }

    load();
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="flex flex-wrap justify-center gap-8 sm:gap-16 py-8 border-t border-b border-border">
      <Stat
        label="Total Services"
        value={stats ? String(stats.totalServices) : '—'}
      />
      <Stat
        label="Active Services"
        value={stats ? String(stats.activeServices) : '—'}
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
