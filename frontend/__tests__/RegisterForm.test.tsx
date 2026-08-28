import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RegisterForm from '@/components/RegisterForm';

jest.mock('@/lib/contract', () => ({
  registerService: jest.fn(),
}));

import { registerService } from '@/lib/contract';

describe('RegisterForm validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (registerService as jest.Mock).mockResolvedValue({ txHash: 'test-hash', id: 1 });
  });

  it('shows error for name shorter than 3 characters', async () => {
    render(<RegisterForm walletAddress="GTESTADDRESS1234567890ABCDEFGHIJ" />);

    const nameInput = screen.getByLabelText(/service name/i);
    fireEvent.change(nameInput, { target: { value: 'ab' } });

    await waitFor(() => {
      expect(screen.getByText(/name must be 3–64 characters/i)).toBeInTheDocument();
    });
  });

  it('shows error for name longer than 64 characters', async () => {
    render(<RegisterForm walletAddress="GTESTADDRESS1234567890ABCDEFGHIJ" />);

    const nameInput = screen.getByLabelText(/service name/i);
    fireEvent.change(nameInput, { target: { value: 'a'.repeat(65) } });

    await waitFor(() => {
      expect(screen.getByText(/name must be 3–64 characters/i)).toBeInTheDocument();
    });
  });

  it('accepts valid name between 3 and 64 characters', async () => {
    render(<RegisterForm walletAddress="GTESTADDRESS1234567890ABCDEFGHIJ" />);

    const nameInput = screen.getByLabelText(/service name/i);
    fireEvent.change(nameInput, { target: { value: 'Valid Name' } });

    await waitFor(() => {
      expect(screen.queryByText(/name must be 3–64 characters/i)).not.toBeInTheDocument();
    });
  });

  it('accepts name at the 64 character boundary', async () => {
    render(<RegisterForm walletAddress="GTESTADDRESS1234567890ABCDEFGHIJ" />);

    const nameInput = screen.getByLabelText(/service name/i);
    fireEvent.change(nameInput, { target: { value: 'a'.repeat(64) } });

    await waitFor(() => {
      expect(screen.queryByText(/name must be 3–64 characters/i)).not.toBeInTheDocument();
    });
  });

  it('shows error for description shorter than 10 characters', async () => {
    render(<RegisterForm walletAddress="GTESTADDRESS1234567890ABCDEFGHIJ" />);

    const descInput = screen.getByLabelText(/description/i);
    fireEvent.change(descInput, { target: { value: 'short' } });

    await waitFor(() => {
      expect(screen.getByText(/description must be 10–256 characters/i)).toBeInTheDocument();
    });
  });

  it('shows error for description longer than 256 characters', async () => {
    render(<RegisterForm walletAddress="GTESTADDRESS1234567890ABCDEFGHIJ" />);

    const descInput = screen.getByLabelText(/description/i);
    fireEvent.change(descInput, { target: { value: 'a'.repeat(257) } });

    await waitFor(() => {
      expect(screen.getByText(/description must be 10–256 characters/i)).toBeInTheDocument();
    });
  });

  it('accepts valid description between 10 and 256 characters', async () => {
    render(<RegisterForm walletAddress="GTESTADDRESS1234567890ABCDEFGHIJ" />);

    const descInput = screen.getByLabelText(/description/i);
    fireEvent.change(descInput, { target: { value: 'Valid description text' } });

    await waitFor(() => {
      expect(screen.queryByText(/description must be 10–256 characters/i)).not.toBeInTheDocument();
    });
  });

  it('accepts description at the 256 character boundary', async () => {
    render(<RegisterForm walletAddress="GTESTADDRESS1234567890ABCDEFGHIJ" />);

    const descInput = screen.getByLabelText(/description/i);
    fireEvent.change(descInput, { target: { value: 'a'.repeat(256) } });

    await waitFor(() => {
      expect(screen.queryByText(/description must be 10–256 characters/i)).not.toBeInTheDocument();
    });
  });

  it('shows error for endpoint not starting with https://', async () => {
    render(<RegisterForm walletAddress="GTESTADDRESS1234567890ABCDEFGHIJ" />);

    const endpointInput = screen.getByLabelText(/endpoint url/i);
    fireEvent.change(endpointInput, { target: { value: 'http://example.com' } });

    await waitFor(() => {
      expect(screen.getByText(/endpoint must be a valid https:\/\/ url/i)).toBeInTheDocument();
    });
  });

  it('shows error for a malformed https URL', async () => {
    render(<RegisterForm walletAddress="GTESTADDRESS1234567890ABCDEFGHIJ" />);

    const endpointInput = screen.getByLabelText(/endpoint url/i);
    fireEvent.change(endpointInput, { target: { value: 'https://' } });

    await waitFor(() => {
      expect(screen.getByText(/endpoint must be a valid https:\/\/ url/i)).toBeInTheDocument();
    });
  });

  it('shows error for a plain string that is not a URL', async () => {
    render(<RegisterForm walletAddress="GTESTADDRESS1234567890ABCDEFGHIJ" />);

    const endpointInput = screen.getByLabelText(/endpoint url/i);
    fireEvent.change(endpointInput, { target: { value: 'not a url' } });

    await waitFor(() => {
      expect(screen.getByText(/endpoint must be a valid https:\/\/ url/i)).toBeInTheDocument();
    });
  });

  it('accepts valid https endpoint', async () => {
    render(<RegisterForm walletAddress="GTESTADDRESS1234567890ABCDEFGHIJ" />);

    const endpointInput = screen.getByLabelText(/endpoint url/i);
    fireEvent.change(endpointInput, { target: { value: 'https://example.com/api' } });

    await waitFor(() => {
      expect(screen.queryByText(/endpoint must be a valid https:\/\/ url/i)).not.toBeInTheDocument();
    });
  });

  it('shows error for price with leading zeros (except single zero)', async () => {
    render(<RegisterForm walletAddress="GTESTADDRESS1234567890ABCDEFGHIJ" />);

    const priceInput = screen.getByLabelText(/price \(usdc\)/i);
    fireEvent.change(priceInput, { target: { value: '01.5' } });

    await waitFor(() => {
      expect(screen.getByText(/invalid price format/i)).toBeInTheDocument();
    });
  });

  it('shows error for price less than 0.0001', async () => {
    render(<RegisterForm walletAddress="GTESTADDRESS1234567890ABCDEFGHIJ" />);

    const priceInput = screen.getByLabelText(/price \(usdc\)/i);
    fireEvent.change(priceInput, { target: { value: '0.00001' } });

    await waitFor(() => {
      expect(screen.getByText(/price must be at least 0.0001 usdc/i)).toBeInTheDocument();
    });
  });

  it('accepts valid price of 0.0001', async () => {
    render(<RegisterForm walletAddress="GTESTADDRESS1234567890ABCDEFGHIJ" />);

    const priceInput = screen.getByLabelText(/price \(usdc\)/i);
    fireEvent.change(priceInput, { target: { value: '0.0001' } });

    await waitFor(() => {
      expect(screen.queryByText(/price must be at least 0.0001 usdc/i)).not.toBeInTheDocument();
    });
  });

  it('accepts valid price greater than 0.0001', async () => {
    render(<RegisterForm walletAddress="GTESTADDRESS1234567890ABCDEFGHIJ" />);

    const priceInput = screen.getByLabelText(/price \(usdc\)/i);
    fireEvent.change(priceInput, { target: { value: '1.5' } });

    await waitFor(() => {
      expect(screen.queryByText(/invalid price format/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/price must be at least 0.0001 usdc/i)).not.toBeInTheDocument();
    });
  });

  it('shows error for price with trailing whitespace', async () => {
    render(<RegisterForm walletAddress="GTESTADDRESS1234567890ABCDEFGHIJ" />);

    const priceInput = screen.getByLabelText(/price \(usdc\)/i);
    // Start from a valid value so the number input actually registers a
    // change; browsers normalize a trailing-space value on a number input
    // back to "" (same as untouched), which would otherwise suppress the
    // change event entirely.
    fireEvent.change(priceInput, { target: { value: '1.5' } });
    fireEvent.change(priceInput, { target: { value: '1.5 ' } });

    await waitFor(() => {
      expect(screen.getByText(/invalid price format/i)).toBeInTheDocument();
    });
  });

  it('disables submit button when form has validation errors', async () => {
    render(<RegisterForm walletAddress="GTESTADDRESS1234567890ABCDEFGHIJ" />);

    const submitButton = screen.getByRole('button', { name: /register service/i });
    expect(submitButton).toBeDisabled();

    const nameInput = screen.getByLabelText(/service name/i);
    fireEvent.change(nameInput, { target: { value: 'Valid Name' } });

    await waitFor(() => {
      expect(submitButton).toBeDisabled();
    });
  });

  it('enables submit button when form is valid', async () => {
    render(<RegisterForm walletAddress="GTESTADDRESS1234567890ABCDEFGHIJ" />);

    const nameInput = screen.getByLabelText(/service name/i);
    const descInput = screen.getByLabelText(/description/i);
    const endpointInput = screen.getByLabelText(/endpoint url/i);
    const priceInput = screen.getByLabelText(/price \(usdc\)/i);

    fireEvent.change(nameInput, { target: { value: 'Valid Service Name' } });
    fireEvent.change(descInput, { target: { value: 'Valid service description text' } });
    fireEvent.change(endpointInput, { target: { value: 'https://example.com/api' } });
    fireEvent.change(priceInput, { target: { value: '0.001' } });

    await waitFor(() => {
      const submitButton = screen.getByRole('button', { name: /register service/i });
      expect(submitButton).not.toBeDisabled();
    });
  });

  it('validates on field change in real-time', async () => {
    render(<RegisterForm walletAddress="GTESTADDRESS1234567890ABCDEFGHIJ" />);

    const nameInput = screen.getByLabelText(/service name/i);

    // Fix the value first so there's no pre-existing error to confuse the assertion
    fireEvent.change(nameInput, { target: { value: 'Valid Name' } });
    await waitFor(() => {
      expect(screen.queryByText(/name must be 3–64 characters/i)).not.toBeInTheDocument();
    });

    // Type invalid value
    fireEvent.change(nameInput, { target: { value: 'ab' } });

    // Error appears immediately
    await waitFor(() => {
      expect(screen.getByText(/name must be 3–64 characters/i)).toBeInTheDocument();
    });

    // Fix the value
    fireEvent.change(nameInput, { target: { value: 'Valid Name' } });

    // Error disappears
    await waitFor(() => {
      expect(screen.queryByText(/name must be 3–64 characters/i)).not.toBeInTheDocument();
    });
  });

  it('trims whitespace when validating name', async () => {
    render(<RegisterForm walletAddress="GTESTADDRESS1234567890ABCDEFGHIJ" />);

    const nameInput = screen.getByLabelText(/service name/i);
    fireEvent.change(nameInput, { target: { value: '  ab  ' } });

    await waitFor(() => {
      expect(screen.getByText(/name must be 3–64 characters/i)).toBeInTheDocument();
    });
  });

  it('trims whitespace when validating description', async () => {
    render(<RegisterForm walletAddress="GTESTADDRESS1234567890ABCDEFGHIJ" />);

    const descInput = screen.getByLabelText(/description/i);
    fireEvent.change(descInput, { target: { value: '  short  ' } });

    await waitFor(() => {
      expect(screen.getByText(/description must be 10–256 characters/i)).toBeInTheDocument();
    });
  });

  it('rejects a non-https URL scheme such as javascript:', async () => {
    render(<RegisterForm walletAddress="GTESTADDRESS1234567890ABCDEFGHIJ" />);

    const endpointInput = screen.getByLabelText(/endpoint url/i);
    fireEvent.change(endpointInput, { target: { value: 'javascript:alert(1)' } });

    await waitFor(() => {
      expect(screen.getByText(/endpoint must be a valid https:\/\/ url/i)).toBeInTheDocument();
    });
  });
});
