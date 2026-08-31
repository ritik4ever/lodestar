import { Writable } from 'node:stream';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import logger, { createLogger } from '../lib/logger.js';
import {
  requestLogger,
  createRequestLogger,
  requestContextMiddleware,
} from './requestContext.js';

function createLogCapture() {
  const logs = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      logs.push(JSON.parse(chunk.toString()));
      callback();
    },
  });

  return {
    logs,
    logger: createLogger(destination),
  };
}

function createApp({
  appLogger = logger,
  httpLogger = requestLogger,
} = {}) {
  const app = express();

  app.use(httpLogger);
  app.use(requestContextMiddleware);
  app.use(express.json());

  app.get('/success', (req, res) => {
    req.log.info('Successful correlated request');
    res.json({
      success: true,
      requestIdFromRequest: req.id,
    });
  });

  app.get('/global-log', (_req, res) => {
    appLogger.info('Global logger inside request context');
    res.json({ success: true });
  });

  app.get('/failure', (_req, res) => {
    res.status(400).json({
      error: 'Bad request',
      code: 'BAD_REQUEST',
    });
  });

  app.get('/existing-request-id', (_req, res) => {
    res.status(500).json({
      error: 'Failed',
      requestId: 'existing-id',
    });
  });

  return app;
}

describe('request correlation middleware', () => {
  it('generates a request ID and returns it in the response header', async () => {
    const response = await request(createApp()).get('/success');

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBeTruthy();
    expect(response.body.requestIdFromRequest).toBe(
      response.headers['x-request-id'],
    );
  });

  it('honours an inbound X-Request-Id header', async () => {
    const response = await request(createApp())
      .get('/success')
      .set('X-Request-Id', 'client-request-123');

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBe('client-request-123');
    expect(response.body.requestIdFromRequest).toBe('client-request-123');
  });

  it('includes the request ID in error response bodies', async () => {
    const response = await request(createApp())
      .get('/failure')
      .set('X-Request-Id', 'failed-request-456');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Bad request',
      code: 'BAD_REQUEST',
      requestId: 'failed-request-456',
    });
  });

  it('does not overwrite an existing requestId in an error body', async () => {
    const response = await request(createApp())
      .get('/existing-request-id')
      .set('X-Request-Id', 'header-id');

    expect(response.status).toBe(500);
    expect(response.body.requestId).toBe('existing-id');
    expect(response.headers['x-request-id']).toBe('header-id');
  });

  it('adds the request ID to req.log output', async () => {
    const capture = createLogCapture();
    const app = createApp({
      appLogger: capture.logger,
      httpLogger: createRequestLogger(capture.logger),
    });

    const response = await request(app)
      .get('/success')
      .set('X-Request-Id', 'request-log-request');

    expect(response.status).toBe(200);
    expect(
      capture.logs.some(
        (entry) =>
          entry.msg === 'Successful correlated request' &&
          entry.requestId === 'request-log-request',
      ),
    ).toBe(true);
  });

  it('adds the request ID to global logger output', async () => {
    const capture = createLogCapture();
    const app = createApp({
      appLogger: capture.logger,
      httpLogger: createRequestLogger(capture.logger),
    });

    const response = await request(app)
      .get('/global-log')
      .set('X-Request-Id', 'global-log-request');

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBe('global-log-request');
    expect(
      capture.logs.some(
        (entry) =>
          entry.msg === 'Global logger inside request context' &&
          entry.requestId === 'global-log-request',
      ),
    ).toBe(true);
  });
});
