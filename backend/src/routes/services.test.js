import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockRecordPaymentOnChain = vi.fn();
const mockGetAgent = vi.fn();
const mockRecordActivity = vi.fn();

vi.mock('../lib/contract.js', () => ({
  recordPaymentOnChain: (...args) => mockRecordPaymentOnChain(...args),
  getAgent: (...args) => mockGetAgent(...args),
}));

vi.mock('../lib/activityFeed.js', () => ({
  recordActivity: (...args) => mockRecordActivity(...args),
  getActivityFeed: vi.fn(() => []),
  parseActivityPagination: vi.fn(() => ({ limit: 20, offset: 0, errors: [] })),
  ACTIVITY_MAX_ENTRIES: 500,
  ACTIVITY_DEFAULT_LIMIT: 20,
  ACTIVITY_MAX_LIMIT: 100,
}));

vi.mock('../lib/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../config.js', () => ({
  default: {
    contract: { agentsId: 'mock-agents-contract' },
    server: { address: 'mock_address', secret: 'mock_secret' },
    x402: { facilitatorUrl: 'https://mock', weatherPrice: '0.001', searchPrice: '0.001', payTo: 'G_MOCK_PAYMENT' },
    braveApiKey: 'mock_key',
    corsOrigin: ['http://localhost:3000'],
    nodeEnv: 'test',
    port: 3001,
    logLevel: 'silent',
  },
}));

// Bypass x402 payment middleware in tests
vi.mock('@x402/express', () => ({
  paymentMiddlewareFromConfig: () => (_req, _res, next) => next(),
}));
vi.mock('@x402/core/server', () => ({
  HTTPFacilitatorClient: vi.fn(() => ({})),
}));
vi.mock('@x402/stellar/exact/server', () => ({
  ExactStellarScheme: vi.fn(() => ({})),
}));

// A syntactically valid Stellar address (matches /^G[A-Z2-7]{55}$/) used across tests
const VALID_STELLAR_ADDRESS = 'G' + 'A'.repeat(55);
const MOCK_AGENT = { address: VALID_STELLAR_ADDRESS, name: 'Test Agent', active: true };

const mockWeatherFetch = () =>
  vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      current: { temperature_2m: 20, wind_speed_10m: 5, weather_code: 1, time: 'now' },
    }),
  });

let app;
let mockLogger;

beforeAll(async () => {
  const router = (await import('./services.js')).default;
  const loggerModule = await import('../lib/logger.js');
  mockLogger = loggerModule.default;
  app = express();
  app.use(express.json());
  app.use('/demo', router);
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /demo/weather coordinate validation', () => {
  it('returns 400 INVALID_COORDINATES when lat is above 90', async () => {
    const res = await request(app).get('/demo/weather?lat=91&lon=0');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_COORDINATES');
  });

  it('returns 400 INVALID_COORDINATES when lat is below -90', async () => {
    const res = await request(app).get('/demo/weather?lat=-91&lon=0');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_COORDINATES');
  });

  it('returns 400 INVALID_COORDINATES when lon is above 180', async () => {
    const res = await request(app).get('/demo/weather?lat=0&lon=181');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_COORDINATES');
  });

  it('returns 400 INVALID_COORDINATES when lon is below -180', async () => {
    const res = await request(app).get('/demo/weather?lat=0&lon=-181');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_COORDINATES');
  });

  it('accepts valid boundary coordinates (90, 180)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ current: { temperature_2m: 20, wind_speed_10m: 5, weather_code: 1, time: 'now' } }),
    });
    const res = await request(app).get('/demo/weather?lat=90&lon=180');
    expect(res.status).toBe(200);
    expect(res.body.latitude).toBe(90);
    expect(res.body.longitude).toBe(180);
  });

  it('accepts valid boundary coordinates (-90, -180)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ current: { temperature_2m: -5, wind_speed_10m: 10, weather_code: 3, time: 'now' } }),
    });
    const res = await request(app).get('/demo/weather?lat=-90&lon=-180');
    expect(res.status).toBe(200);
    expect(res.body.latitude).toBe(-90);
    expect(res.body.longitude).toBe(-180);
  });

  it('falls back to default coordinates when no query params supplied', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ current: { temperature_2m: 22, wind_speed_10m: 3, weather_code: 0, time: 'now' } }),
    });
    const res = await request(app).get('/demo/weather');
    expect(res.status).toBe(200);
    expect(res.body.latitude).toBe(40.7128);
    expect(res.body.longitude).toBe(-74.006);
  });
});

describe('payment header validation — weather', () => {
  it('skips recordPaymentOnChain and warns when x-payment-transaction is absent', async () => {
    global.fetch = mockWeatherFetch();
    const res = await request(app)
      .get('/demo/weather?lat=0&lon=0')
      .set('x-payment-address', VALID_STELLAR_ADDRESS);
    expect(res.status).toBe(200);
    // creditPayment returns before calling getAgent or the contract
    expect(mockGetAgent).not.toHaveBeenCalled();
    expect(mockRecordPaymentOnChain).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ agentAddress: VALID_STELLAR_ADDRESS }),
      expect.stringContaining('x-payment-transaction header absent')
    );
  });

  it('skips recordPaymentOnChain and warns when x-payment-address has invalid format', async () => {
    global.fetch = mockWeatherFetch();
    const res = await request(app)
      .get('/demo/weather?lat=0&lon=0')
      .set('x-payment-address', 'GMALICIOUS_BAD_ADDRESS')
      .set('x-payment-transaction', 'abc123tx');
    expect(res.status).toBe(200);
    expect(mockGetAgent).not.toHaveBeenCalled();
    expect(mockRecordPaymentOnChain).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ agentAddress: 'GMALICIOUS_BAD_ADDRESS' }),
      expect.stringContaining('fails Stellar address validation')
    );
  });

  it('skips recordPaymentOnChain and warns when agent is not registered on-chain', async () => {
    global.fetch = mockWeatherFetch();
    mockGetAgent.mockResolvedValue(null);
    const res = await request(app)
      .get('/demo/weather?lat=0&lon=0')
      .set('x-payment-address', VALID_STELLAR_ADDRESS)
      .set('x-payment-transaction', 'abc123tx');
    expect(res.status).toBe(200);
    expect(mockGetAgent).toHaveBeenCalledWith(VALID_STELLAR_ADDRESS);
    expect(mockRecordPaymentOnChain).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ agentAddress: VALID_STELLAR_ADDRESS }),
      expect.stringContaining('agent not registered on-chain')
    );
  });

  it('credits payment and emits audit log when all guards pass', async () => {
    global.fetch = mockWeatherFetch();
    mockGetAgent.mockResolvedValue(MOCK_AGENT);
    mockRecordPaymentOnChain.mockResolvedValue(true);
    const res = await request(app)
      .get('/demo/weather?lat=0&lon=0')
      .set('x-payment-address', VALID_STELLAR_ADDRESS)
      .set('x-payment-transaction', 'abc123tx');
    expect(res.status).toBe(200);
    // Allow the async credit promise to settle
    await vi.waitFor(() => expect(mockRecordPaymentOnChain).toHaveBeenCalled());
    expect(mockRecordPaymentOnChain).toHaveBeenCalledWith(
      VALID_STELLAR_ADDRESS,
      1,
      expect.any(BigInt),
      true
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ agentAddress: VALID_STELLAR_ADDRESS, txHash: 'abc123tx' }),
      expect.stringContaining('weather payment credited to registered agent')
    );
  });
});

describe('GET /demo/search query validation', () => {
  it('returns 400 INVALID_QUERY when q is missing', async () => {
    const res = await request(app).get('/demo/search');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_QUERY');
  });

  it('returns 400 INVALID_QUERY when q is longer than 256 characters', async () => {
    const longQuery = 'a'.repeat(257);
    const res = await request(app).get(`/demo/search?q=${longQuery}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_QUERY');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ rawQuery: longQuery }),
      expect.stringContaining('Invalid search query supplied to GET /demo/search')
    );
  });

  it('trims and sanitizes q before forwarding to search service', async () => {
    const queryWithWhitespace = '   hello   world  \n\t ';
    const normalizedQuery = 'hello world';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ organic: [{ title: 'r', link: 'u', snippet: 's' }] }),
    });

    const res = await request(app).get(`/demo/search?q=${encodeURIComponent(queryWithWhitespace)}`);
    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://google.serper.dev/search',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json', 'X-API-KEY': 'mock_key' }),
        body: JSON.stringify({ q: normalizedQuery, num: 5 }),
      })
    );
    expect(res.body.query).toBe(normalizedQuery);
  });
});

describe('payment header validation — search', () => {
  const mockSearchFetch = () =>
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ organic: [{ title: 'r', link: 'u', snippet: 's' }] }),
    });

  it('skips recordPaymentOnChain and warns when x-payment-transaction is absent', async () => {
    global.fetch = mockSearchFetch();
    const res = await request(app)
      .get('/demo/search?q=hello')
      .set('x-payment-address', VALID_STELLAR_ADDRESS);
    expect(res.status).toBe(200);
    expect(mockGetAgent).not.toHaveBeenCalled();
    expect(mockRecordPaymentOnChain).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ agentAddress: VALID_STELLAR_ADDRESS }),
      expect.stringContaining('x-payment-transaction header absent')
    );
  });

  it('credits payment and emits audit log when all guards pass', async () => {
    global.fetch = mockSearchFetch();
    mockGetAgent.mockResolvedValue(MOCK_AGENT);
    mockRecordPaymentOnChain.mockResolvedValue(true);
    const res = await request(app)
      .get('/demo/search?q=hello')
      .set('x-payment-address', VALID_STELLAR_ADDRESS)
      .set('x-payment-transaction', 'searchtx99');
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(mockRecordPaymentOnChain).toHaveBeenCalled());
    expect(mockRecordPaymentOnChain).toHaveBeenCalledWith(
      VALID_STELLAR_ADDRESS,
      2,
      expect.any(BigInt),
      true
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ agentAddress: VALID_STELLAR_ADDRESS, txHash: 'searchtx99' }),
      expect.stringContaining('search payment credited to registered agent')
    );
  });
});
