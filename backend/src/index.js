import express from 'express';
import cors from 'cors';
import config from './config.js';
import logger from './lib/logger.js';
import registryRouter from './routes/registry.js';
import servicesRouter from './routes/services.js';

const app = express();

app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json());

app.use('/api', registryRouter);
app.use('/demo', servicesRouter);

app.use((err, _req, res, _next) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
  });
});

app.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      network: config.stellar.network,
      contractId: config.contract.id,
    },
    'Lodestar backend running'
  );
});
