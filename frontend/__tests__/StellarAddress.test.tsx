import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import StellarAddress from '../components/StellarAddress';

describe('StellarAddress Component', () => {
  const mockAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWFL';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders truncated address correctly', () => {
    render(<StellarAddress address={mockAddress} />);
    
    expect(screen.getByText('GAAAAA...AWFL')).toBeInTheDocument();
  });

  it('provides the correct explorer link', () => {
    render(<StellarAddress address={mockAddress} />);
    
    const link = screen.getByRole('link', { name: /view account/i });
    expect(link).toHaveAttribute('href', `https://stellar.expert/explorer/testnet/account/${mockAddress}`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('provides the full address for screen readers and tooltips', () => {
    render(<StellarAddress address={mockAddress} />);
    
    const srOnlySpan = screen.getByText(`Stellar address: ${mockAddress}`);
    expect(srOnlySpan).toBeInTheDocument();
    expect(srOnlySpan).toHaveClass('sr-only');

    expect(screen.getByText(mockAddress)).toBeInTheDocument();
  });

  it('supports custom classNames', () => {
    const { container } = render(<StellarAddress address={mockAddress} className="test-custom-class" />);
    
    expect(container.firstChild).toHaveClass('test-custom-class');
  });

  it('handles clipboard copy with visual confirmation and timer reset', async () => {
    jest.useFakeTimers();
    
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<StellarAddress address={mockAddress} />);
    
    const copyButton = screen.getByRole('button', { name: /copy stellar address/i });
    expect(screen.queryByText('Copied')).not.toBeInTheDocument();

    fireEvent.click(copyButton);

    expect(writeTextMock).toHaveBeenCalledWith(mockAddress);

    // Flush clipboard writeText microtasks
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('Copied')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1500);
    });

    expect(screen.queryByText('Copied')).not.toBeInTheDocument();
    
    jest.useRealTimers();
  });

  it('returns null if no address is provided', () => {
    const { container } = render(<StellarAddress address="" />);
    expect(container.firstChild).toBeNull();
  });
});
