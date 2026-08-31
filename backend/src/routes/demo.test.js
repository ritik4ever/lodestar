/**
 * Tests for POST /api/demo-run
 *
 * Focus: the dataValid quality-check introduced to fix issue #63 — the route
 * must surface dataValid:true for well-formed service payloads and
 * dataValid:false for empty/error payloads so the frontend can issue the
 * correct positive/negative reputation vote.
 */

import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockGetService = vi.fn();
const mockRecordActivity = vi.fn();
const mockGetActivityFeed = vi.fn(() => []);
const mockWaitForActivityTxHash = vi.fn().mockResolvedValue('');
const mockValidateDemoEndpoint = vi.fn();
const mockBuildHttpClient = vi.fn();

vi.mock('../lib/contract.js', () => ({
  getService: (...args) => mockGetService(...args),
}));

vi.mock('./services.js', () => ({
  recordActivity: (...args) => mockRecordActivity(...args),
  getActivityFeed: (...args) => mockGetActivityFeed(...args),
}));

vi.mock('../lib/waitForActivityTxHash.js', () => ({
  waitForActivityTxHash: (...args) => mockWaitForActivityTxHash(...args),
}));

vi.mock('./demoValidate.js', () => ({
  validateDemoEndpoint: (...args) => mockValidateDemoEndpoint(...args),
}));

vi.mock('../lib/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('../config.js', () => ({
  default: {
    server: { secret: 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', address: 'GAAA' },
    stellar: { rpcUrl: 'https://soroban-testnet.stellar.org' },
    demoRun: { pollMaxWaitMs: 100, pollInitialDelayMs: 10, pollMaxDelayMs: 50 },
    x402: {},
    contract: {},
  },
}));

// Intercept the x402 HTTP client construction so we control fetchWithTx in tests.
let fetchWithTxImpl = vi.fn();

vi.mock('@x402/core/client', () => ({
  x402Client: class {
    register() { return this; }
  },
  x402HTTPClient: class {
    constructor() {
      // fetchWithTx is injected by the route module; we override it right after
      // construction via the mockBuildHttpClient wrapper below.
    }
  },
}));

vi.mock('@x402/stellar', () => ({
  createEd25519Signer: vi.fn(() => ({})),
}));

vi.mock('@x402/stellar/exact/client', () => ({
  ExactStellarScheme: class {},
}));

// ── helpers ───────────────────────────────────────────────────────────────────

function makeService(overrides = {}) {
  return {
    id: 1,
    name: 'Weather Oracle',
    endpoint: 'https://weather.example.com/demo/weather',
    price_usdc: '0.01',
    category: 'weather',
    ...overrides,
  };
}

/**
 * Build a minimal Response-like object that the route's httpClient.fetchWithTx
 * returns as `{ response, txHash }`.
 */
function makeServiceResponse(body, { status = 200, txHash = 'abc123' } = {}) {
  const bodyStr = JSON.stringify(body);
  return {
    txHash,
    response: {
      ok: status >= 200 && status < 300,
      status,
      json: async () => JSON.parse(bodyStr),
      headers: { get: () => txHash || null },
    },
  };
}

// ── app setup ─────────────────────────────────────────────────────────────────

let app;

beforeAll(async () => {
  // Import *after* mocks are registered so the route module picks up the mocks.
  const router = (await import('./demo.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api', router);
});

// ── per-test reset ─────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActivityFeed.mockReturnValue([]);
  mockWaitForActivityTxHash.mockResolvedValue('');
  // Default: endpoint validation passes
  mockValidateDemoEndpoint.mockImplementation((ep) => ep);
});

// ── helper that wires fetchWithTx on the route's internal httpClient ──────────
//
// The route calls `buildHttpClient()` internally and then calls
// `httpClient.fetchWithTx(url)`. Because we mock the x402 classes above,
// the constructed instance doesn't have fetchWithTx yet — the route assigns it
// in `buildHttpClient()`. We intercept at the fetch() level instead so we
// don't need to reach inside the closure.

/**
 * Spy on the global `fetch` to return a controlled service response for the
 * demo endpoint call. The route's buildHttpClient calls fetch() directly.
 * We simulate a non-402 response so the client skips payment and returns the
 * probe response directly.
 */
function mockFetch(body, opts = {}) {
  const { status = 200, txHash = '' } = opts;
  const headers = new Map([['x-payment-transaction', txHash]]);
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    status,                              // not 402 → skips payment flow
    ok: status >= 200 && status < 300,
    headers: { get: (k) => headers.get(k) ?? null },
    json: async () => body,
  });
  return fetchSpy;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/demo-run — input validation', () => {
  it('returns 400 when serviceId is missing', async () => {
    const res = await request(app)
      .post('/api/demo-run')
      .send({ category: 'weather' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_BODY');
  });

  it('returns 400 when category is missing', async () => {
    const res = await request(app)
      .post('/api/demo-run')
      .send({ serviceId: 1 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_BODY');
  });

  it('returns 404 when the service does not exist', async () => {
    mockGetService.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/demo-run')
      .send({ serviceId: 99, category: 'weather' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('returns 400 when the endpoint fails SSRF validation', async () => {
    mockGetService.mockResolvedValueOnce(makeService());
    mockValidateDemoEndpoint.mockImplementationOnce(() => {
      throw Object.assign(new Error('Endpoint not allowed'), { code: 'ENDPOINT_NOT_ALLOWED' });
    });

    const res = await request(app)
      .post('/api/demo-run')
      .send({ serviceId: 1, category: 'weather' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ENDPOINT_NOT_ALLOWED');
  });
});

describe('POST /api/demo-run — dataValid flag (issue #63)', () => {
  it('returns dataValid:true for a well-formed weather payload', async () => {
    mockGetService.mockResolvedValueOnce(makeService());
    mockFetch({ latitude: 40.71, longitude: -74.0, temperature_c: 22, wind_speed_kmh: 10, weather_code: 0, time: '2026-07-28' });

    const res = await request(app)
      .post('/api/demo-run')
      .send({ serviceId: 1, category: 'weather' });

    expect(res.status).toBe(200);
    expect(res.body.dataValid).toBe(true);
    expect(res.body.data).toMatchObject({ temperature_c: 22 });
  });

  it('returns dataValid:true for a well-formed search payload', async () => {
    mockGetService.mockResolvedValueOnce(makeService({ category: 'search' }));
    mockFetch({ query: 'Stellar', results: [{ title: 'Stellar', url: 'https://stellar.org', description: 'A blockchain' }] });

    const res = await request(app)
      .post('/api/demo-run')
      .send({ serviceId: 1, category: 'search' });

    expect(res.status).toBe(200);
    expect(res.body.dataValid).toBe(true);
  });

  it('returns dataValid:false when the service returns a top-level error field', async () => {
    mockGetService.mockResolvedValueOnce(makeService());
    mockFetch({ error: 'Upstream provider unavailable', code: 'UPSTREAM_ERROR' });

    const res = await request(app)
      .post('/api/demo-run')
      .send({ serviceId: 1, category: 'weather' });

    expect(res.status).toBe(200);
    expect(res.body.dataValid).toBe(false);
    // The raw data is still forwarded so the frontend can inspect it
    expect(res.body.data).toMatchObject({ error: 'Upstream provider unavailable' });
  });

  it('returns dataValid:false when the service returns an empty object', async () => {
    mockGetService.mockResolvedValueOnce(makeService());
    mockFetch({});

    const res = await request(app)
      .post('/api/demo-run')
      .send({ serviceId: 1, category: 'weather' });

    expect(res.status).toBe(200);
    expect(res.body.dataValid).toBe(false);
  });

  it('returns dataValid:false when the service returns an empty array', async () => {
    mockGetService.mockResolvedValueOnce(makeService({ category: 'search' }));
    mockFetch([]);

    const res = await request(app)
      .post('/api/demo-run')
      .send({ serviceId: 1, category: 'search' });

    expect(res.status).toBe(200);
    expect(res.body.dataValid).toBe(false);
  });

  it('returns dataValid:true when the service returns a non-empty array', async () => {
    mockGetService.mockResolvedValueOnce(makeService({ category: 'search' }));
    mockFetch([{ title: 'Result', url: 'https://example.com', description: 'A result' }]);

    const res = await request(app)
      .post('/api/demo-run')
      .send({ serviceId: 1, category: 'search' });

    expect(res.status).toBe(200);
    expect(res.body.dataValid).toBe(true);
  });

  it('returns 500 (not dataValid:false) when the upstream service returns a non-2xx status', async () => {
    mockGetService.mockResolvedValueOnce(makeService());
    const headers = new Map();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 503,
      ok: false,
      headers: { get: (k) => headers.get(k) ?? null },
      json: async () => ({ error: 'unavailable' }),
    });

    const res = await request(app)
      .post('/api/demo-run')
      .send({ serviceId: 1, category: 'weather' });

    // A non-2xx response throws before reaching the dataValid check — surfaces as 500 DEMO_ERROR
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('DEMO_ERROR');
  });
});

describe('POST /api/demo-run — client disconnect during polling (issue #531)', () => {
  it('passes an AbortSignal in the options arg to waitForActivityTxHash', async () => {
    mockGetService.mockResolvedValueOnce(makeService());
    // txHash absent on the fetch response → route falls through to polling.
    mockFetch({ latitude: 40.71, temperature_c: 20, wind_speed_kmh: 5, weather_code: 1, time: 'T' });

    const res = await request(app)
      .post('/api/demo-run')
      .send({ serviceId: 1, category: 'weather' });

    expect(res.status).toBe(200);
    expect(mockWaitForActivityTxHash).toHaveBeenCalledTimes(1);
    const options = mockWaitForActivityTxHash.mock.calls[0][2];
    expect(options).toMatchObject({ signal: expect.any(AbortSignal) });
  });

  it('responds 499 when the poll aborts because the client disconnected', async () => {
    mockGetService.mockResolvedValueOnce(makeService());
    mockFetch({ latitude: 40.71, temperature_c: 20, wind_speed_kmh: 5, weather_code: 1, time: 'T' });
    // Simulate the abort surfacing from the polling phase.
    mockWaitForActivityTxHash.mockRejectedValueOnce(
      Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
    );

    const res = await request(app)
      .post('/api/demo-run')
      .send({ serviceId: 1, category: 'weather' });

    expect(res.status).toBe(499);
    expect(res.body.code).toBe('CANCELLED');
  });
});

describe('POST /api/demo-run — response shape', () => {
  it('includes data, txHash, and dataValid in a successful response', async () => {
    mockGetService.mockResolvedValueOnce(makeService());
    const headers = new Map([['x-payment-transaction', 'tx-hash-xyz']]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      ok: true,
      headers: { get: (k) => headers.get(k) ?? null },
      json: async () => ({ latitude: 40.71, temperature_c: 20, wind_speed_kmh: 5, weather_code: 1, time: 'T' }),
    });

    const res = await request(app)
      .post('/api/demo-run')
      .send({ serviceId: 1, category: 'weather' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      dataValid: true,
      txHash: expect.any(String),
    });
    expect(res.body.data).toBeDefined();
  });
});
