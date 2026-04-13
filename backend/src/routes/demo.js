import { Router } from 'express';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { createEd25519Signer } from '@x402/stellar';
import { ExactStellarScheme } from '@x402/stellar/exact/client';
import config from '../config.js';
import logger from '../lib/logger.js';
import { getService } from '../lib/contract.js';
import { recordActivity } from './services.js';

const router = Router();

function buildHttpClient() {
  const signer = createEd25519Signer(config.server.secret, 'stellar:testnet');
  const scheme = new ExactStellarScheme(signer, { url: config.stellar.rpcUrl });
  const x402 = new x402Client().register('stellar:*', scheme);
  const httpClient = new x402HTTPClient(x402);

  httpClient.fetch = async (url, init = {}) => {
    const probe = await fetch(url, init);
    if (probe.status !== 402) return probe;

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

    // Extract tx hash from PAYMENT-RESPONSE header and expose as x-payment-transaction
    try {
      const settle = httpClient.getPaymentSettleResponse((name) => paid.headers.get(name));
      if (settle?.transaction) {
        // Attach tx hash so caller can read it via response.headers.get('x-payment-transaction')
        const origGet = paid.headers.get.bind(paid.headers);
        paid.headers.get = (key) =>
          key.toLowerCase() === 'x-payment-transaction' ? settle.transaction : origGet(key);
      }
    } catch {
      // non-critical
    }

    return paid;
  };

  return httpClient;
}

router.post('/demo-run', async (req, res) => {
  try {
    const { serviceId, category } = req.body;

    if (!serviceId || !category) {
      return res.status(400).json({ error: 'serviceId and category are required', code: 'INVALID_BODY' });
    }

    const service = await getService(Number(serviceId));
    if (!service) {
      return res.status(404).json({ error: 'Service not found', code: 'NOT_FOUND' });
    }

    // Always use internal loopback — registry may store localhost from seed time
    const baseUrl = `http://127.0.0.1:${config.port}`;
    let endpointUrl = service.endpoint.replace(/https?:\/\/[^/]+/, baseUrl);

    if (category === 'weather') {
      endpointUrl += '?lat=40.7128&lon=-74.0060';
    } else if (category === 'search') {
      endpointUrl += '?q=Stellar+blockchain+AI+agents';
    }

    const httpClient = buildHttpClient();

    const response = await httpClient.fetch(endpointUrl);

    if (!response.ok) {
      throw new Error(`Service responded with ${response.status}`);
    }

    const data = await response.json();

    const txHash = response.headers.get('x-payment-transaction') ?? '';

    recordActivity({
      timestamp: new Date().toISOString(),
      agent: config.server.address,
      service: service.name,
      amount: service.price_usdc,
      txHash,
    });

    logger.info({ serviceId, category, txHash }, 'Demo run complete');
    res.json({ data, txHash });
  } catch (err) {
    logger.error({ err }, 'POST /api/demo-run failed');
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Demo run failed',
      code: 'DEMO_ERROR',
    });
  }
});

export default router;
