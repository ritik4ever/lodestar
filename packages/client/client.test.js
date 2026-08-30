import { describe, expect, it, vi, beforeEach } from 'vitest';
import { LodestarClient, createClient, LodestarApiError } from './index.js';

describe('LodestarClient', () => {
  let mockFetch;
  let client;

  beforeEach(() => {
    mockFetch = vi.fn();
    client = new LodestarClient({
      baseUrl: 'http://api.test',
      timeoutMs: 5000,
      fetch: mockFetch,
    });
  });

  function jsonResponse(data, status = 200, headers = {}) {
    const normalizedHeaders = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
    );
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (name) => {
          const lower = name.toLowerCase();
          if (lower === 'content-type' && !normalizedHeaders['content-type']) {
            return 'application/json';
          }
          return normalizedHeaders[lower] || null;
        },
      },
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
    });
  }

  describe('Initialization and Configuration', () => {
    it('strips trailing slashes from baseUrl', () => {
      const c = new LodestarClient({ baseUrl: 'http://localhost:3001///' });
      expect(c.baseUrl).toBe('http://localhost:3001');
    });

    it('defaults to localhost:3001 if baseUrl is not provided', () => {
      const c = createClient();
      expect(c.baseUrl).toBe('http://localhost:3001');
    });

    it('sets custom default headers', async () => {
      const c = new LodestarClient({
        baseUrl: 'http://api.test',
        headers: { 'X-Custom-Header': 'CustomValue' },
        fetch: mockFetch,
      });
      mockFetch.mockReturnValue(jsonResponse({ status: 'ok' }));

      await c.getHealth();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://api.test/healthz',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Custom-Header': 'CustomValue',
            'Content-Type': 'application/json',
          }),
        })
      );
    });
  });

  describe('System endpoints', () => {
    it('getHealth calls GET /healthz', async () => {
      mockFetch.mockReturnValue(jsonResponse({ status: 'ok', uptimeSeconds: 123 }));

      const res = await client.getHealth();
      expect(res).toEqual({ status: 'ok', uptimeSeconds: 123 });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://api.test/healthz',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('getReadiness calls GET /readyz', async () => {
      mockFetch.mockReturnValue(jsonResponse({ ready: true, status: 'ready' }));

      const res = await client.getReadiness();
      expect(res).toEqual({ ready: true, status: 'ready' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://api.test/readyz',
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('Registry & Services endpoints', () => {
    it('getStats calls GET /api/stats', async () => {
      mockFetch.mockReturnValue(jsonResponse({ total_services: 5, total_categories: 3 }));

      const res = await client.getStats();
      expect(res.total_services).toBe(5);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://api.test/api/stats',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('getServices calls GET /api/services with query params', async () => {
      mockFetch.mockReturnValue(jsonResponse({ services: [{ id: 1, name: 'Weather API' }] }));

      const res = await client.getServices({ category: 'weather' });
      expect(res.services).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://api.test/api/services?category=weather',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('getServices ignores "all" category filter', async () => {
      mockFetch.mockReturnValue(jsonResponse({ services: [] }));

      await client.getServices({ category: 'all' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://api.test/api/services',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('getServiceById calls GET /api/services/:id', async () => {
      mockFetch.mockReturnValue(jsonResponse({ id: 42, name: 'Search Service' }));

      const res = await client.getServiceById(42);
      expect(res.id).toBe(42);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://api.test/api/services/42',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('getServicesByProvider calls GET /api/registry/by-provider/:address', async () => {
      const address = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVAAA';
      mockFetch.mockReturnValue(jsonResponse({ services: [{ id: 1 }] }));

      const res = await client.getServicesByProvider(address);
      expect(res.services).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledWith(
        `http://api.test/api/registry/by-provider/${address}`,
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('prepareRegisterService calls POST /api/registry/prepare-register with JSON body', async () => {
      const reqData = {
        name: 'New Service',
        description: 'Testing',
        endpoint: 'https://example.com/api',
        priceUsdc: '0.05',
        category: 'ai',
        providerAddress: 'GA7Q...',
      };
      mockFetch.mockReturnValue(jsonResponse({ xdr: 'AAAA...', submitToken: 'tok123' }));

      const res = await client.prepareRegisterService(reqData);
      expect(res.submitToken).toBe('tok123');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://api.test/api/registry/prepare-register',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(reqData),
        })
      );
    });

    it('submitSignedRegistryTx calls POST /api/registry/submit-signed-tx', async () => {
      const reqData = { signedXdr: 'AAAA...', submitToken: 'tok123' };
      mockFetch.mockReturnValue(jsonResponse({ success: true, hash: 'tx123', id: 5 }));

      const res = await client.submitSignedRegistryTx(reqData);
      expect(res.success).toBe(true);
      expect(res.id).toBe(5);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://api.test/api/registry/submit-signed-tx',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(reqData),
        })
      );
    });

    it('submitReputation calls POST /api/reputation/:id', async () => {
      mockFetch.mockReturnValue(jsonResponse({ newReputation: 15, txHash: 'txhash1' }));

      const res = await client.submitReputation(10, { positive: true, agent: 'GA7Q...' });
      expect(res.newReputation).toBe(15);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://api.test/api/reputation/10',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ positive: true, agent: 'GA7Q...' }),
        })
      );
    });
  });

  describe('Agent endpoints', () => {
    it('getAgents calls GET /api/agents with pagination and sorting params', async () => {
      mockFetch.mockReturnValue(
        jsonResponse({ agents: [], total: 0, page: 1, pageSize: 10, totalPages: 0 })
      );

      const res = await client.getAgents({ page: 1, pageSize: 10, sort: 'payments' });
      expect(res.page).toBe(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://api.test/api/agents?page=1&pageSize=10&sort=payments',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('getAgentStats calls GET /api/agents/stats', async () => {
      mockFetch.mockReturnValue(jsonResponse({ total_agents: 10, average_score: 750 }));

      const res = await client.getAgentStats();
      expect(res.total_agents).toBe(10);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://api.test/api/agents/stats',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('getAgent calls GET /api/agents/:address', async () => {
      const address = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVAAA';
      mockFetch.mockReturnValue(
        jsonResponse({
          agent: { address, name: 'Agent 1', score: 800 },
          policy: null,
        })
      );

      const res = await client.getAgent(address);
      expect(res.agent.name).toBe('Agent 1');
      expect(mockFetch).toHaveBeenCalledWith(
        `http://api.test/api/agents/${address}`,
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('registerAgent calls POST /api/agents/register', async () => {
      const reqData = {
        name: 'Autonomous Agent',
        description: 'Executes trades',
        address: 'GA7Q...',
      };
      mockFetch.mockReturnValue(jsonResponse({ txHash: 'txhash_reg', agent: reqData }));

      const res = await client.registerAgent(reqData);
      expect(res.txHash).toBe('txhash_reg');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://api.test/api/agents/register',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(reqData),
        })
      );
    });

    it('getAgentEligibility calls GET /api/agents/:address/eligible', async () => {
      const address = 'GA7Q...';
      mockFetch.mockReturnValue(jsonResponse({ eligible: true, score: 900, minScore: 500 }));

      const res = await client.getAgentEligibility(address, 500);
      expect(res.eligible).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://api.test/api/agents/GA7Q.../eligible?min_score=500',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('checkAgentCanSpend calls GET /api/agents/:address/can-spend with parameters', async () => {
      const address = 'GA7Q...';
      mockFetch.mockReturnValue(jsonResponse({ allowed: true }));

      const res = await client.checkAgentCanSpend(address, {
        amount: '0.05',
        category: 'weather',
      });
      expect(res.allowed).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://api.test/api/agents/GA7Q.../can-spend?amount=0.05&category=weather',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('recordAgentPayment calls POST /api/agents/:address/payment', async () => {
      const address = 'GA7Q...';
      const paymentData = { success: true, stroops: '500000', txHash: 'txpay1' };
      mockFetch.mockReturnValue(jsonResponse({ newScore: 820, txHash: 'txrec' }));

      const res = await client.recordAgentPayment(address, paymentData);
      expect(res.newScore).toBe(820);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://api.test/api/agents/GA7Q.../payment',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(paymentData),
        })
      );
    });

    it('buildAgentTx includes x-caller-address header', async () => {
      const address = 'GA7Q...';
      const caller = 'GCALLER...';
      const data = { action: 'update_policy', max_per_tx_stroops: '1000' };
      mockFetch.mockReturnValue(jsonResponse({ xdr: 'AAAA_TX' }));

      const res = await client.buildAgentTx(address, data, caller);
      expect(res.xdr).toBe('AAAA_TX');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://api.test/api/agents/GA7Q.../build-tx',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'x-caller-address': caller,
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify(data),
        })
      );
    });

    it('submitSignedAgentTx calls POST /api/agents/:address/submit-signed-tx', async () => {
      const address = 'GA7Q...';
      mockFetch.mockReturnValue(jsonResponse({ txHash: 'signed_tx_hash' }));

      const res = await client.submitSignedAgentTx(address, { signedXdr: 'AAAA...' });
      expect(res.txHash).toBe('signed_tx_hash');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://api.test/api/agents/GA7Q.../submit-signed-tx',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ signedXdr: 'AAAA...' }),
        })
      );
    });
  });

  describe('Activity endpoints', () => {
    it('getActivity calls GET /api/activity with pagination', async () => {
      mockFetch.mockReturnValue(jsonResponse({ events: [{ id: 'evt1' }] }));

      const res = await client.getActivity({ page: 2, limit: 15 });
      expect(res.events).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://api.test/api/activity?page=2&limit=15',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('getDemoActivity calls GET /demo/activity', async () => {
      mockFetch.mockReturnValue(jsonResponse({ activity: [{ id: 'demo1' }] }));

      const res = await client.getDemoActivity();
      expect(res.activity).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://api.test/demo/activity',
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('Error handling', () => {
    it('throws LodestarApiError on HTTP error status with response details', async () => {
      mockFetch.mockReturnValue(
        jsonResponse(
          { error: 'Invalid Stellar address format', code: 'INVALID_ADDRESS', requestId: 'req_123' },
          400
        )
      );

      await expect(client.getAgent('INVALID')).rejects.toThrow(LodestarApiError);

      try {
        await client.getAgent('INVALID');
      } catch (err) {
        expect(err.status).toBe(400);
        expect(err.code).toBe('INVALID_ADDRESS');
        expect(err.requestId).toBe('req_123');
        expect(err.message).toBe('Invalid Stellar address format');
      }
    });

    it('extracts requestId from x-request-id response header if not in JSON body', async () => {
      mockFetch.mockReturnValue(
        jsonResponse(
          { error: 'Internal server error' },
          500,
          { 'X-Request-Id': 'header-req-id-789' }
        )
      );

      try {
        await client.getHealth();
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(LodestarApiError);
        expect(err.status).toBe(500);
        expect(err.requestId).toBe('header-req-id-789');
      }
    });

    it('handles network failure by throwing LodestarApiError with NETWORK_ERROR', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      try {
        await client.getHealth();
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(LodestarApiError);
        expect(err.code).toBe('NETWORK_ERROR');
        expect(err.message).toBe('Connection refused');
      }
    });

    it('handles timeout error by throwing LodestarApiError with TIMEOUT', async () => {
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'TimeoutError';
      mockFetch.mockRejectedValue(abortErr);

      try {
        await client.getHealth();
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(LodestarApiError);
        expect(err.status).toBe(408);
        expect(err.code).toBe('TIMEOUT');
      }
    });
  });
});
