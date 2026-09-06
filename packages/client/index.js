/**
 * @lodestar/client
 * Typed OpenAPI client for the Lodestar backend (#832).
 */

export class LodestarApiError extends Error {
  constructor(message, status, body, code, requestId) {
    super(message);
    this.name = 'LodestarApiError';
    this.status = status;
    this.body = body;
    this.code = code || (body && typeof body === 'object' ? body.code : undefined);
    this.requestId = requestId || (body && typeof body === 'object' ? body.requestId : undefined);
  }
}

export class LodestarClient {
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || 'http://localhost:3001').replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this._customFetch = options.fetch;
    this.defaultHeaders = options.headers || {};
  }

  async _request(path, options = {}) {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const fetchFn = options.fetch || this._customFetch || globalThis.fetch;
    const headers = {
      'Content-Type': 'application/json',
      ...this.defaultHeaders,
      ...(options.headers || {}),
    };

    let signal = options.signal;
    let timeoutId;
    if (!signal && typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      signal = AbortSignal.timeout(timeoutMs);
    } else if (!signal && typeof AbortController !== 'undefined') {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      signal = controller.signal;
    }

    try {
      const res = await fetchFn(url, {
        ...options,
        headers,
        signal,
      });

      if (timeoutId) clearTimeout(timeoutId);

      let data = null;
      if (typeof res.json === 'function') {
        data = await res.json().catch(() => null);
      } else if (typeof res.text === 'function') {
        const text = await res.text().catch(() => '');
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }

      if (!res.ok) {
        const message =
          (data && typeof data === 'object' && (data.error || data.message)) ||
          `Request failed with status ${res.status}`;
        const code = data && typeof data === 'object' ? data.code : undefined;
        const requestId =
          (data && typeof data === 'object' && data.requestId) ||
          res.headers?.get?.('x-request-id') ||
          undefined;

        throw new LodestarApiError(message, res.status, data, code, requestId);
      }

      return data;
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      if (err instanceof LodestarApiError) throw err;
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        throw new LodestarApiError(`Request timed out after ${timeoutMs}ms`, 408, null, 'TIMEOUT');
      }
      throw new LodestarApiError(err.message || 'Network request failed', 0, null, 'NETWORK_ERROR');
    }
  }

  // ── System ──────────────────────────────────────────────────────────────────

  async getHealth(options) {
    return this._request('/healthz', { method: 'GET', ...options });
  }

  async getReadiness(options) {
    return this._request('/readyz', { method: 'GET', ...options });
  }

  // ── Registry & Services ────────────────────────────────────────────────────

  async getStats(options) {
    return this._request('/api/stats', { method: 'GET', ...options });
  }

  async getServices(params = {}, options) {
    const query = new URLSearchParams();
    if (params.category && params.category !== 'all') {
      query.set('category', params.category);
    }
    const qs = query.toString();
    return this._request(`/api/services${qs ? `?${qs}` : ''}`, { method: 'GET', ...options });
  }

  async getServiceById(id, options) {
    return this._request(`/api/services/${encodeURIComponent(id)}`, { method: 'GET', ...options });
  }

  async getServicesByProvider(address, options) {
    return this._request(`/api/registry/by-provider/${encodeURIComponent(address)}`, {
      method: 'GET',
      ...options,
    });
  }

  async prepareRegisterService(data, options) {
    return this._request('/api/registry/prepare-register', {
      method: 'POST',
      body: JSON.stringify(data),
      ...options,
    });
  }

  async submitSignedRegistryTx(data, options) {
    return this._request('/api/registry/submit-signed-tx', {
      method: 'POST',
      body: JSON.stringify(data),
      ...options,
    });
  }

  async submitReputation(id, data, options) {
    return this._request(`/api/reputation/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: JSON.stringify(data),
      ...options,
    });
  }

  // ── Agents ──────────────────────────────────────────────────────────────────

  async getAgents(params = {}, options) {
    const query = new URLSearchParams();
    if (params.page !== undefined) query.set('page', String(params.page));
    if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
    if (params.sort !== undefined) query.set('sort', String(params.sort));
    const qs = query.toString();
    return this._request(`/api/agents${qs ? `?${qs}` : ''}`, { method: 'GET', ...options });
  }

  async getAgentStats(options) {
    return this._request('/api/agents/stats', { method: 'GET', ...options });
  }

  async getAgent(address, options) {
    return this._request(`/api/agents/${encodeURIComponent(address)}`, {
      method: 'GET',
      ...options,
    });
  }

  async registerAgent(data, options) {
    return this._request('/api/agents/register', {
      method: 'POST',
      body: JSON.stringify(data),
      ...options,
    });
  }

  async getAgentEligibility(address, minScore, options) {
    return this._request(
      `/api/agents/${encodeURIComponent(address)}/eligible?min_score=${encodeURIComponent(minScore)}`,
      { method: 'GET', ...options }
    );
  }

  async checkAgentCanSpend(address, params = {}, options) {
    const query = new URLSearchParams();
    if (params.amount !== undefined) query.set('amount', String(params.amount));
    if (params.category !== undefined) query.set('category', String(params.category));
    if (params.amount_stroops !== undefined) query.set('amount_stroops', String(params.amount_stroops));
    const qs = query.toString();
    return this._request(
      `/api/agents/${encodeURIComponent(address)}/can-spend${qs ? `?${qs}` : ''}`,
      { method: 'GET', ...options }
    );
  }

  async recordAgentPayment(address, data, options) {
    return this._request(`/api/agents/${encodeURIComponent(address)}/payment`, {
      method: 'POST',
      body: JSON.stringify(data),
      ...options,
    });
  }

  async buildAgentTx(address, data, callerAddress, options = {}) {
    const headers = {
      ...(options.headers || {}),
      'x-caller-address': callerAddress,
    };
    return this._request(`/api/agents/${encodeURIComponent(address)}/build-tx`, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
      ...options,
    });
  }

  async submitSignedAgentTx(address, data, options) {
    return this._request(`/api/agents/${encodeURIComponent(address)}/submit-signed-tx`, {
      method: 'POST',
      body: JSON.stringify(data),
      ...options,
    });
  }

  // ── Activity ────────────────────────────────────────────────────────────────

  async getActivity(params = {}, options) {
    const query = new URLSearchParams();
    if (params.page !== undefined) query.set('page', String(params.page));
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    const qs = query.toString();
    return this._request(`/api/activity${qs ? `?${qs}` : ''}`, { method: 'GET', ...options });
  }

  async getDemoActivity(options) {
    return this._request('/demo/activity', { method: 'GET', ...options });
  }
}

export function createClient(options) {
  return new LodestarClient(options);
}
