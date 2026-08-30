import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { createEd25519Signer } from '@x402/stellar';
import { ExactStellarScheme } from '@x402/stellar/exact/client';
import config from '../config.js';
import logger from '../lib/logger.js';
import { getService } from '../lib/contract.js';
import { waitForActivityTxHash } from '../lib/waitForActivityTxHash.js';
import { recordActivity, getActivityFeed } from './services.js';
import { validateDemoEndpoint } from './demoValidate.js';

const router = Router();

function buildHttpClient() {
  const signer = createEd25519Signer(config.server.secret, 'stellar:testnet');
  const scheme = new ExactStellarScheme(signer, { url: config.stellar.rpcUrl });
  const x402 = new x402Client().register('stellar:*', scheme);
  const httpClient = new x402HTTPClient(x402);

  // Returns { response, txHash }
  httpClient.fetchWithTx = async (url, init = {}) => {
    const probe = await fetch(url, init);
    if (probe.status !== 402) return { response: probe, txHash: '' };

    const body = await probe.json().catch(() => undefined);
    const paymentRequired = httpClient.getPaymentRequiredResponse(
      (name) => probe.headers.get(name),
      body
    );

    const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
    const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);

    const paid = await fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), ...paymentHeaders },
    });

    // Extract the transaction hash from response headers if present
    const txHash = paid.headers.get('x-payment-transaction') || '';
    return { response: paid, txHash };
  };

  return httpClient;
}

router.post('/demo-run', async (req, res) => {
  // Wire the abort plumbing once, up front, so a client disconnect propagates
  // through the WHOLE handler — including the waitForActivityTxHash polling
  // phase — and not just the fetchWithTx call.
  const abortController = new AbortController();
  const onClose = () => abortController.abort();
  req.on('close', onClose);

  try {
    const { serviceId, category } = req.body;

    if (!serviceId || !category) {
      return res.status(400).json({ error: 'serviceId and category are required', code: 'INVALID_BODY' });
    }

    const service = await getService(Number(serviceId));
    if (!service) {
      return res.status(404).json({ error: 'Service not found', code: 'NOT_FOUND' });
    }

    // Validate and sanitize the endpoint URL to prevent SSRF
    let endpointUrl;
    try {
      endpointUrl = validateDemoEndpoint(service.endpoint, category);
    } catch (e) {
      return res.status(400).json({ error: e.message, code: e.code || 'ENDPOINT_NOT_ALLOWED' });
    }

    const demoRunId = randomUUID();
    const endpoint = new URL(endpointUrl);
    
    // Append category‑specific query parameters
    if (category === 'weather') {
      endpoint.searchParams.set('lat', '40.7128');
      endpoint.searchParams.set('lon', '-74.0060');
    } else if (category === 'search') {
      endpoint.searchParams.set('q', 'Stellar blockchain AI agents');
    }
    
    endpoint.searchParams.set('demoRunId', demoRunId);
    const finalEndpointUrl = endpoint.toString();

    const httpClient = buildHttpClient();
    const activityCountBefore = getActivityFeed().length;

    const { response, txHash: fetchedTxHash } = await httpClient.fetchWithTx(finalEndpointUrl, { signal: abortController.signal });

    if (!response.ok) {
      throw new Error(`Service responded with ${response.status}`);
    }

    const data = await response.json();

    // Evaluate data quality: the response must be a non-null object (or a
    // non-empty array) and must not carry a top-level `error` field.
    const dataValid =
      data !== null &&
      typeof data === 'object' &&
      !('error' in data) &&
      (Array.isArray(data) ? data.length > 0 : Object.keys(data).length > 0);

    if (!dataValid) {
      logger.warn({ serviceId, category }, 'Demo run returned empty or error payload — marking data invalid');
    }

    // Poll cost is logged per wait so the RPC budget a wait spends is visible
    // in production, not just inferred from the backoff settings (#852).
    let pollSample = null;
    const txHash = fetchedTxHash || (await waitForActivityTxHash(
      getActivityFeed,
      activityCountBefore,
      {
        maxWaitMs: config.demoRun.pollMaxWaitMs,
        initialDelayMs: config.demoRun.pollInitialDelayMs,
        maxDelayMs: config.demoRun.pollMaxDelayMs,
        signal: abortController.signal,
        onPollSample: (sample) => { pollSample = sample; },
      },
      (entry) => entry.demoRunId === demoRunId,
    ));

    if (pollSample) {
      logger.info(
        {
          event: 'activity_poll_complete',
          serviceId,
          category,
          polls: pollSample.polls,
          sleeps: pollSample.sleeps,
          totalDelayMs: pollSample.totalDelayMs,
          durationMs: pollSample.durationMs,
          outcome: pollSample.outcome,
        },
        'Activity poll finished',
      );
    }
    if (!txHash) {
      logger.warn({ serviceId, category, maxWaitMs: config.demoRun.pollMaxWaitMs }, 'Activity txHash not found before poll timeout');
    }

    recordActivity({
      timestamp: new Date().toISOString(),
      agent: config.server.address,
      service: service.name,
      amount: service.price_usdc,
      txHash,
    });

    logger.info({ serviceId, category, txHash, dataValid }, 'Demo run complete');
    res.json({ data, txHash, dataValid });
  } catch (err) {
    if (err.name === 'AbortError') {
      logger.info({ serviceId: req.body?.serviceId, category: req.body?.category }, 'Demo run aborted by client');
      return res.status(499).json({ error: 'Request cancelled', code: 'CANCELLED' });
    }
    logger.error({ err }, 'POST /api/demo-run failed');
    res.status(500).json({ error: err instanceof Error ? err.message : 'Demo run failed', code: 'DEMO_ERROR' });
  } finally {
    req.removeListener('close', onClose);
  }
});

export default router;
