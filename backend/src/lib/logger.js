import { AsyncLocalStorage } from 'node:async_hooks';
import pino from 'pino';
import config from '../config.js';

export const requestContext = new AsyncLocalStorage();

export function createLogger(destination) {
  const options = {
    level: config.logLevel,
    mixin() {
      const context = requestContext.getStore();

      return context?.requestId
        ? { requestId: context.requestId }
        : {};
    },
    ...(!destination && config.nodeEnv === 'development'
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true },
          },
        }
      : {}),
  };

  return pino(options, destination);
}

const logger = createLogger();

export default logger;
