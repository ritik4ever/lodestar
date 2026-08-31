import { AsyncLocalStorage } from 'node:async_hooks';
import pino from 'pino';
import config from '../config.js';

/**
 * Per-request async context used to propagate a `requestId` through the call
 * stack without explicit parameter threading.
 *
 * **Expected store shape:**
 * ```js
 * { requestId: string }
 * ```
 *
 * The store is populated by the `requestContextMiddleware` (see
 * `middleware/requestContext.js`) at the start of each HTTP request and read
 * automatically by the pino `mixin` inside {@link createLogger}, so every log
 * line emitted within that request's async context includes `requestId`.
 *
 * **Concurrency:** `AsyncLocalStorage` is safe to use across concurrent
 * requests — each continuation chain sees its own store. There is no shared
 * mutable state; callers may read (`getStore()`) or create new scopes
 * (`run()`) from any async context without synchronisation.
 *
 * @type {import('node:async_hooks').AsyncLocalStorage<{ requestId: string }>}
 */
export const requestContext = new AsyncLocalStorage();

/**
 * Create a new [pino](https://getpino.io/) logger instance.
 *
 * The returned logger automatically enriches every log entry with a
 * `requestId` field when one is present in the current
 * {@link requestContext} store.
 *
 * In development (`NODE_ENV=development`) **and** when no custom
 * `destination` is provided, the logger enables `pino-pretty` with
 * colourised output for local readability.
 *
 * **Concurrency:** The returned logger is safe to use from any number of
 * concurrent async contexts. Pino loggers serialise writes internally and
 * the `mixin` reads only the caller's own `AsyncLocalStorage` store, so
 * there is no cross-request interference.
 *
 * @param {import('pino').DestinationStream} [destination] — Optional writable
 *   stream (e.g. a file stream or `pino.destination()`). When omitted the
 *   logger writes to `process.stdout`. Passing a destination also disables
 *   the automatic `pino-pretty` transport in development, which is the
 *   desired behaviour for tests that capture structured JSON output.
 * @returns {import('pino').Logger} A configured pino logger instance.
 * @throws {never} This function does not throw. Invalid `destination` values
 *   are handled by pino itself at write-time, not at construction.
 */
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

/**
 * Singleton pino logger for the application, created once at module load via
 * {@link createLogger} with no custom destination (writes to `stdout`).
 *
 * All route handlers and middleware import this default export for day-to-day
 * logging. The logger automatically includes a `requestId` field when called
 * inside a scope established by `requestContextMiddleware`.
 *
 * **Concurrency:** Safe to call from any number of concurrent requests —
 * see {@link createLogger} for details.
 *
 * @type {import('pino').Logger}
 */
const logger = createLogger();

export default logger;
