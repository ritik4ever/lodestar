import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import StatsBar from '../components/StatsBar';
import { fetchStats } from '@/lib/contract';
import type { StatsResponse } from '@/lib/types';

jest.mock('@/lib/contract', () => ({
  fetchStats: jest.fn(),
}));

const mockFetchStats = fetchStats as jest.Mock;
const REFRESH_INTERVAL_MS = 30_000;

function makeStats(totalServices: number, activeServices = totalServices): StatsResponse {
  return {
    totalServices,
    activeServices,
    categories: ['search', 'weather'],
    latestService: null,
  };
}

describe('StatsBar auto-refresh', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockFetchStats.mockReset();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('fetches stats on mount and renders the totals', async () => {
    mockFetchStats.mockResolvedValue(makeStats(3, 1));
    render(<StatsBar />);

    expect(mockFetchStats).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('3')).toBeInTheDocument();
    // The exact active count is rendered as its own stat (1, distinct from the
    // categories count of 2).
    expect(await screen.findByText('1')).toBeInTheDocument();
  });

  it('re-fetches on the 30s interval and updates the displayed totals', async () => {
    mockFetchStats
      .mockResolvedValueOnce(makeStats(3, 1))
      .mockResolvedValueOnce(makeStats(7, 5));
    render(<StatsBar />);

    expect(await screen.findByText('3')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(REFRESH_INTERVAL_MS);
    });

    expect(await screen.findByText('7')).toBeInTheDocument();
    expect(await screen.findByText('5')).toBeInTheDocument();
    expect(mockFetchStats).toHaveBeenCalledTimes(2);
  });

  it('does not start an overlapping fetch while one is still in flight', async () => {
    // First load never resolves, simulating a request slower than the interval.
    mockFetchStats.mockReturnValueOnce(new Promise<StatsResponse>(() => {}));
    render(<StatsBar />);

    expect(mockFetchStats).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(REFRESH_INTERVAL_MS);
    });

    // The in-flight guard skips the tick while the first fetch is still pending.
    expect(mockFetchStats).toHaveBeenCalledTimes(1);
  });

  it('stops refreshing after unmount', async () => {
    mockFetchStats.mockResolvedValue(makeStats(3, 1));
    const { unmount } = render(<StatsBar />);

    expect(await screen.findByText('3')).toBeInTheDocument();
    unmount();

    act(() => {
      jest.advanceTimersByTime(REFRESH_INTERVAL_MS * 2);
    });

    expect(mockFetchStats).toHaveBeenCalledTimes(1);
  });
});
