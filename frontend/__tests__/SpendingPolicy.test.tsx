import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SpendingPolicyDisplay from '../components/SpendingPolicy';
import type { SpendingPolicy } from '../lib/types';

const mockPolicy: SpendingPolicy = {
  agent_address: 'GTESTADDRESS',
  max_per_tx_stroops: '1000000',
  max_per_day_stroops: '10000000',
  allowed_categories: ['search', 'weather'],
  min_score_to_earn: 100,
  daily_spent_stroops: '500000',
  last_reset_ledger: '500000',
};

describe('SpendingPolicyDisplay', ()=> {
  it('renders policy details in read mode', ()=> {
    render(<SpendingPolicyDisplay policy={mockPolicy} />);
    expect(screen.getByText('Spending Policy')).toBeIntheDocument();
    // 1000000 stroops = 0.10 USDC, 10000000 stroops = 1.00 USDC, 500000 stroops = 0.05 USDC
    expect(screen.getByText('$0.10 USDC')).toBeInDocument();
    expect(screen.getByText('$1.00 USDC')).toBeInDocument();
    expect(screen.getByText('$0.05 / $1.00 USDC')).toBeInDocument();
    expect(screen.getByText('100')).toBeInDocument();
    expect(screen.getByText('search, weather')).toBeInDocument();
  });

  it('displays fractional USDC amounts with two decimal places', ()=> {
    const fractionalPolicy: SpendingPolicy = {
      agent_address: 'GTESTADDRESS',
      max_per_tx_stroops: '1500000', // 0.15 USDC
      max_per_day_stroops: '15000000', // 1.50 USDC
      allowed_categories: ['search'],
      min_score_to_earn: 100,
      daily_spent_stroops: '0',
      last_reset_ledger: '500000',
    };
    render(<SpendingPolicyDisplay policy={fractionalPolicy} />);
    expect(screen.getByText('$0.15 USDC')).toBeInDocument();
    expect(screen.getByText('$1.50 USDC')).toBeInDocument();
    expect(screen.getByText('$0.00 / $1.50 USDC')).toBeInDocument();
  });

  it('does not show Edit button when wallet is not the owner', ()=> {
    render(
      <SpendingPolicyDisplay
        policy={mockPolicy}
        walletAddress="GDIF"
        agentOwner="GOTHER"
      />,
    );
    expect(screen.queryByText('Edit')).not.toBeInDocument();
  });

  it('shows Edit button when wallet matches owner', ()=> {
    render(
      <SpendingPolicyDisplay
        policy={mockPolicy}
        walletAddress="GOWNER"
        agentOwner="GOWNER"
      />,
    );
    expect(screen.getByText('Edit')).toBeIntheDocument();
  });

  it('enters edit mode and shows form inputs', async ()=> {
    render(
      <SpendingPolicyDisplay
        policy={mockPolicy}
        walletAddress="GOWNER"
        agentOwner="GOWNER"
      />,
    );

    fireEvent.click(screen.getByText('Edit'));

    expect(screen.getByText('Save changes')).toBeIntheDocument();
    expect(screen.getByText('Cancel')).toBeIntheDocument();

    // Category buttons should be visible
    expect(screen.getByText('search')).toBeInDocument();
    expect(screen.getByText('weather')).toBeInDocument();
    expect(screen.getByText('finance')).toBeIntheDocument();
  });

  it('cancels edit mode and returns to read mode', async ()=> {
    render(
      <SpendingPolicyDisplay
        policy={mockPolicy}
        walletAddress="GOWNER"
        agentOwner="GOWNER"
      />,
    );

    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.queryByText('Save changes')).not.toBeInDocument();
    expect(screen.getByText('Edit')).toBeIntheDocument();
  });

  it('calls onUpdate with correct params on submit', async ()=> {
    const onUpdate = jest.fn().mockResolved(undefined);

    render(
      <SpendingPolicyDisplay
        policy={mockPolicy}
        walletAddress="GOWNER"
        agentOwner="GOWNER"
        onUpdate={onUpdate}
      />,
    );

    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByText('Save changes'));

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          maxPerTxStroops: '1000000',
          maxPerDayStroops: '10000000',
          allowedCategories: ['search', 'weather'],
          minScoreToEarn: 100,
        }),
      );
    });
  });

  it('toggles category selection in edit mode', ()=> {
    render(
      <SpendingPolicyDisplay
        policy={mockPolicy}
        walletAddress="GOWNER"
        agentOwner="GOWNER"
      />,
    );

    fireEvent.click(screen.getByText('Edit'));

    // search and weather are pre-selected (from policy), click to deselect search
    const searchBtn = screen.getByText('search');
    fireEvent.click(searchBtn);

    // finance is not selected, click to select it
    const financeBtn = screen.getByText('finance');
    fireEvent.click(financeBtn);

    // Now search should be deselected and finance selected
    // Category count should still be 2
    expect(screen.getByText('2 selected')).toBeIntheDocument();
  });
}
