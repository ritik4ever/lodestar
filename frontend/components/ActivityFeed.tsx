'use client';

import { useEffect, useState } from 'react';
import type { ActivityEntry } from '@/lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const EXPLORER_URL =
  process.env.NEXT_PUBLIC_EXPLORER_URL ?? 'https://stellar.expert/explorer/testnet';

function truncate(s: string) {
  if (s.length <= 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function timeAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export default function ActivityFeed() {
  const [activity, setActivity] = useState<ActivityEntry[]>([]);

  async function load() {
    try {
      const res = await fetch(`${API_URL}/demo/activity`);
      if (!res.ok) return;
      const data = (await res.json()) as { activity: ActivityEntry[] };
      setActivity(data.activity);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 5_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="card p-6 h-full flex flex-col">
      <h2 className="font-semibold text-sm mb-4">Live Registry Activity</h2>

      {activity.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-secondary text-sm">
          No activity yet
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {activity.map((entry, i) => (
            <div
              key={i}
              className="border border-border rounded-lg px-4 py-3 text-xs space-y-1 fade-in"
            >
              <div className="flex items-center justify-between">
                <span className="mono text-secondary">{truncate(entry.agent)}</span>
                <span className="text-secondary">{timeAgo(entry.timestamp)}</span>
              </div>
              <p className="font-medium text-sm truncate">{entry.service}</p>
              <div className="flex items-center justify-between">
                <span className="mono text-accent">${entry.amount} USDC</span>
                {entry.txHash && (
                  <a
                    href={`${EXPLORER_URL}/tx/${entry.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mono text-secondary hover:text-primary transition-colors"
                  >
                    {truncate(entry.txHash)}
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
