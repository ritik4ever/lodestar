import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import WalletConnect from '../components/WalletConnect';
import { useWallet } from '../components/WalletContext';

jest.mock('../components/WalletContext', () => ({
  useWallet: jest.fn(),
}));

jest.mock('../components/WalletPickerModal', () => {
  return function MockModal({ onClose }: { onClose: () => void }) {
    return <div data-testid="picker-modal"><button onClick={onClose}>Close</button></div>;
  };
});

describe('WalletConnect', () => {
  const mockDisconnect = jest.fn();
  const mockRefreshState = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockWallet(overrides: Partial<ReturnType<typeof useWallet>> = {}) {
    (useWallet as jest.Mock).mockReturnValue({
      status: 'not-connected',
      address: '',
      balance: '',
      walletError: null,
      disconnect: mockDisconnect,
      refreshState: mockRefreshState,
      ...overrides,
    });
  }

  // ── Connected state ──────────────────────────────────────────────

  it('shows connect button when not connected', () => {
    mockWallet();
    render(<WalletConnect />);
    expect(screen.getByText('Connect Wallet')).toBeInTheDocument();
  });

  it('shows address and disconnect button when connected', () => {
    mockWallet({
      status: 'connected',
      address: 'GABCDEFGHIJKLMNOP',
      balance: '100.0000',
    });

    render(<WalletConnect />);
    expect(screen.getByText('GABC...MNOP')).toBeInTheDocument();
    expect(screen.getByText('100.0000 USDC')).toBeInTheDocument();
  });

  it('calls disconnect when disconnect button is clicked', () => {
    mockWallet({
      status: 'connected',
      address: 'GABCDEFGHIJKLMNOP',
      balance: '100.0000',
    });

    render(<WalletConnect />);
    fireEvent.click(screen.getByLabelText('Disconnect wallet'));
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it('opens wallet picker modal on connect button click', () => {
    mockWallet();
    render(<WalletConnect />);
    fireEvent.click(screen.getByText('Connect Wallet'));
    expect(screen.getByTestId('picker-modal')).toBeInTheDocument();
  });

  // ── Not-installed state ──────────────────────────────────────────

  it('shows install prompt when Freighter is not installed', () => {
    mockWallet({
      status: 'not-installed',
      walletError: {
        type: 'not-installed',
        message: 'Freighter extension is not installed.',
      },
    });

    render(<WalletConnect />);
    expect(screen.getByText('Install Freighter')).toBeInTheDocument();
  });

  it('install link points to freighter.app', () => {
    mockWallet({
      status: 'not-installed',
      walletError: {
        type: 'not-installed',
        message: 'Freighter extension is not installed.',
      },
    });

    render(<WalletConnect />);
    const link = screen.getByText('Install Freighter').closest('a');
    expect(link).toHaveAttribute('href', 'https://www.freighter.app');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('shows refresh button in not-installed state and calls refreshState', () => {
    mockWallet({
      status: 'not-installed',
      walletError: {
        type: 'not-installed',
        message: 'Freighter extension is not installed.',
      },
    });

    render(<WalletConnect />);
    const refreshBtn = screen.getByTitle('Re-check for Freighter');
    fireEvent.click(refreshBtn);
    expect(mockRefreshState).toHaveBeenCalledTimes(1);
  });

  // ── Locked state ─────────────────────────────────────────────────

  it('shows unlock prompt when Freighter is locked', () => {
    mockWallet({
      status: 'locked',
      walletError: {
        type: 'locked',
        message: 'Freighter is locked. Please unlock the extension to continue.',
      },
    });

    render(<WalletConnect />);
    expect(screen.getByText('Unlock Freighter')).toBeInTheDocument();
  });

  it('shows refresh button in locked state and calls refreshState', () => {
    mockWallet({
      status: 'locked',
      walletError: {
        type: 'locked',
        message: 'Freighter is locked. Please unlock the extension to continue.',
      },
    });

    render(<WalletConnect />);
    const refreshBtn = screen.getByTitle('Re-check Freighter state');
    fireEvent.click(refreshBtn);
    expect(mockRefreshState).toHaveBeenCalledTimes(1);
  });

  // ── Wrong-network state ──────────────────────────────────────────

  it('shows wrong network warning naming both networks', () => {
    mockWallet({
      status: 'wrong-network',
      walletError: {
        type: 'wrong-network',
        message: 'Freighter is connected to Mainnet but Lodestar requires Testnet.',
        currentNetwork: 'Mainnet',
        requiredNetwork: 'Testnet',
      },
    });

    render(<WalletConnect />);
    // Should show both current and required network names
    expect(screen.getByText('Mainnet')).toBeInTheDocument();
    expect(screen.getByText('Testnet')).toBeInTheDocument();
  });

  it('wrong network state shows both current and required network', () => {
    mockWallet({
      status: 'wrong-network',
      walletError: {
        type: 'wrong-network',
        message: 'Freighter is connected to Mainnet but Lodestar requires Testnet.',
        currentNetwork: 'Mainnet',
        requiredNetwork: 'Testnet',
      },
    });

    render(<WalletConnect />);
    const mainnet = screen.getByText('Mainnet');
    const testnet = screen.getByText('Testnet');
    expect(mainnet).toBeInTheDocument();
    expect(testnet).toBeInTheDocument();
  });

  it('shows refresh button in wrong-network state and calls refreshState', () => {
    mockWallet({
      status: 'wrong-network',
      walletError: {
        type: 'wrong-network',
        message: 'Freighter is connected to Mainnet but Lodestar requires Testnet.',
        currentNetwork: 'Mainnet',
        requiredNetwork: 'Testnet',
      },
    });

    render(<WalletConnect />);
    const refreshBtn = screen.getByTitle('Re-check network');
    fireEvent.click(refreshBtn);
    expect(mockRefreshState).toHaveBeenCalledTimes(1);
  });
});
