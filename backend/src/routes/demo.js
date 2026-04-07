import { Router } from 'express';
import { x402Client, x402HTTPClient } from '@x402/fetch';
import { createEd25519Signer } from '@x402/stellar';
import { ExactStellarScheme } from '@x402/stellar/exact/client';
import { Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import config from '../config.js';
import logger from '../lib/logger.js';
import { getService } from '../lib/contract.js';
import { recordActivity } from './services.js';

const router = Router();

function buildHttpClient() {
  const signer = createEd25519Signer(config.server.secret, 'stellar:testnet');
  const passphrase = config.stellar.networkPassphrase;

  const scheme = new ExactStellarScheme(signer, { url: config.stellar.rpcUrl });

  const client = new x402Client().register('stellar:*', scheme);
  return { httpClient: new x402HTTPClient(client), passphrase };
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

    let endpointUrl = service.endpoint;
    if (category === 'weather') {
      endpointUrl += '?lat=40.7128&lon=-74.0060';
    } else if (category === 'search') {
      endpointUrl += '?q=Stellar+blockchain+AI+agents';
    }

    const { httpClient } = buildHttpClient();

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
