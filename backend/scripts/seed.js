import 'dotenv/config';
import { Address } from '@stellar/stellar-sdk';
import config from '../src/config.js';
import { listServicesByProvider, registerServiceOnChain } from '../src/lib/contract.js';
import logger from '../src/lib/logger.js';



const SERVICES = [
  {
    name: 'Lodestar Weather Service',
    description: 'Real-time weather data for any coordinates. Returns temperature, wind speed, and weather code.',
    endpoint: 'https://lodestar-8na4.onrender.com/demo/weather',
    priceUsdc: '0.001',
    category: 'weather',
  },
  {
    name: 'Lodestar Search Service',
    description: 'Web search powered by Brave Search API. Returns top 5 results with title, URL, and description.',
    endpoint: 'https://lodestar-8na4.onrender.com/demo/search',
    priceUsdc: '0.001',
    category: 'search',
  },
  {
    name: 'Stellar Observatory',
    description: 'On-chain Stellar network analytics and monitoring data for agents.',
    endpoint: 'https://stellar-observatory.vercel.app',
    priceUsdc: '0.001',
    category: 'data',
  },
  {
    name: 'xlm402 News Service',
    description: 'AI-curated news feed from xlm402, delivered via x402 on Stellar testnet.',
    endpoint: 'https://xlm402.com/testnet/news/ai',
    priceUsdc: '0.01',
    category: 'data',
  },
];

async function seed() {
  try {
    const providerAddress = Address.fromString(config.server.address).toString();
    const existingServices = await listServicesByProvider(providerAddress);
    const existingNames = new Set(existingServices.map((s) => s.name));

    logger.info({
      total: SERVICES.length,
      existing: existingNames.size,
    }, 'Starting seed idempotency check');

    for (const svc of SERVICES) {
      if (existingNames.has(svc.name)) {
        logger.info({ name: svc.name }, 'Service already registered — skipping');
        continue;
      }

      try {
        const id = await registerServiceOnChain(
          svc.name,
          svc.description,
          svc.endpoint,
          svc.priceUsdc,
          svc.category
        );
        logger.info({ id, name: svc.name }, 'Registered service');
      } catch (err) {
        logger.error({ err, name: svc.name }, 'Failed to register service');
      }
    }

    logger.info('Seed complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Seed script failed');
    process.exit(1);
  }
}

seed();
