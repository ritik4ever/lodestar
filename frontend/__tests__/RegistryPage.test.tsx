import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import RegistryPage from '../app/registry/page';

jest.mock('swr', () => ({
  __esModule: true,
  default: jest.fn(),
}), { virtual: true });

import useSWR from 'swr';
import { fetchServices } from '@/lib/contract';
import { PAGE_SIZE } from '@/lib/pagination';

jest.mock('@/lib/contract', () => ({
  fetchServices: jest.fn(),
}));

function makeServices(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Service ${i + 1}`,
    description: `Description ${i + 1}`,
    endpoint: `https://example.com/${i + 1}`,
    price_usdc: '0.001',
    category: 'weather',
    provider: `G${'A'.repeat(55)}`,
    reputation: 100,
    active: true,
    registered_at: 1000 + i,
  }));
}

describe('RegistryPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useSWR as jest.Mock).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      mutate: jest.fn(),
    });
  });

  it('shows skeleton cards while loading', () => {
    (useSWR as jest.Mock).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      mutate: jest.fn(),
    });

    render(<RegistryPage />);
    expect(screen.getAllByTestId('service-card-skeleton')).toHaveLength(4);
  });

  it('shows empty-registry message when no services', async () => {
    (useSWR as jest.Mock).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      mutate: jest.fn(),
    });

    render(<RegistryPage />);
    expect(await screen.findByText(/registry is empty/i)).toBeInTheDocument();
  });

  it('renders services from SWR data without pagination when within one page', async () => {
    const services = makeServices(PAGE_SIZE - 1);
    (useSWR as jest.Mock).mockReturnValue({
      data: services,
      isLoading: false,
      error: null,
      mutate: jest.fn(),
    });

    render(<RegistryPage />);
    await waitFor(() => {
      expect(screen.getAllByText(/^Service \d+$/).length).toBe(PAGE_SIZE - 1);
    });
    expect(screen.queryByRole('navigation', { name: /pagination/i })).not.toBeInTheDocument();
  });

  it('shows pagination when results exceed one page', async () => {
    const services = makeServices(PAGE_SIZE + 5);
    (useSWR as jest.Mock).mockReturnValue({
      data: services,
      isLoading: false,
      error: null,
      mutate: jest.fn(),
    });

    render(<RegistryPage />);
    expect(await screen.findByRole('navigation', { name: /pagination/i })).toBeInTheDocument();
  });
});
