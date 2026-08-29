import crypto from 'crypto';
import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockFlagAgentOnChain = vi.fn();
const mockAdminDeactivateAgentOnChain = vi.fn();
const mockGetAgent = vi.fn();
const mockGetAgentPolicy = vi.fn();
const mockGetAgentScore = vi.fn();
const mockGetAgentCount = vi.fn();
const mockIsAgentEligible = vi.fn();
const mockCheckSpendingAllowed = vi.fn();
const mockListAgentsPage = vi.fn();
const mockRegisterAgentOnChain = vi.fn();
const mockRecordPaymentOnChain = vi.fn();
const mockDeactivateAgentOnChain = vi.fn();
const mockUpdatePolicyOnChain = vi.fn();
const mockBuildUnsignedAgentTx = vi.fn();
const mockSubmitSignedAgentTx = vi.fn();

vi.mock('../lib/contract.js', () => ({
  flagAgentOnChain: (...args) => mockFlagAgentOnChain(...args),
  adminDeactivateAgentOnChain: (...args) => mockAdminDeactivateAgentOnChain(...args),
  getAgent: (...args) => mockGetAgent(...args),
  getAgentPolicy: (...args) => mockGetAgentPolicy(...args),
  getAgentScore: (...args) => mockGetAgentScore(...args),
  getAgentCount: (...args) => mockGetAgentCount(...args),
  isAgentEligible: (...args) => mockIsAgentEligible(...args),
  checkSpendingAllowed: (...args) => mockCheckSpendingAllowed(...args),
  listAgentsPage: (...args) => mockListAgentsPage(...args),
  registerAgentOnChain: (...args) => mockRegisterAgentOnChain(...args),
  recordPaymentOnChain: (...args) => mockRecordPaymentOnChain(...args),
  deactivateAgentOnChain: (...args) => mockDeactivateAgentOnChain(...args),
  updatePolicyOnChain: (...args) => mockUpdatePolicyOnChain(...args),
  buildUnsignedAgentTx: (...args) => mockBuildUnsignedAgentTx(...args),
  submitSignedAgentTx: (...args) => mockSubmitSignedAgentTx(...args),
}));

vi.mock('../lib/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../config.js', () => ({
  default: {
    contract: { agentsId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4' },
    server: { address: 'GADMINXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', secret: 'test_admin_secret_key' },
    rateLimit: { payment: { max: 10, windowMs: 60000 } },
  },
}));

vi.mock('../middleware/rateLimiter.js', () => ({
  writeRateLimiter: () => (_req, _res, next) => next(),
}));

vi.mock('../middleware/paymentRateLimiter.js', () => ({
  paymentRateLimiter: () => (_req, _res, next) => next(),
}));

function adminKey(body) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return crypto.createHmac('sha256', 'test_admin_secret_key').update(raw).digest('hex');
}

function makeApp() {
  const app = express();
  app.use(express.json());
  return app;
}

let app;

beforeAll(async () => {
  const router = (await import('./agents.js')).default;
  app = makeApp();
  app.use('/', router);
});

describe('POST /admin/agents/:address/flag', () => {
  const ADDRESS = 'GAMASX3TLJIDO42FO3GTX7IQAYN7RJ4U4CXJOROTB7RSV3NGPUEIEQH3';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flags an agent with valid admin key', async () => {
    mockFlagAgentOnChain.mockResolvedValueOnce(true);

    const body = { reason: 'violation of terms' };
    const res = await request(app)
      .post(`/admin/agents/${ADDRESS}/flag`)
      .set('X-Admin-Key', adminKey(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mockFlagAgentOnChain).toHaveBeenCalledWith(ADDRESS, 'violation of terms');
  });

  it('returns 400 when reason is missing', async () => {
    const body = {};
    const res = await request(app)
      .post(`/admin/agents/${ADDRESS}/flag`)
      .set('X-Admin-Key', adminKey(body))
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_BODY');
    expect(mockFlagAgentOnChain).not.toHaveBeenCalled();
  });

  it('returns 401 when X-Admin-Key is missing', async () => {
    const res = await request(app)
      .post(`/admin/agents/${ADDRESS}/flag`)
      .send({ reason: 'test' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ADMIN_KEY_MISSING');
    expect(mockFlagAgentOnChain).not.toHaveBeenCalled();
  });

  it('returns 401 when X-Admin-Key is invalid', async () => {
    const res = await request(app)
      .post(`/admin/agents/${ADDRESS}/flag`)
      .set('X-Admin-Key', 'invalid_key')
      .send({ reason: 'test' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ADMIN_KEY_INVALID');
    expect(mockFlagAgentOnChain).not.toHaveBeenCalled();
  });

  it('handles contract errors gracefully', async () => {
    mockFlagAgentOnChain.mockRejectedValueOnce(new Error('Chain error'));

    const body = { reason: 'test' };
    const res = await request(app)
      .post(`/admin/agents/${ADDRESS}/flag`)
      .set('X-Admin-Key', adminKey(body))
      .send(body);

    expect(res.status).toBe(500);
  });
});

describe('POST /admin/agents/:address/deactivate', () => {
  const ADDRESS = 'GAMASX3TLJIDO42FO3GTX7IQAYN7RJ4U4CXJOROTB7RSV3NGPUEIEQH3';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deactivates an agent with valid admin key', async () => {
    mockAdminDeactivateAgentOnChain.mockResolvedValueOnce(true);

    const body = {};
    const res = await request(app)
      .post(`/admin/agents/${ADDRESS}/deactivate`)
      .set('X-Admin-Key', adminKey(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mockAdminDeactivateAgentOnChain).toHaveBeenCalledWith(ADDRESS);
  });

  it('returns 401 when X-Admin-Key is missing', async () => {
    const res = await request(app)
      .post(`/admin/agents/${ADDRESS}/deactivate`)
      .send({});

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ADMIN_KEY_MISSING');
    expect(mockAdminDeactivateAgentOnChain).not.toHaveBeenCalled();
  });

  it('returns 401 when X-Admin-Key is invalid', async () => {
    const res = await request(app)
      .post(`/admin/agents/${ADDRESS}/deactivate`)
      .set('X-Admin-Key', 'invalid')
      .send({});

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ADMIN_KEY_INVALID');
    expect(mockAdminDeactivateAgentOnChain).not.toHaveBeenCalled();
  });

  it('handles contract errors gracefully', async () => {
    mockAdminDeactivateAgentOnChain.mockRejectedValueOnce(new Error('Chain error'));

    const body = {};
    const res = await request(app)
      .post(`/admin/agents/${ADDRESS}/deactivate`)
      .set('X-Admin-Key', adminKey(body))
      .send(body);

    expect(res.status).toBe(500);
  });
});

const mockGetActivityFeed = vi.fn(() => Promise.resolve([]));
const mockParseActivityPagination = vi.fn(() => ({ limit: 20, offset: 0, errors: [] }));

vi.mock('../lib/activityFeed.js', async () => {
  const actual = await vi.importActual('../lib/activityFeed.js');
  return {
    ...actual,
    getActivityFeed: (...args) => mockGetActivityFeed(...args),
    parseActivityPagination: (...args) => mockParseActivityPagination(...args),
  };
});

const VALID_ADDR = 'GAMASX3TLJIDO42FO3GTX7IQAYN7RJ4U4CXJOROTB7RSV3NGPUEIEQH3';

describe('GET /api/agents/:address/payment-history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns paginated payment history for a given agent', async () => {
    mockGetActivityFeed.mockResolvedValue([
      { agent: VALID_ADDR, txHash: 'abc123', service: 'Weather', amount: '0.001', timestamp: '2026-01-01T00:00:00Z' },
      { agent: VALID_ADDR, txHash: 'def456', service: 'Search', amount: '0.002', timestamp: '2026-01-01T01:00:00Z' },
      { agent: 'GOTHER', txHash: 'other1', service: 'Weather', amount: '0.001', timestamp: '2026-01-01T02:00:00Z' },
    ]);

    const res = await request(app).get(`/agents/${VALID_ADDR}/payment-history`);
    expect(res.status).toBe(200);
    expect(res.body.payments).toHaveLength(2);
    expect(res.body.pagination.total).toBe(2);
    expect(res.body.pagination.hasMore).toBe(false);
  });

  it('returns empty payments when no activity matches the agent', async () => {
    mockGetActivityFeed.mockResolvedValue([]);

    const res = await request(app).get(`/agents/${VALID_ADDR}/payment-history`);
    expect(res.status).toBe(200);
    expect(res.body.payments).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  it('excludes entries without txHash', async () => {
    mockGetActivityFeed.mockResolvedValue([
      { agent: VALID_ADDR, txHash: '', service: 'Weather', amount: '0.001' },
      { agent: VALID_ADDR, txHash: 'real123', service: 'Weather', amount: '0.001' },
      { agent: VALID_ADDR, service: 'NoHash', amount: '0.001' },
    ]);

    const res = await request(app).get(`/agents/${VALID_ADDR}/payment-history`);
    expect(res.status).toBe(200);
    expect(res.body.payments).toHaveLength(1);
  });

  it('respects pagination params', async () => {
    const entries = Array.from({ length: 25 }, (_, i) => ({
      agent: VALID_ADDR,
      txHash: `tx-${i}`,
      service: 'Weather',
      amount: '0.001',
    }));
    mockGetActivityFeed.mockResolvedValue(entries);
    mockParseActivityPagination.mockReturnValueOnce({ limit: 10, offset: 5, errors: [] });

    const res = await request(app).get(`/agents/${VALID_ADDR}/payment-history?limit=10&offset=5`);
    expect(res.status).toBe(200);
    expect(res.body.payments).toHaveLength(10);
    expect(res.body.pagination.total).toBe(25);
    expect(res.body.pagination.hasMore).toBe(true);
  });

  it('returns 400 when pagination params are invalid', async () => {
    mockParseActivityPagination.mockReturnValueOnce({ limit: 0, offset: 0, errors: ['`limit` must be a positive integer'] });
    mockGetActivityFeed.mockResolvedValue([]);

    const res = await request(app).get(`/agents/${VALID_ADDR}/payment-history?limit=-1`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PAGINATION');
  });
});
