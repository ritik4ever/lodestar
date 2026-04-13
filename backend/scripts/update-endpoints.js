import 'dotenv/config';
import { listServices, registerServiceOnChain } from '../src/lib/contract.js';
import logger from '../src/lib/logger.js';

const RENDER_URL = 'https://lodestar-8na4.onrender.com';

async function update() {
  try {
    const weather = await listServices('weather');
    const search = await listServices('search');
    const all = [...weather, ...search];

    const needsUpdate = all.filter((s) => s.endpoint.includes('localhost'));

    if (!needsUpdate.length) {
      logger.info('All endpoints already point to Render — nothing to do');
      process.exit(0);
    }

    for (const svc of needsUpdate) {
      const newEndpoint = svc.endpoint.replace(/https?:\/\/localhost:\d+/, RENDER_URL);
      logger.info({ name: svc.name, newEndpoint }, 'Re-registering with Render URL…');

      const newId = await registerServiceOnChain(
        svc.name,
        svc.description,
        newEndpoint,
        svc.price_usdc,
        svc.category
      );
      logger.info({ name: svc.name, newId }, 'Done');
    }

    logger.info('All endpoints updated. New services registered with Render URLs.');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'update-endpoints failed');
    process.exit(1);
  }
}

update();
