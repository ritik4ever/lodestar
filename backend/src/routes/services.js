import { Router } from 'express';
import { paymentMiddlewareFromConfig } from '@x402/express';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactStellarScheme } from '@x402/stellar/exact/server';
import config from '../config.js';
import logger from '../lib/logger.js';
import { recordPaymentOnChain, getAgent } from '../lib/contract.js';
import { usdcToStroops } from '../lib/stroops.js';
import { isValidStellarAddress } from '../middleware/addressValidator.js';

const router = Router();

// Validates and records a payment on-chain. All three guards (txHash presence,
// address format, and agent registration) must pass before touching the contract,
// so a forged or bypass-injected x-payment-address header is silently discarded.
const WEATHER_SERVICE_ID = 1;
const SEARCH_SERVICE_ID = 2;

// Validates and records a payment on-chain. All three guards (txHash presence,
// address format, and agent registration) must pass before touching the contract,
// so a forged or bypass-injected x-payment-address header is silently discarded.
async function creditPayment(agentAddress, txHash, serviceId, priceStroops, serviceLabel) {
  if (!txHash) {
    logger.warn(
      { agentAddress },
      `${serviceLabel} payment skipped: x-payment-transaction header absent (possible middleware bypass)`
    );
    return;
  }
  if (!isValidStellarAddress(agentAddress)) {
    logger.warn(
      { agentAddress },
      `${serviceLabel} payment skipped: x-payment-address fails Stellar address validation`
    );
    return;
  }
  const agent = await getAgent(agentAddress);
  if (!agent) {
    logger.warn(
      { agentAddress },
      `${serviceLabel} payment skipped: agent not registered on-chain`
    );
    return;
  }

  await recordPaymentOnChain(agentAddress, serviceId, priceStroops, true);

  logger.info({ agentAddress, txHash }, `${serviceLabel} payment credited to registered agent`);
}

// Activity feed lives in its own dependency-free module so the feed and
// pagination logic stay unit-testable in isolation.
export {
  recordActivity,
  getActivityFeed,
  parseActivityPagination,
  ACTIVITY_MAX_ENTRIES,
  ACTIVITY_DEFAULT_LIMIT,
  ACTIVITY_MAX_LIMIT,
} from '../lib/activityFeed.js';

import {
  recordActivity,
  getActivityFeed,
  parseActivityPagination,
} from '../lib/activityFeed.js';

const facilitator = new HTTPFacilitatorClient({ url: config.x402.facilitatorUrl });
const stellarScheme = new ExactStellarScheme();

const paymentConfig = {
  'GET /demo/weather': {
    accepts: {
      scheme: 'exact',
      price: `$${config.x402.weatherPrice}`,
      network: 'stellar:testnet',
      payTo: config.x402.payTo,
    },
    description: 'Real-time weather data via Lodestar',
  },
  'GET /demo/search': {
    accepts: {
      scheme: 'exact',
      price: `$${config.x402.searchPrice}`,
      network: 'stellar:testnet',
      payTo: config.x402.payTo,
    },
    description: 'Web search results via Lodestar',
  },
};

router.use(
  paymentMiddlewareFromConfig(paymentConfig, facilitator, [
    { network: 'stellar:testnet', server: stellarScheme },
  ])
);

router.get('/weather', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat) || 40.7128;
    const lon = parseFloat(req.query.lon) || -74.006;

    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      logger.warn({ lat, lon }, 'Invalid coordinates supplied to GET /demo/weather');
      return res.status(400).json({ error: 'Coordinates out of range', code: 'INVALID_COORDINATES' });
    }

    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,wind_speed_10m,weather_code` +
      `&forecast_days=1`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Open-Meteo error: ${response.status}`);
    }

    const data = await response.json();
    const current = data.current;

    const result = {
      latitude: lat,
      longitude: lon,
      temperature_c: current.temperature_2m,
      wind_speed_kmh: current.wind_speed_10m,
      weather_code: current.weather_code,
      time: current.time,
    };

    const agentAddress = req.headers['x-payment-address'] ?? '';
    const txHash = req.headers['x-payment-transaction'] ?? '';

    recordActivity({
      timestamp: new Date().toISOString(),
      agent: agentAddress || 'unknown',
      service: 'Lodestar Weather Service',
      amount: config.x402.weatherPrice,
      txHash,
      ...(req.query.demoRunId && { demoRunId: String(req.query.demoRunId) }),
    });

    if (agentAddress && config.contract.agentsId) {
      const priceStroops = usdcToStroops(config.x402.weatherPrice);
      creditPayment(agentAddress, txHash, WEATHER_SERVICE_ID, priceStroops, 'weather').catch((err) =>
        logger.warn({ err, agentAddress }, 'Failed to record weather payment for agent')
      );
    }

    logger.info({ lat, lon }, 'Weather request fulfilled');
    if (txHash) res.setHeader('x-payment-transaction', txHash);
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'GET /demo/weather failed');
    res.status(500).json({ error: 'Weather fetch failed', code: 'WEATHER_ERROR' });
  }
});

router.get('/search', async (req, res) => {
  try {
    const rawQuery = req.query.q;
    if (!rawQuery) {
      return res.status(400).json({ error: 'Query parameter `q` is required', code: 'MISSING_QUERY' });
    }

    const sanitizedQ = String(rawQuery)
      .trim()
      .replace(/[\u0000-\u001F\u007F]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (sanitizedQ.length === 0 || sanitizedQ.length > 256) {
      logger.warn({ rawQuery }, 'Invalid search query supplied to GET /demo/search');
      return res.status(400).json({ error: 'Search query is invalid or too long', code: 'INVALID_QUERY' });
    }

    const response = await fetch(
      'https://google.serper.dev/search',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': config.braveApiKey,
        },
        body: JSON.stringify({ q: sanitizedQ, num: 5 }),
      }
    );

    if (!response.ok) {
      throw new Error(`Serper Search error: ${response.status}`);
    }

    const data = await response.json();
    const results = (data.organic ?? []).slice(0, 5).map((r) => ({
      title: r.title,
      url: r.link,
      description: r.snippet,
    }));

    const searchAgentAddress = req.headers['x-payment-address'] ?? '';
    const searchTxHash = req.headers['x-payment-transaction'] ?? '';

    recordActivity({
      timestamp: new Date().toISOString(),
      agent: searchAgentAddress || 'unknown',
      service: 'Lodestar Search Service',
      amount: config.x402.searchPrice,
      txHash: searchTxHash,
      ...(req.query.demoRunId && { demoRunId: String(req.query.demoRunId) }),
    });

    if (searchAgentAddress && config.contract.agentsId) {
      const priceStroops = usdcToStroops(config.x402.searchPrice);
      creditPayment(searchAgentAddress, searchTxHash, SEARCH_SERVICE_ID, priceStroops, 'search').catch((err) =>
        logger.warn({ err, agentAddress: searchAgentAddress }, 'Failed to record search payment for agent')
      );
    }

    logger.info({ q: sanitizedQ }, 'Search request fulfilled');
    if (searchTxHash) res.setHeader('x-payment-transaction', searchTxHash);
    res.json({ query: sanitizedQ, results });
  } catch (err) {
    logger.error({ err }, 'GET /demo/search failed');
    res.status(500).json({ error: 'Search failed', code: 'SEARCH_ERROR' });
  }
});

router.get('/activity', (req, res) => {
  const { limit, offset, errors } = parseActivityPagination(req.query);
  if (errors.length > 0) {
    logger.warn({ query: req.query, errors }, 'Invalid activity pagination params');
    return res.status(400).json({ error: errors.join('; '), code: 'INVALID_PAGINATION' });
  }

  const feed = getActivityFeed();
  const total = feed.length;
  const items = feed.slice(offset, offset + limit);
  const hasMore = offset + items.length < total;

  logger.info({ limit, offset, total, returned: items.length }, 'Activity feed served');
  res.json({
    activity: items,
    pagination: { total, limit, offset, hasMore },
  });
});

export default router;
