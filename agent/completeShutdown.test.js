import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Hoisted logger spies
const { logInfo, logWarn, logError, logDebug } = vi.hoisted(() => ({
  logInfo:  vi.fn(),
  logWarn:  vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// Module mocks
vi.mock('dotenv/config', () => ({}));
vi.mock('pino', () => ({
  default: () => ({
    info: logInfo,
    warn: logWarn,
    error: logError,
    debug: logDebug,
  }),
}));

vi.mock('@stellar/stellar-sdk', () => ({
  default: {
    Keypair: {
      fromSecret: () => ({
        publicKey: () => 'GAGENTMOCKADDRESS0000000000000000000000000000000000000000000',
      }),
    },
  },
}));

vi.mock('@x402/core/client', () => ({
  x402Client: class { register() { return this; } },
  x402HTTPClient: class { encodePaymentSignatureHeader() { return {}; } },
}));
vi.mock('@x402/stellar', () => ({ createEd25519Signer: () => ({}) }));
vi.mock('@x402/stellar/exact/client', () => ({ ExactStellarScheme: class {} }));

// Set required env vars for module evaluation
process.env.AGENT_STELLAR_SECRET = 'STEST0000000000000000000000000000000000000000000000000000';
process.env.STELLAR_RPC_URL      = 'https://mock-rpc.example.com';
process.env.LODESTAR_API_URL     = 'http://localhost:9999';

const { completeShutdown, initiateShutdown } = await import('./agent.js');

describe('completeShutdown', () => {
  let exitSpy;
  let clearTimeoutSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
    clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('exit code resolution', () => {
    it('exits with code 0 when success is true', async () => {
      await completeShutdown(true, []);

      expect(exitSpy).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('exits with code 1 when success is false', async () => {
      await completeShutdown(false, []);

      expect(exitSpy).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it.each([
      { inputName: '1 (numeric 1 truthy)', input: 1, expectedExitCode: 0 },
      { inputName: '"true" (string truthy)', input: 'true', expectedExitCode: 0 },
      { inputName: '0 (numeric 0 falsy)', input: 0, expectedExitCode: 1 },
      { inputName: 'null (falsy)', input: null, expectedExitCode: 1 },
      { inputName: 'undefined (falsy)', input: undefined, expectedExitCode: 1 },
      { inputName: '"" (empty string falsy)', input: '', expectedExitCode: 1 },
      { inputName: 'NaN (falsy)', input: Number.NaN, expectedExitCode: 1 },
    ])('maps boundary value $inputName to exit code $expectedExitCode', async ({ input, expectedExitCode }) => {
      await completeShutdown(input, []);

      expect(exitSpy).toHaveBeenCalledWith(expectedExitCode);
    });
  });

  describe('structured event logging', () => {
    it('logs shutdown_complete event with success true and empty unresolved array', async () => {
      await completeShutdown(true, []);

      expect(logInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'shutdown_complete',
          success: true,
          unresolvedPayments: [],
        }),
        'Agent shutdown complete'
      );
    });

    it('logs shutdown_complete event with success false and unresolved payment list', async () => {
      const unresolved = [
        { category: 'weather', serviceId: 42, priceUsdc: '0.005' },
        { category: 'search', serviceId: 99, priceUsdc: '0.010' },
      ];

      await completeShutdown(false, unresolved);

      expect(logInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'shutdown_complete',
          success: false,
          unresolvedPayments: unresolved,
        }),
        'Agent shutdown complete'
      );
    });

    it.each([
      { description: 'empty list (0 items)', unresolved: [] },
      { description: 'single unresolved item (1 item)', unresolved: [{ serviceId: 1, priceUsdc: '0.001' }] },
      {
        description: 'multiple unresolved items (3 items)',
        unresolved: [
          { serviceId: 1, priceUsdc: '0.001' },
          { serviceId: 2, priceUsdc: '0.002' },
          { serviceId: 3, priceUsdc: '0.003' },
        ],
      },
      { description: 'null unresolved', unresolved: null },
      { description: 'undefined unresolved', unresolved: undefined },
      { description: 'numeric 0 unresolved', unresolved: 0 },
    ])('handles unresolved boundary: $description', async ({ unresolved }) => {
      await completeShutdown(true, unresolved);

      expect(logInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'shutdown_complete',
          unresolvedPayments: unresolved,
        }),
        'Agent shutdown complete'
      );
    });
  });

  describe('shutdown timer cleanup', () => {
    it('clears active shutdown timer when initiateShutdown was previously called', async () => {
      await initiateShutdown('SIGTERM');

      await completeShutdown(true, []);

      expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
    });

    it('handles shutdown cleanly when no timer is active', async () => {
      // Direct call without prior initiateShutdown
      await completeShutdown(true, []);

      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });

  describe('resource cleanup', () => {
    it('calls dispose and logs "Shutting down Lodestar Agent" before process.exit', async () => {
      const callOrder = [];
      logInfo.mockImplementation((arg) => {
        if (typeof arg === 'string') callOrder.push(arg);
      });
      exitSpy.mockImplementation(() => {
        callOrder.push('process.exit');
      });

      await completeShutdown(true, []);

      expect(callOrder).toContain('Shutting down Lodestar Agent');
      expect(callOrder).toContain('process.exit');
      expect(callOrder.indexOf('Shutting down Lodestar Agent')).toBeLessThan(
        callOrder.indexOf('process.exit')
      );
    });
  });
});
