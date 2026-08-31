import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ServiceCard from '../components/ServiceCard';
import { submitReputation } from '../lib/contract';
import type { ReputationResponse } from '../lib/types';

jest.mock('../lib/contract', () => ({
  submitReputation: jest.fn(),
}));

const mockSubmit = submitReputation as jest.MockedFunction<typeof submitReputation>;

const SERVICE = {
  id: 7,
  name: 'Forecast API',
  description: 'Weather data for agents',
  endpoint: 'https://example.com/weather',
  price_usdc: '1.00',
  category: 'weather' as const,
  provider: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF',
  reputation: 2,
  active: true,
  registered_at: 123456,
};

// A promise the test resolves/rejects manually, so the pending state can be
// asserted before the vote settles.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderCard() {
  return render(<ServiceCard service={SERVICE} />);
}

describe('ServiceCard optimistic reputation voting (#837)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reflects the vote immediately with a pending state and disables the controls', () => {
    const vote = deferred<ReputationResponse>();
    mockSubmit.mockReturnValue(vote.promise);

    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Vote up' }));

    // The optimistic value is visible right away — no waiting on Soroban.
    expect(screen.getByText('+3')).toBeInTheDocument();
    // Pending state is communicated.
    expect(screen.getByRole('status')).toHaveTextContent('Casting up vote');
    // Controls are disabled while pending.
    expect(screen.getByRole('button', { name: 'Vote up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Vote down' })).toBeDisabled();
    // Exactly one vote request was fired.
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(mockSubmit).toHaveBeenCalledWith(SERVICE.id, true);
  });

  it('reconciles the optimistic value with the on-chain result on success', async () => {
    const vote = deferred<ReputationResponse>();
    mockSubmit.mockReturnValue(vote.promise);

    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Vote up' }));
    expect(screen.getByText('+3')).toBeInTheDocument();

    await act(async () => {
      vote.resolve({ success: true, newReputation: 4 });
    });

    // Server-confirmed value replaces the optimistic one.
    await waitFor(() => expect(screen.getByText('+4')).toBeInTheDocument());
    // Pending state clears and controls re-enable.
    await waitFor(() =>
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Vote up' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Vote down' })).toBeEnabled();
    // No error shown.
    expect(screen.queryByText(/vote/i)).not.toBeInTheDocument();
  });

  it('rolls back the optimistic vote and explains the failure', async () => {
    const vote = deferred<ReputationResponse>();
    mockSubmit.mockReturnValue(vote.promise);

    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Vote up' }));
    expect(screen.getByText('+3')).toBeInTheDocument();

    await act(async () => {
      vote.reject(new Error('Vote cooldown active — try again later'));
    });

    // Rolled back to the previous value.
    await waitFor(() => expect(screen.getByText('+2')).toBeInTheDocument());
    // The explanation from the backend is shown.
    expect(
      screen.getByText('Vote cooldown active — try again later')
    ).toBeInTheDocument();
    // Controls re-enable.
    expect(screen.getByRole('button', { name: 'Vote up' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Vote down' })).toBeEnabled();
  });

  it('falls back to a generic explanation when the error is not an Error', async () => {
    const vote = deferred<ReputationResponse>();
    mockSubmit.mockReturnValue(vote.promise);

    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Vote up' }));

    await act(async () => {
      vote.reject('boom');
    });

    await waitFor(() =>
      expect(
        screen.getByText('Vote failed — reputation unchanged.')
      ).toBeInTheDocument()
    );
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('ignores further clicks while a vote is pending', () => {
    const vote = deferred<ReputationResponse>();
    mockSubmit.mockReturnValue(vote.promise);

    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Vote up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Vote down' }));
    fireEvent.click(screen.getByRole('button', { name: 'Vote up' }));

    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });

  it('reflects a down vote immediately too', () => {
    const vote = deferred<ReputationResponse>();
    mockSubmit.mockReturnValue(vote.promise);

    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Vote down' }));

    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Casting down vote');
    expect(mockSubmit).toHaveBeenCalledWith(SERVICE.id, false);
  });
});
