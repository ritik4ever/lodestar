import { Router } from 'express';
import { paymentMiddlewareFromConfig } from '@x402/express';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactStellarScheme } from '@x402/stellar/exact/server';
import config from '../config.js';
import logger from '../lib/logger.js';
import { recordPaymentOnChain } from '../lib/contract.js';

const router = Router();

// Activity feed — in-memory store for demo purposes
const activityFeed = [];

export function recordActivity(entry) {
  activityFeed.unshift(entry);
  if (activityFeed.length > 50) activityFeed.pop();
}

export function getActivityFeed() {
  return activityFeed;
}

const facilitator = new HTTPFacilitatorClient({ url: config.x402.facilitatorUrl });
const stellarScheme = new ExactStellarScheme();

const paymentConfig = {
  'GET /demo/weather': {
    accepts: {
      scheme: 'exact',
      price: `$${config.x402.weatherPrice}`,
      network: 'stellar:testnet',
      payTo: config.server.address,
    },
    description: 'Real-time weather data via Lodestar',
  },
  'GET /demo/search': {
    accepts: {
      scheme: 'exact',
      price: `$${config.x402.searchPrice}`,
      network: 'stellar:testnet',
      payTo: config.server.address,
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
    });

    if (agentAddress && config.contract.agentsId) {
      const priceStroops = BigInt(Math.round(parseFloat(config.x402.weatherPrice) * 10_000_000));
      recordPaymentOnChain(agentAddress, priceStroops, true).catch((err) =>
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
    const q = req.query.q;
    if (!q) {
      return res.status(400).json({ error: 'Query parameter `q` is required', code: 'MISSING_QUERY' });
    }

    const response = await fetch(
      'https://google.serper.dev/search',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': config.braveApiKey,
        },
        body: JSON.stringify({ q, num: 5 }),
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
    });

    if (searchAgentAddress && config.contract.agentsId) {
      const priceStroops = BigInt(Math.round(parseFloat(config.x402.searchPrice) * 10_000_000));
      recordPaymentOnChain(searchAgentAddress, priceStroops, true).catch((err) =>
        logger.warn({ err, agentAddress: searchAgentAddress }, 'Failed to record search payment for agent')
      );
    }

    logger.info({ q }, 'Search request fulfilled');
    if (searchTxHash) res.setHeader('x-payment-transaction', searchTxHash);
    res.json({ query: q, results });
  } catch (err) {
    logger.error({ err }, 'GET /demo/search failed');
    res.status(500).json({ error: 'Search failed', code: 'SEARCH_ERROR' });
  }
});

router.get('/activity', (_req, res) => {
  res.json({ activity: getActivityFeed() });
});

export default router;
