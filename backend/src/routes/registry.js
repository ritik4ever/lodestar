import { Router } from 'express';
import {
  listServices,
  getService,
  getServiceCount,
  updateReputation,
} from '../lib/contract.js';
import logger from '../lib/logger.js';

const router = Router();

router.get('/services', async (req, res) => {
  try {
    const { category } = req.query;
    const services = await listServices(category || undefined);
    res.json({ services, count: services.length });
  } catch (err) {
    logger.error({ err }, 'GET /api/services failed');
    res.status(500).json({ error: 'Failed to fetch services', code: 'FETCH_ERROR' });
  }
});

router.get('/services/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid service ID', code: 'INVALID_ID' });
    }
    const service = await getService(id);
    if (!service) {
      return res.status(404).json({ error: 'Service not found', code: 'NOT_FOUND' });
    }
    res.json(service);
  } catch (err) {
    logger.error({ err, id: req.params.id }, 'GET /api/services/:id failed');
    res.status(500).json({ error: 'Failed to fetch service', code: 'FETCH_ERROR' });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const [services, totalServices] = await Promise.all([
      listServices(),
      getServiceCount(),
    ]);

    const categories = [...new Set(services.map((s) => s.category))];
    const latestService = services.reduce(
      (latest, s) => (s.registered_at > (latest?.registered_at ?? 0) ? s : latest),
      null
    );

    res.json({ totalServices, categories, latestService });
  } catch (err) {
    logger.error({ err }, 'GET /api/stats failed');
    res.status(500).json({ error: 'Failed to fetch stats', code: 'FETCH_ERROR' });
  }
});

router.post('/reputation/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid service ID', code: 'INVALID_ID' });
    }

    const { positive } = req.body;
    if (typeof positive !== 'boolean') {
      return res
        .status(400)
        .json({ error: '`positive` must be a boolean', code: 'INVALID_BODY' });
    }

    const newReputation = await updateReputation(id, positive);
    res.json({ success: true, newReputation });
  } catch (err) {
    logger.error({ err, id: req.params.id }, 'POST /api/reputation/:id failed');
    res.status(500).json({ error: 'Failed to update reputation', code: 'UPDATE_ERROR' });
  }
});

router.get('/health', async (req, res) => {
  const { default: config } = await import('../config.js');
  res.json({
    status: 'ok',
    network: config.stellar.network,
    contractId: config.contract.id,
    timestamp: new Date().toISOString(),
  });
});

export default router;
