import { describe, it, expect, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../src/lib/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), fatal: vi.fn() },
}));

import logger from '../src/lib/logger.js';

function createApp() {
  const app = express();
  app.use(express.json());

  // Always-mounted non-demo route (specific path so it doesn't shadow demo routes)
  app.get('/api/services', (_req, res) => res.json({ route: 'registry' }));

  // Demo route gating — same logic as index.js
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const enableDemoRoutes =
    process.env.ENABLE_DEMO_ROUTES === 'true' ||
    (process.env.ENABLE_DEMO_ROUTES === undefined && nodeEnv !== 'production');

  if (enableDemoRoutes) {
    logger.info({ nodeEnv }, 'Demo routes enabled');
    app.post('/api/demo-run', (_req, res) => res.json({ route: 'demo-run' }));
    app.get('/demo/weather', (_req, res) => res.json({ route: 'demo-services' }));
  } else {
    logger.info({ nodeEnv }, 'Demo routes disabled (set ENABLE_DEMO_ROUTES=true to enable)');
  }

  return app;
}

// Store original env values so we can restore them
const originalEnableDemoRoutes = process.env.ENABLE_DEMO_ROUTES;
const originalNodeEnv = process.env.NODE_ENV;

describe('Demo route gating', () => {
  afterEach(() => {
    // Restore env after each test
    if (originalEnableDemoRoutes === undefined) {
      delete process.env.ENABLE_DEMO_ROUTES;
    } else {
      process.env.ENABLE_DEMO_ROUTES = originalEnableDemoRoutes;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    vi.clearAllMocks();
  });

  describe('when enabled', () => {
    it('mounts demo routes when ENABLE_DEMO_ROUTES=true even in production', async () => {
      process.env.ENABLE_DEMO_ROUTES = 'true';
      process.env.NODE_ENV = 'production';

      const app = createApp();

      const demoRunRes = await request(app).post('/api/demo-run').send({});
      expect(demoRunRes.status).toBe(200);
      expect(demoRunRes.body.route).toBe('demo-run');

      const weatherRes = await request(app).get('/demo/weather');
      expect(weatherRes.status).toBe(200);
      expect(weatherRes.body.route).toBe('demo-services');
    });

    it('mounts demo routes in development by default (no env var set)', async () => {
      delete process.env.ENABLE_DEMO_ROUTES;
      process.env.NODE_ENV = 'development';

      const app = createApp();

      const res = await request(app).get('/demo/weather');
      expect(res.status).toBe(200);
      expect(res.body.route).toBe('demo-services');
    });

    it('logs that demo routes are enabled', () => {
      process.env.ENABLE_DEMO_ROUTES = 'true';

      createApp();

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ nodeEnv: expect.any(String) }),
        'Demo routes enabled',
      );
    });
  });

  describe('when disabled', () => {
    it('does not mount demo routes in production by default', async () => {
      delete process.env.ENABLE_DEMO_ROUTES;
      process.env.NODE_ENV = 'production';

      const app = createApp();

      const demoRunRes = await request(app).post('/api/demo-run').send({});
      expect(demoRunRes.status).toBe(404);

      const weatherRes = await request(app).get('/demo/weather');
      expect(weatherRes.status).toBe(404);
    });

    it('does not mount demo routes when ENABLE_DEMO_ROUTES is explicitly false', async () => {
      process.env.ENABLE_DEMO_ROUTES = 'false';
      process.env.NODE_ENV = 'development';

      const app = createApp();

      const demoRunRes = await request(app).post('/api/demo-run').send({});
      expect(demoRunRes.status).toBe(404);

      const weatherRes = await request(app).get('/demo/weather');
      expect(weatherRes.status).toBe(404);
    });

    it('logs the disabled state', () => {
      delete process.env.ENABLE_DEMO_ROUTES;
      process.env.NODE_ENV = 'production';

      createApp();

      expect(logger.info).toHaveBeenCalledWith(
        { nodeEnv: 'production' },
        'Demo routes disabled (set ENABLE_DEMO_ROUTES=true to enable)',
      );
    });
  });
});
