import 'dotenv/config';
import { getServiceCount, registerServiceOnChain } from '../src/lib/contract.js';
import logger from '../src/lib/logger.js';

const SERVICES = [
  {
    name: 'Lodestar Weather Service',
    description: 'Real-time weather data for any coordinates. Returns temperature, wind speed, and weather code.',
    endpoint: 'http://localhost:3001/demo/weather',
    priceUsdc: '0.001',
    category: 'weather',
  },
  {
    name: 'Lodestar Search Service',
    description: 'Web search powered by Brave Search API. Returns top 5 results with title, URL, and description.',
    endpoint: 'http://localhost:3001/demo/search',
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
    const count = await getServiceCount();
    logger.info({ count }, 'Current service count');

    if (count >= SERVICES.length) {
      logger.info('Registry already seeded — skipping');
      process.exit(0);
    }

    for (const svc of SERVICES) {
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
