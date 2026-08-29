import { render, waitFor } from '@testing-library/react';
import { axe } from 'jest-axe';
import ServiceDetailPage from '../app/services/[id]/page';
import { fetchServiceById } from '../lib/contract';

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: '1' }),
  useRouter: () => ({ refresh: jest.fn() }),
}));

jest.mock('next/link', () => {
  return function MockLink({ children, ...props }: any) {
    return <a {...props}>{children}</a>;
  };
});

jest.mock('../lib/contract', () => ({
  fetchServiceById: jest.fn(),
  submitReputation: jest.fn(),
}));

describe('Service detail page accessibility', () => {
  it('has no axe violations when a service is loaded', async () => {
    (fetchServiceById as jest.Mock).mockResolvedValue({
      id: 1,
      name: 'Forecast API',
      description: 'Weather data for agents',
      endpoint: 'https://example.com/weather',
      price_usdc: '1.00',
      category: 'weather',
      provider: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF',
      reputation: 2,
      active: true,
      registered_at: 123456,
    });

    const { container } = render(<ServiceDetailPage />);

    await waitFor(() => {
      expect(container.querySelector('.card')).toBeInTheDocument();
    });

    expect(await axe(container)).toHaveNoViolations();
  });
});
