import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import AgentsPage from '../app/agents/page';
import { PAGE_SIZE } from '../lib/pagination';
import type { AgentEntry, AgentStats } from '@/lib/types';

// Wrap in a fresh SWR cache per render so cached data never leaks between tests,
// and disable deduping so each test's mock fetch is actually invoked.
function renderPage() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AgentsPage />
    </SWRConfig>
  );
}

jest.mock('@/lib/contract', () => ({
  fetchAgents: jest.fn(),
  fetchAgentStats: jest.fn(),
}));

jest.mock('next/link', () => {
  const MockLink = ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  );
  MockLink.displayName = 'Link';
  return MockLink;
});

import { fetchAgents, fetchAgentStats } from '@/lib/contract';

const mockAgent: AgentEntry = {
  address: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNOPQRSTUV',
  name: 'Demo Agent',
  description: 'Handles demo requests',
  owner: 'GOWNER',
  score: 820,
  total_payments: '10',
  successful_payments: '9',
  failed_payments: '1',
  total_volume_stroops: '10000000',
  registered_at: '12345',
  last_active: '12350',
  active: true,
  flagged: false,
  flag_reason: '',
};

const mockStats: AgentStats = {
  totalAgents: 1,
  avgScore: 820,
  topAgent: mockAgent,
  totalVolume: '1.00',
  totalVolumeStroops: '10000000',
};

function makeAgent(overrides: Partial<AgentEntry> = {}): AgentEntry {
  return {
    ...mockAgent,
    ...overrides,
    address: overrides.address ?? mockAgent.address,
    name: overrides.name ?? mockAgent.name,
    score: overrides.score ?? mockAgent.score,
    total_payments: overrides.total_payments ?? mockAgent.total_payments,
    successful_payments: overrides.successful_payments ?? mockAgent.successful_payments,
    failed_payments: overrides.failed_payments ?? mockAgent.failed_payments,
  };
}

describe('AgentsPage retry state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lets users retry after the agents request fails', async () => {
    (fetchAgents as jest.Mock)
      .mockRejectedValueOnce(new Error('Network disconnected'))
      .mockResolvedValueOnce({ agents: [mockAgent], total: 1, page: 0, pageSize: PAGE_SIZE });
    (fetchAgentStats as jest.Mock).mockResolvedValue(mockStats);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Network disconnected')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(screen.queryAllByText('Demo Agent').length).toBeGreaterThan(0);
    });
    expect(fetchAgents).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Network disconnected')).not.toBeInTheDocument();
  });
});

describe('AgentsPage data rendering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the agent grid when agents exist even if stats are unavailable', async () => {
    (fetchAgents as jest.Mock).mockResolvedValue({
      agents: [makeAgent({ address: 'A', name: 'Visible Agent' })],
      total: 1,
      page: 0,
      pageSize: PAGE_SIZE,
    });
    (fetchAgentStats as jest.Mock).mockRejectedValue(new Error('Stats unavailable'));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Visible Agent')).toBeInTheDocument();
    });
    expect(screen.queryByText('No agents registered yet.')).not.toBeInTheDocument();
  });
});

describe('AgentsPage score tier filter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('defaults to the All filter and shows all agents', async () => {
    (fetchAgents as jest.Mock).mockResolvedValue({
      agents: [
        makeAgent({ address: 'A', name: 'New Agent', score: 100, total_payments: '1' }),
        makeAgent({ address: 'B', name: 'Building Agent', score: 350, total_payments: '2' }),
        makeAgent({ address: 'C', name: 'Established Agent', score: 650, total_payments: '3' }),
        makeAgent({ address: 'D', name: 'Trusted Agent', score: 950, total_payments: '4' }),
        makeAgent({ address: 'E', name: 'Elite Agent', score: 1000, total_payments: '5' }),
      ],
      total: 5,
      page: 0,
      pageSize: PAGE_SIZE,
    });
    (fetchAgentStats as jest.Mock).mockResolvedValue(mockStats);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('New Agent')).toBeInTheDocument();
      expect(screen.getByText('Elite Agent')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('filters agents by each score tier', async () => {
    (fetchAgents as jest.Mock).mockImplementation((_page, _pageSize, _sort, tier) => {
      if (tier === 'trusted') {
        return Promise.resolve({
          agents: [makeAgent({ address: 'D', name: 'Trusted Agent', score: 950, total_payments: '4' })],
          total: 1,
          page: 0,
          pageSize: PAGE_SIZE,
        });
      }

      return Promise.resolve({
        agents: [
          makeAgent({ address: 'A', name: 'New Agent', score: 100, total_payments: '1' }),
          makeAgent({ address: 'B', name: 'Building Agent', score: 350, total_payments: '2' }),
          makeAgent({ address: 'C', name: 'Established Agent', score: 650, total_payments: '3' }),
          makeAgent({ address: 'D', name: 'Trusted Agent', score: 950, total_payments: '4' }),
          makeAgent({ address: 'E', name: 'Elite Agent', score: 1000, total_payments: '5' }),
        ],
        total: 5,
        page: 0,
        pageSize: PAGE_SIZE,
      });
    });
    (fetchAgentStats as jest.Mock).mockResolvedValue(mockStats);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Trusted Agent')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Trusted' }));

    await waitFor(() => {
      expect(screen.getByText('Trusted Agent')).toBeInTheDocument();
    });
    expect(screen.queryByText('New Agent')).not.toBeInTheDocument();
    expect(screen.queryByText('Elite Agent')).not.toBeInTheDocument();
  });

  it('uses the server total when a tier has matches beyond the first page', async () => {
    (fetchAgents as jest.Mock).mockResolvedValue({
      agents: [makeAgent({ address: 'A', name: 'Building One', score: 350, total_payments: '2' })],
      total: 13,
      page: 0,
      pageSize: PAGE_SIZE,
    });
    (fetchAgentStats as jest.Mock).mockResolvedValue(mockStats);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Building One')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Building' }));

    expect(fetchAgents).toHaveBeenLastCalledWith(0, PAGE_SIZE, 'score', 'building');
    expect(screen.getByText('Showing 1–12 of 13')).toBeInTheDocument();
  });

  it('applies the selected tier filter alongside sorting', async () => {
    (fetchAgents as jest.Mock).mockImplementation((_page, _pageSize, sort, tier) => {
      if (tier === 'building') {
        return Promise.resolve({
          agents: [
            makeAgent({ address: 'B', name: 'Building Two', score: 400, total_payments: '8' }),
            makeAgent({ address: 'A', name: 'Building One', score: 350, total_payments: '2' }),
          ],
          total: 2,
          page: 0,
          pageSize: PAGE_SIZE,
        });
      }

      return Promise.resolve({
        agents: [
          makeAgent({ address: 'A', name: 'Building One', score: 350, total_payments: '2' }),
          makeAgent({ address: 'C', name: 'Trusted Agent', score: 950, total_payments: '4' }),
        ],
        total: 2,
        page: 0,
        pageSize: PAGE_SIZE,
      });
    });
    (fetchAgentStats as jest.Mock).mockResolvedValue(mockStats);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Building One')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Sort agents'), { target: { value: 'payments' } });
    fireEvent.click(screen.getByRole('button', { name: 'Building' }));

    await waitFor(() => {
      expect(screen.getByText('Building Two')).toBeInTheDocument();
    });

    const visibleNames = screen.getAllByRole('link', { name: /Building/i }).map((element) => element.textContent);
    expect(visibleNames).toContain('Building Two');
    expect(visibleNames[0]).toBe('Building Two');
  });

  it('shows an empty state when a selected tier has no matches', async () => {
    (fetchAgents as jest.Mock).mockImplementation((_page, _pageSize, _sort, tier) => {
      if (tier === 'elite') {
        return Promise.resolve({
          agents: [],
          total: 0,
          page: 0,
          pageSize: PAGE_SIZE,
        });
      }

      return Promise.resolve({
        agents: [makeAgent({ address: 'A', name: 'New Agent', score: 100, total_payments: '1' })],
        total: 1,
        page: 0,
        pageSize: PAGE_SIZE,
      });
    });
    (fetchAgentStats as jest.Mock).mockResolvedValue(mockStats);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('New Agent')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Elite' }));

    await waitFor(() => {
      expect(screen.getByText('No agents match the selected tier.')).toBeInTheDocument();
    });
  });

  it('resets the filter when the All chip is selected', async () => {
    (fetchAgents as jest.Mock).mockResolvedValue({
      agents: [
        makeAgent({ address: 'A', name: 'New Agent', score: 100, total_payments: '1' }),
        makeAgent({ address: 'B', name: 'Trusted Agent', score: 950, total_payments: '4' }),
      ],
      total: 2,
      page: 0,
      pageSize: PAGE_SIZE,
    });
    (fetchAgentStats as jest.Mock).mockResolvedValue(mockStats);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Trusted Agent')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Trusted' }));
    fireEvent.click(screen.getByRole('button', { name: 'All' }));

    expect(screen.getByText('New Agent')).toBeInTheDocument();
    expect(screen.getByText('Trusted Agent')).toBeInTheDocument();
  });
});
