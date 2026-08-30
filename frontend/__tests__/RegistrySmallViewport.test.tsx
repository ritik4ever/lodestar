import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RegistryPage from '../app/registry/page';
import ServiceCard from '../components/ServiceCard';
import ServiceCardSkeleton from '../components/ServiceCardSkeleton';

jest.mock('swr', () => ({
  __esModule: true,
  default: jest.fn(),
}), { virtual: true });

import useSWR from 'swr';
import { fetchServices, submitReputation } from '@/lib/contract';
import { PAGE_SIZE } from '@/lib/pagination';

jest.mock('@/lib/contract', () => ({
  fetchServices: jest.fn(),
  submitReputation: jest.fn(),
}));

const mockService = {
  id: 1,
  name: 'Super Long Service Name That Could Wrap On Small Viewports',
  description: 'A test service designed to verify small viewport layout and tap targets.',
  endpoint: 'https://api.longexampledomain.com/v1/nested/endpoint/resource/path',
  price_usdc: '0.005',
  category: 'weather' as const,
  provider: 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVAAA',
  reputation: 15,
  active: true,
  registered_at: 987654,
};

describe('Registry Page & ServiceCard Small Viewport Layout & Tap Targets (Issue #794)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockImplementation(() => Promise.resolve()),
      },
    });
    (useSWR as jest.Mock).mockReturnValue({
      data: [mockService],
      isLoading: false,
      error: null,
      mutate: jest.fn(),
    });
  });

  describe('Tap target minimum size (44px) requirements', () => {
    it('ensures search input and sort dropdown meet 44px height', () => {
      render(<RegistryPage />);
      const searchInput = screen.getByPlaceholderText(/search by service name/i);
      const sortSelect = screen.getByRole('combobox');

      expect(searchInput).toHaveClass('min-h-[44px]');
      expect(sortSelect).toHaveClass('min-h-[44px]');
    });

    it('ensures category filter chips meet 44px minimum tap targets', () => {
      render(<RegistryPage />);
      const allButton = screen.getByRole('button', { name: /^All$/i });
      const weatherButton = screen.getByRole('button', { name: /Weather/i });

      expect(allButton).toHaveClass('min-h-[44px]');
      expect(weatherButton).toHaveClass('min-h-[44px]');
    });

    it('ensures pagination buttons meet 44px minimum tap target dimensions', () => {
      const services = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => ({
        ...mockService,
        id: i + 1,
        name: `Service ${i + 1}`,
      }));

      (useSWR as jest.Mock).mockReturnValue({
        data: services,
        isLoading: false,
        error: null,
        mutate: jest.fn(),
      });

      render(<RegistryPage />);
      const prevButton = screen.getByRole('button', { name: /previous page/i });
      const nextButton = screen.getByRole('button', { name: /next page/i });
      const page1Button = screen.getByRole('button', { name: /page 1/i });

      expect(prevButton).toHaveClass('min-h-[44px]', 'min-w-[44px]');
      expect(nextButton).toHaveClass('min-h-[44px]', 'min-w-[44px]');
      expect(page1Button).toHaveClass('min-h-[44px]', 'min-w-[44px]');
    });

    it('ensures ServiceCard vote and action buttons meet 44px minimum tap targets', () => {
      render(<ServiceCard service={mockService} />);
      const upvoteBtn = screen.getByRole('button', { name: /upvote service/i });
      const downvoteBtn = screen.getByRole('button', { name: /downvote service/i });
      const copyEndpointBtn = screen.getByRole('button', { name: /copy endpoint url/i });
      const copyAddrBtn = screen.getByRole('button', { name: /copy full address/i });
      const useEndpointBtn = screen.getByRole('button', { name: /use endpoint/i });

      expect(upvoteBtn).toHaveClass('min-h-[44px]', 'min-w-[44px]');
      expect(downvoteBtn).toHaveClass('min-h-[44px]', 'min-w-[44px]');
      expect(copyEndpointBtn).toHaveClass('min-h-[44px]', 'min-w-[44px]');
      expect(copyAddrBtn).toHaveClass('min-h-[44px]', 'min-w-[44px]');
      expect(useEndpointBtn).toHaveClass('min-h-[44px]');
    });

    it('ensures error retry button meets 44px minimum tap target', () => {
      (useSWR as jest.Mock).mockReturnValue({
        data: [],
        isLoading: false,
        error: new Error('Network error'),
        mutate: jest.fn(),
      });

      render(<RegistryPage />);
      const retryBtn = screen.getByRole('button', { name: /retry/i });
      expect(retryBtn).toHaveClass('min-h-[44px]', 'min-w-[44px]');
    });
  });

  describe('Address truncation & full value available on demand', () => {
    it('truncates long provider address visually and exposes full value via title and aria-label', () => {
      render(<ServiceCard service={mockService} />);
      const providerLink = screen.getByRole('link', { name: new RegExp(`Provider address: ${mockService.provider}`, 'i') });

      expect(providerLink).toHaveTextContent('GA7QYN...VAAA');
      expect(providerLink).toHaveAttribute('title', mockService.provider);
      expect(providerLink).toHaveAttribute('href', expect.stringContaining(mockService.provider));
    });

    it('allows copying full provider address on demand with feedback', async () => {
      render(<ServiceCard service={mockService} />);
      const copyAddrBtn = screen.getByRole('button', { name: /copy full address/i });

      expect(copyAddrBtn).toHaveTextContent('Copy');
      fireEvent.click(copyAddrBtn);

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockService.provider);
      expect(await screen.findByText('Copied')).toBeInTheDocument();
    });

    it('truncates long endpoint and allows copying full endpoint URL', async () => {
      render(<ServiceCard service={mockService} />);
      const copyEndpointBtn = screen.getByRole('button', { name: /copy endpoint url/i });

      fireEvent.click(copyEndpointBtn);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockService.endpoint);
    });
  });

  describe('Small-viewport responsive container and layout classes', () => {
    it('applies responsive padding and stacking classes to prevent horizontal scroll at 320px', () => {
      const { container } = render(<RegistryPage />);
      const rootContainer = container.firstElementChild as HTMLElement;

      expect(rootContainer).toHaveClass('px-4', 'sm:px-6', 'w-full', 'max-w-6xl');
    });

    it('renders ServiceCard with min-w-0, max-w-full and overflow-hidden to prevent container overflow', () => {
      const { container } = render(<ServiceCard service={mockService} />);
      const card = container.firstElementChild as HTMLElement;

      expect(card).toHaveClass('min-w-0', 'max-w-full', 'overflow-hidden');
    });

    it('renders ServiceCardSkeleton with responsive padding and overflow containment', () => {
      const { container } = render(<ServiceCardSkeleton />);
      const skeletonCard = container.firstElementChild as HTMLElement;

      expect(skeletonCard).toHaveClass('p-4', 'sm:p-6', 'min-w-0', 'max-w-full', 'overflow-hidden');
    });
  });
});
