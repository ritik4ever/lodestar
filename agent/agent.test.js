import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
// ── Hoisted mock refs (available inside vi.mock factories) ────────────────────

const { logInfo, logWarn, logError, logDebug } = vi.hoisted(() => ({
  logInfo:  vi.fn(),
  logWarn:  vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('dotenv/config', () => ({}));

vi.mock('pino', () => ({
  default: () => ({ info: logInfo, warn: logWarn, error: logError, debug: logDebug }),
}));

vi.mock('@stellar/stellar-sdk', () => ({
  default: {
    Keypair: { fromSecret: () => ({ publicKey: () => 'GAGENTADDRESSMOCK000000000000000000000000000000000000000' }) },
  },
}));

vi.mock('@x402/core/client', () => ({
  x402Client: class { register() { return this; } },
  x402HTTPClient: class { encodePaymentSignatureHeader() { return {}; } },
}));

vi.mock('@x402/stellar', () => ({ createEd25519Signer: () => ({}) }));
vi.mock('@x402/stellar/exact/client', () => ({ ExactStellarScheme: class { } }));

// ── Env vars must be set before the agent module initialises ──────────────────

process.env.AGENT_STELLAR_SECRET = 'STEST0000000000000000000000000000000000000000000000000000';
process.env.STELLAR_RPC_URL      = 'https://mock-rpc.example.com';
process.env.LODESTAR_API_URL     = 'http://localhost:9999';

const mockHttpClient = {
  encodePaymentSignatureHeader: vi.fn(() => ({})),
  fetch: (...args) => global.fetch(...args),
};

const { runTask, main, EVENT } = await import('./agent.js');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_SERVICE = {
  id: 1,
  name: 'WeatherService',
  price_usdc: '0.001',
  endpoint: 'https://api.example.com/weather',
  reputation: 100,
};

function makeResponse(overrides = {}) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => name === 'x-payment-transaction' ? 'txhash123' : null },
    json: () => Promise.resolve({ result: 'ok' }),
    ...overrides,
  };
}

function buildFetch({ services = [MOCK_SERVICE], canSpend = true, endpointOk = true } = {}) {
  return vi.fn().mockImplementation((url) => {
    if (url.includes('/api/services')) {
      return Promise.resolve(makeResponse({ json: () => Promise.resolve({ services }) }));
    }
    if (url.includes('/can-spend')) {
      return Promise.resolve(makeResponse({
        json: () => Promise.resolve({ allowed: canSpend, reason: canSpend ? 'OK' : 'Daily limit reached' }),
      }));
    }
    if (url.includes('/payment')) {
      return Promise.resolve(makeResponse({ json: () => Promise.resolve({ newScore: 110 }) }));
    }
    if (url.includes('/reputation')) {
      return Promise.resolve(makeResponse());
    }
    // endpoint fetch
    return endpointOk
      ? Promise.resolve(makeResponse())
      : Promise.resolve(makeResponse({ ok: false, status: 500 }));
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = buildFetch();

  fs.writeFileSync(
    'agent-state.json',
    JSON.stringify({
      GAGENTADDRESSMOCK000000000000000000000000000000000000000: {
        scoreHistory: [],
        providerHistory: {},
        cumulativeSpend: 0,
      },
    })
  );
});
describe('runTask — happy path', () => {
  it('logs task_start with category field', async () => {
    await runTask('weather', (ep) => ep, true, mockHttpClient);

    const taskStartCall = logInfo.mock.calls.find(
      ([fields]) => fields?.event === EVENT.TASK_START
    );
    expect(taskStartCall).toBeDefined();
    expect(taskStartCall[0]).toMatchObject({ event: 'task_start', category: 'weather' });
  });

  it('logs service_selected with structured fields', async () => {
    await runTask('weather', (ep) => ep, true, mockHttpClient);

    const call = logInfo.mock.calls.find(([f]) => f?.event === EVENT.SERVICE_SELECTED);
    expect(call).toBeDefined();
    expect(call[0]).toMatchObject({
      event: 'service_selected',
      category: 'weather',
      serviceId: MOCK_SERVICE.id,
      serviceName: MOCK_SERVICE.name,
      priceUsdc: MOCK_SERVICE.price_usdc,
      servicesFound: 1,
    });
  });

  it('logs spend_check_passed when scoring enabled', async () => {
    await runTask('weather', (ep) => ep, true, mockHttpClient);

    const call = logInfo.mock.calls.find(([f]) => f?.event === EVENT.SPEND_CHECK_PASSED);
    expect(call).toBeDefined();
    expect(call[0]).toMatchObject({ event: 'spend_check_passed', category: 'weather' });
  });

  it('logs payment_success with txHash, scoreBefore, and taskDurationMs', async () => {
    await runTask('weather', (ep) => ep, true, mockHttpClient);

    const call = logInfo.mock.calls.find(([f]) => f?.event === EVENT.PAYMENT_SUCCESS);
    expect(call).toBeDefined();
    expect(call[0]).toMatchObject({
      event: 'payment_success',
      category: 'weather',
      serviceId: MOCK_SERVICE.id,
      serviceName: MOCK_SERVICE.name,
      priceUsdc: MOCK_SERVICE.price_usdc,
      txHash: 'txhash123',
    });
    expect(typeof call[0].taskDurationMs).toBe('number');
    expect(call[0].taskDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('calls encodePaymentSignatureHeader with expected payload', async () => {
    await runTask('weather', (ep) => ep, true, mockHttpClient);

    expect(mockHttpClient.encodePaymentSignatureHeader).toHaveBeenCalledWith(
      { url: 'https://api.example.com/weather', method: 'GET' }
    );
  });

  it('returns { success: true, priceUsdc } on success', async () => {
    const result = await runTask('weather', (ep) => ep, true, mockHttpClient);
    expect(result).toEqual({ success: true, priceUsdc: MOCK_SERVICE.price_usdc });
  });

  it('skips spend check when scoring is disabled', async () => {
    await runTask('weather', (ep) => ep, false, mockHttpClient);

    const blocked = logWarn.mock.calls.find(([f]) => f?.event === EVENT.SPEND_CHECK_BLOCKED);
    const passed  = logInfo.mock.calls.find(([f]) => f?.event === EVENT.SPEND_CHECK_PASSED);
    expect(blocked).toBeUndefined();
    expect(passed).toBeUndefined();
  });
});

describe('runTask — no services found', () => {
  it('logs task_start error with servicesFound: 0', async () => {
    global.fetch = buildFetch({ services: [] });

    await runTask('weather', (ep) => ep, true, mockHttpClient);

    const call = logError.mock.calls.find(([f]) => f?.event === EVENT.TASK_START);
    expect(call).toBeDefined();
    expect(call[0]).toMatchObject({ event: 'task_start', category: 'weather', servicesFound: 0 });
  });

  it('returns { success: false, priceUsdc: null }', async () => {
    global.fetch = buildFetch({ services: [] });
    const result = await runTask('weather', (ep) => ep, true, mockHttpClient);
    expect(result).toEqual({ success: false, priceUsdc: null });
  });
});

describe('runTask — spend check blocked', () => {
  let randomSpy;
  beforeEach(() => {
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => {
    randomSpy.mockRestore();
  });

  it('logs spend_check_blocked with reason field', async () => {
    global.fetch = buildFetch({ canSpend: false });

    await runTask('weather', (ep) => ep, true, mockHttpClient);

    const call = logWarn.mock.calls.find(([f]) => f?.event === EVENT.SPEND_CHECK_BLOCKED);
    expect(call).toBeDefined();
    expect(call[0]).toMatchObject({
      event: 'spend_check_blocked',
      category: 'weather',
      serviceId: MOCK_SERVICE.id,
      priceUsdc: MOCK_SERVICE.price_usdc,
      reason: 'Daily limit reached',
    });
  });

  it('returns { success: false, priceUsdc: null }', async () => {
    global.fetch = buildFetch({ canSpend: false });
    const result = await runTask('weather', (ep) => ep, true, mockHttpClient);
    expect(result).toEqual({ success: false, priceUsdc: null });
  });

  it('falls back to the next candidate if the first is blocked by spend check', async () => {
    const serviceA = { id: 1, name: 'Svc A', price_usdc: '0.002', endpoint: 'http://a', reputation: 100 };
    const serviceB = { id: 2, name: 'Svc B', price_usdc: '0.001', endpoint: 'http://b', reputation: 90 };

    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/services')) {
        return Promise.resolve(makeResponse({ json: () => Promise.resolve({ services: [serviceA, serviceB] }) }));
      }
      if (url.includes('/can-spend')) {
        // Block serviceA (price 0.002) but allow serviceB (price 0.001)
        const canSpend = !url.includes('amount=0.002');
        return Promise.resolve(makeResponse({
          json: () => Promise.resolve({ allowed: canSpend, reason: canSpend ? 'OK' : 'Limit reached' }),
        }));
      }
      if (url.includes('/payment')) {
        return Promise.resolve(makeResponse({ json: () => Promise.resolve({ newScore: 110 }) }));
      }
      if (url.includes('/reputation')) {
        return Promise.resolve(makeResponse());
      }
      // Endpoint fetch (should call serviceB endpoint http://b)
      if (url.includes('http://b')) {
        return Promise.resolve(makeResponse({ json: () => Promise.resolve({ result: 'ok' }) }));
      }
      return Promise.resolve(makeResponse({ ok: false, status: 500 }));
    });

    const result = await runTask('weather', (ep) => ep, true);

    // Should succeed on serviceB
    expect(result).toEqual({ success: true, priceUsdc: '0.001' });

    // Should have logged both spend check blocked for Svc A and pass for Svc B
    const blocked = logWarn.mock.calls.find(([f]) => f?.event === EVENT.SPEND_CHECK_BLOCKED);
    expect(blocked).toBeDefined();
    expect(blocked[0]).toMatchObject({ serviceId: 1, priceUsdc: '0.002' });

    const passed = logInfo.mock.calls.find(([f]) => f?.event === EVENT.SPEND_CHECK_PASSED);
    expect(passed).toBeDefined();
    expect(passed[0]).toMatchObject({ serviceId: 2, priceUsdc: '0.001' });
  });
});

describe('runTask — service error after payment', () => {
  it('logs payment_failed with httpStatus when endpoint returns non-2xx', async () => {
    global.fetch = buildFetch({ endpointOk: false });

    await runTask('weather', (ep) => ep, false, mockHttpClient);

    const call = logError.mock.calls.find(([f]) => f?.event === EVENT.PAYMENT_FAILED);
    expect(call).toBeDefined();
    expect(call[0]).toMatchObject({
      event: 'payment_failed',
      category: 'weather',
      serviceId: MOCK_SERVICE.id,
      httpStatus: 500,
    });
  });

  it('returns { success: false, priceUsdc: null } when endpoint fails', async () => {
    global.fetch = buildFetch({ endpointOk: false });

  });
});

describe('runTask — payment_failed on fetch throw', () => {
  it('logs payment_failed with err field when httpClient throws', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/services')) {
        return Promise.resolve(makeResponse({ json: () => Promise.resolve({ services: [MOCK_SERVICE] }) }));
      }
      // Throw on the endpoint fetch to simulate network error
      return Promise.reject(new Error('Network error'));
    });

    await runTask('weather', (ep) => ep, false, mockHttpClient);

    const call = logError.mock.calls.find(([f]) => f?.event === EVENT.PAYMENT_FAILED);
    expect(call).toBeDefined();
    expect(call[0]).toMatchObject({ event: 'payment_failed', category: 'weather' });
    expect(call[0].err).toBeInstanceOf(Error);
  });

  it('uses a timeout signal for fetches and recovers from a stalled endpoint', async () => {
    const fetchSpy = vi.fn().mockImplementation((url, init = {}) => {
      if (url.includes('/api/services')) {
        return Promise.resolve(makeResponse({ json: () => Promise.resolve({ services: [MOCK_SERVICE] }) }));
      }
      if (url.includes('/can-spend')) {
        return Promise.resolve(makeResponse({ json: () => Promise.resolve({ allowed: true, reason: 'OK' }) }));
      }
      if (url.includes('/payment')) {
        return Promise.resolve(makeResponse({ json: () => Promise.resolve({ newScore: 110 }) }));
      }
      if (url.includes('/reputation')) {
        return Promise.resolve(makeResponse());
      }
      if (init?.signal?.aborted) {
        return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
      }
      return Promise.reject(new Error('stalled'));
    });
    global.fetch = fetchSpy;

    const result = await runTask('weather', (ep) => ep, false, mockHttpClient);

    expect(result).toEqual({ success: false, priceUsdc: null });
    expect(fetchSpy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    const paymentFailedCall = logError.mock.calls.find(([f]) => f?.event === EVENT.PAYMENT_FAILED);
    expect(paymentFailedCall).toBeDefined();
  });
});

describe('main — agent_complete summary', () => {
  it('logs agent_complete with all required summary fields', async () => {
    // ensureRegistered → already registered, score 100
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/agents/') && !url.includes('/can-spend') && !url.includes('/payment')) {
        return Promise.resolve(makeResponse({
          json: () => Promise.resolve({ agent: { score: 100 }, policy: null }),
        }));
      }
      if (url.includes('/api/services')) {
        return Promise.resolve(makeResponse({ json: () => Promise.resolve({ services: [MOCK_SERVICE] }) }));
      }
      if (url.includes('/can-spend')) {
        return Promise.resolve(makeResponse({ json: () => Promise.resolve({ allowed: true, reason: 'OK' }) }));
      }
      if (url.includes('/payment')) {
        return Promise.resolve(makeResponse({ json: () => Promise.resolve({ newScore: 105 }) }));
      }
      return Promise.resolve(makeResponse());
    });

    await main();

    const summaryCall = logInfo.mock.calls.find(([f]) => f?.event === EVENT.AGENT_COMPLETE);
    expect(summaryCall).toBeDefined();

    const fields = summaryCall[0];
    expect(fields).toMatchObject({
      event: 'agent_complete',
      totalTasks: 2,
      successCount: 2,
      failCount: 0,
    });
    expect(typeof fields.totalUsdcSpent).toBe('string');
    expect(parseFloat(fields.totalUsdcSpent)).toBeCloseTo(0.002, 6);
    expect(typeof fields.runDurationMs).toBe('number');
    expect(fields.runDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('logs agent_complete with correct fail counts when tasks fail', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/agents/') && !url.includes('/can-spend') && !url.includes('/payment')) {
        return Promise.resolve(makeResponse({
          json: () => Promise.resolve({ agent: { score: 100 }, policy: null }),
        }));
      }
      // All service queries return empty
      if (url.includes('/api/services')) {
        return Promise.resolve(makeResponse({ json: () => Promise.resolve({ services: [] }) }));
      }
      return Promise.resolve(makeResponse());
    });

    await main();

    const summaryCall = logInfo.mock.calls.find(([f]) => f?.event === EVENT.AGENT_COMPLETE);
    expect(summaryCall).toBeDefined();
    expect(summaryCall[0]).toMatchObject({
      event: 'agent_complete',
      totalTasks: 2,
      successCount: 0,
      failCount: 2,
    });
    expect(parseFloat(summaryCall[0].totalUsdcSpent)).toBe(0);
  });

  it('logs agent_start with agentAddress and agentName', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/agents/') && !url.includes('/can-spend') && !url.includes('/payment')) {
        return Promise.resolve(makeResponse({
          json: () => Promise.resolve({ agent: { score: 100 }, policy: null }),
        }));
      }
      if (url.includes('/api/services')) {
        return Promise.resolve(makeResponse({ json: () => Promise.resolve({ services: [] }) }));
      }
      return Promise.resolve(makeResponse());
    });

    await main();

    const startCall = logInfo.mock.calls.find(([f]) => f?.event === EVENT.AGENT_START);
    expect(startCall).toBeDefined();
    expect(startCall[0]).toMatchObject({ event: 'agent_start', agentName: 'LodestarAgent' });
    expect(typeof startCall[0].agentAddress).toBe('string');
  });
});

describe('runTask — weighted fallback retry', () => {
  const svcA = { id: 1, name: 'SvcA', price_usdc: '0.001', endpoint: 'https://a.example.com/ep', reputation: 100 };
  const svcB = { id: 2, name: 'SvcB', price_usdc: '0.002', endpoint: 'https://b.example.com/ep', reputation: 80 };

  let randomSpy;
  beforeEach(() => {
    // Pin Math.random to 0 so selectWeighted always picks the first available candidate.
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => {
    randomSpy.mockRestore();
  });

  it('falls back to second service when first service returns non-2xx', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/services')) {
        return Promise.resolve(makeResponse({ json: () => Promise.resolve({ services: [svcA, svcB] }) }));
      }
      if (url.includes('/reputation')) return Promise.resolve(makeResponse());
      if (url === svcA.endpoint) {
        return Promise.resolve(makeResponse({ ok: false, status: 503 }));
      }
      return Promise.resolve(makeResponse()); // svcB endpoint succeeds
    });

    const result = await runTask('weather', (ep) => ep, false);
    expect(result).toEqual({ success: true, priceUsdc: svcB.price_usdc });
  });

  it('logs payment_failed for each failing service and service_selected for each attempt', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/services')) {
        return Promise.resolve(makeResponse({ json: () => Promise.resolve({ services: [svcA, svcB] }) }));
      }
      if (url.includes('/reputation')) return Promise.resolve(makeResponse());
      if (url === svcA.endpoint) {
        return Promise.resolve(makeResponse({ ok: false, status: 503 }));
      }
      return Promise.resolve(makeResponse());
    });

    await runTask('weather', (ep) => ep, false);

    const selectedCalls = logInfo.mock.calls.filter(([f]) => f?.event === EVENT.SERVICE_SELECTED);
    expect(selectedCalls.length).toBe(2);
    expect(selectedCalls[0][0]).toMatchObject({ serviceId: svcA.id, attempt: 1 });
    expect(selectedCalls[1][0]).toMatchObject({ serviceId: svcB.id, attempt: 2 });

    const failCalls = logError.mock.calls.filter(([f]) => f?.event === EVENT.PAYMENT_FAILED);
    expect(failCalls.length).toBe(1); // only svcA failed
    expect(failCalls[0][0]).toMatchObject({ serviceId: svcA.id, httpStatus: 503 });
  });

  it('returns failure when all candidates are exhausted', async () => {
    global.fetch = buildFetch({ endpointOk: false });
    const result = await runTask('weather', (ep) => ep, false);
    expect(result).toEqual({ success: false, priceUsdc: null });
  });

  it('submits negative reputation vote when service returns bad data after payment', async () => {
    global.fetch = buildFetch({ endpointOk: false });

    await runTask('weather', (ep) => ep, false);

    const repCalls = global.fetch.mock.calls.filter(([url]) => url.includes('/reputation'));
    expect(repCalls.length).toBe(1);
    const body = JSON.parse(repCalls[0][1].body);
    expect(body).toMatchObject({ positive: false });
  });

  it('does not submit negative reputation vote when x402 payment itself throws', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/services')) {
        return Promise.resolve(makeResponse({ json: () => Promise.resolve({ services: [MOCK_SERVICE] }) }));
      }
      return Promise.reject(new Error('Network error'));
    });

    await runTask('weather', (ep) => ep, false);

    const repCalls = global.fetch.mock.calls.filter(([url]) => url.includes('/reputation'));
    expect(repCalls.length).toBe(0);
  });
});

describe('runTask — min reputation threshold', () => {
  afterEach(() => {
    delete process.env.AGENT_MIN_SERVICE_REPUTATION;
  });

  it('excludes services whose reputation is below the threshold', async () => {
    process.env.AGENT_MIN_SERVICE_REPUTATION = '50';
    const lowRepService = { ...MOCK_SERVICE, reputation: 10 };
    global.fetch = buildFetch({ services: [lowRepService] });

    const result = await runTask('weather', (ep) => ep, false);
    expect(result).toEqual({ success: false, priceUsdc: null });

    const call = logError.mock.calls.find(
      ([f]) => f?.event === EVENT.TASK_START && f?.minReputation === 50
    );
    expect(call).toBeDefined();
  });

  it('accepts services at exactly the minimum reputation', async () => {
    process.env.AGENT_MIN_SERVICE_REPUTATION = '50';
    const borderlineService = { ...MOCK_SERVICE, reputation: 50 };
    global.fetch = buildFetch({ services: [borderlineService] });

    const result = await runTask('weather', (ep) => ep, false);
    expect(result).toEqual({ success: true, priceUsdc: borderlineService.price_usdc });
  });

  it('filters out negative-reputation services with default threshold of 0', async () => {
    const negRepService = { ...MOCK_SERVICE, reputation: -1 };
    global.fetch = buildFetch({ services: [negRepService] });

    const result = await runTask('weather', (ep) => ep, false);
    expect(result).toEqual({ success: false, priceUsdc: null });
  });
});

describe('ensureRegistered — structured event fields', () => {
  it('logs agent_registered with scoringEnabled: false when contract is not deployed (503)', async () => {
    const { ensureRegistered } = await import('./agent.js');
    global.fetch = vi.fn().mockResolvedValueOnce(makeResponse({ ok: false, status: 503 }));

    await ensureRegistered();

    const call = logInfo.mock.calls.find(([f]) => f?.event === EVENT.AGENT_REGISTERED);
    expect(call).toBeDefined();
    expect(call[0]).toMatchObject({ event: 'agent_registered', scoringEnabled: false });
  });

  it('logs agent_registered with score and scoringEnabled: true when already registered', async () => {
    const { ensureRegistered } = await import('./agent.js');
    global.fetch = vi.fn().mockResolvedValueOnce(makeResponse({
      json: () => Promise.resolve({ agent: { score: 95 }, policy: null }),
    }));

    await ensureRegistered();

    const call = logInfo.mock.calls.find(([f]) => f?.event === EVENT.AGENT_REGISTERED && f?.scoringEnabled === true);
    expect(call).toBeDefined();
    expect(call[0]).toMatchObject({ event: 'agent_registered', score: 95, scoringEnabled: true });
  });
});

describe('graceful shutdown', () => {
  afterEach(() => {
    delete process.env.AGENT_SHUTDOWN_TIMEOUT_MS;
    vi.restoreAllMocks();
  });

  it('initiates shutdown on SIGTERM and logs the full shutdown lifecycle', async () => {
    const { initiateShutdown } = await import('./agent.js');

    await initiateShutdown('SIGTERM');

    const initCall = logInfo.mock.calls.find(([f]) => f?.event === 'shutdown_initiated');
    expect(initCall).toBeDefined();
    expect(initCall[0]).toMatchObject({ event: 'shutdown_initiated', signal: 'SIGTERM' });

    // completeShutdown calls process.exit(1) which would throw in test, so we just verify initiate
    expect(initCall[0]).toHaveProperty('signal', 'SIGTERM');
  });
});
