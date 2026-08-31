import 'dotenv/config';

const required = [
  'CONTRACT_ID',
  'SERVER_STELLAR_ADDRESS',
  'SERVER_STELLAR_SECRET',
  'STELLAR_RPC_URL',
  'STELLAR_NETWORK_PASSPHRASE',
  'FACILITATOR_URL',
  'USDC_CONTRACT_ID',
];


/**
 * Parse a positive-integer env var, falling back to a safe default when the
 * value is missing, non-numeric, or non-positive. Logs a warning so a typo in
 * a rate-limit setting can't silently disable throttling (NaN/0 limits).
 */
function parsePositiveInt(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.warn(
      `[config] Invalid ${name}="${value}" (expected a positive integer). Using fallback ${fallback}.`,
    );
    return fallback;
  }
  return parsed;
}

/**
 * Parse the Express `trust proxy` setting from env. Accepts:
 *   - "true"/"false"        → boolean
 *   - a non-negative integer → number of trusted proxy hops
 *   - any other string       → passed through (IP/subnet list)
 * Defaults to false (no proxy trusted) — the safe choice that prevents clients
 * from spoofing X-Forwarded-For to bypass IP-based rate limiting.
 */
function parseTrustProxy(value) {
  if (value === undefined || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  const num = Number(value);
  if (Number.isInteger(num) && num >= 0) return num;
  return value;
}


const config = Object.freeze({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3001', 10),
  logLevel: process.env.LOG_LEVEL ?? 'info',

  stellar: {
    network: process.env.STELLAR_NETWORK ?? 'testnet',
    rpcUrl: process.env.STELLAR_RPC_URL,
    networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE,
    usdcContractId: process.env.USDC_CONTRACT_ID,
  },

  contract: {
    id: process.env.CONTRACT_ID,
    agentsId: process.env.AGENTS_CONTRACT_ID ?? null,
  },

  // Warn at startup if AGENTS_CONTRACT_ID is missing so operators spot it
  // before hitting 503 AGENTS_NOT_CONFIGURED in production.
  // The distinction: null means "agents contract not deployed yet" (expected for
  // plain service listings), whereas a malformed ID would cause on-chain failures.
  // If credit scoring is a requirement for your deployment, set this env var.
  _agentsConfigured: process.env.AGENTS_CONTRACT_ID !== undefined,

  server: {
    address: process.env.SERVER_STELLAR_ADDRESS,
    secret: process.env.SERVER_STELLAR_SECRET,
  },

  x402: {
    facilitatorUrl: process.env.FACILITATOR_URL,
    searchPrice: process.env.SEARCH_PRICE ?? '0.001',
    weatherPrice: process.env.WEATHER_PRICE ?? '0.001',
    payTo: process.env.PAYMENT_ADDRESS || process.env.SERVER_STELLAR_ADDRESS,
  },

  braveApiKey: process.env.BRAVE_API_KEY ?? '',

  corsOrigin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
    : ['http://localhost:3000'],

  // Whether CORS_ORIGIN was explicitly provided (vs. the localhost fallback
  // above). Used by validateConfig() to fail startup in production instead
  // of silently trusting localhost.
  _corsOriginExplicit: Boolean(process.env.CORS_ORIGIN),

  jsonBodyLimit: process.env.JSON_BODY_LIMIT ?? '100kb',

  redisUrl: process.env.REDIS_URL,

  // Trust proxy setting for Express — required so rate limiting reads the real
  // client IP (X-Forwarded-For) when running behind a reverse proxy (e.g. Render).
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),

  // Reputation voting is gated on-chain: a vote must be signed by a registered
  // agent (`caller.require_auth()` + cross-contract `is_registered`). The hosted
  // backend can therefore only cast votes for agents whose secret keys it holds.
  // `voterSecrets` is that allowlist of demo-agent signing keys. The server key
  // always doubles as a demo voter; additional pre-funded, on-chain-registered
  // demo agents can be added via DEMO_VOTER_SECRETS (comma-separated). Any other
  // agent must submit its own wallet-signed transaction.
  demo: {
    voterSecrets: [
      process.env.SERVER_STELLAR_SECRET,
      ...(process.env.DEMO_VOTER_SECRETS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ],
  },

  // Rate limiting for public write endpoints (anti-spam for on-chain writes).
  rateLimit: {
    // Generic limit applied to write routes (POST /reputation/:id, POST /agents/register).
    windowMs: parsePositiveInt(process.env.RATE_LIMIT_WINDOW_MS, 60_000, 'RATE_LIMIT_WINDOW_MS'),
    max: parsePositiveInt(process.env.RATE_LIMIT_MAX, 20, 'RATE_LIMIT_MAX'),
    // Tighter, per-agent limit for the payment route.
    payment: {
      windowMs: parsePositiveInt(process.env.PAYMENT_RATE_LIMIT_WINDOW_MS, 60_000, 'PAYMENT_RATE_LIMIT_WINDOW_MS'),
      max: parsePositiveInt(process.env.PAYMENT_RATE_LIMIT_MAX, 10, 'PAYMENT_RATE_LIMIT_MAX'),
    },
  },

  demoRun: {
    pollMaxWaitMs: parsePositiveInt(process.env.DEMO_RUN_POLL_MAX_WAIT_MS, 8_000, 'DEMO_RUN_POLL_MAX_WAIT_MS'),
    pollInitialDelayMs: parsePositiveInt(process.env.DEMO_RUN_POLL_INITIAL_DELAY_MS, 250, 'DEMO_RUN_POLL_INITIAL_DELAY_MS'),
    pollMaxDelayMs: parsePositiveInt(process.env.DEMO_RUN_POLL_MAX_DELAY_MS, 2_000, 'DEMO_RUN_POLL_MAX_DELAY_MS'),
  },

  // Graceful shutdown: how long (ms) to wait for the submit queue to drain
  // and pending transaction checks before force-exiting. Default is just over
  // the max polling window (30 s) so an in-flight poll can finish.
  shutdownTimeoutMs: parsePositiveInt(process.env.SHUTDOWN_TIMEOUT_MS, 35_000, 'SHUTDOWN_TIMEOUT_MS'),

  // RPC retry with jittered exponential backoff for transient failures.
  // 429 (rate-limited) and 5xx responses from public Stellar RPC endpoints are
  // retried automatically so a brief throttle doesn't become a user-visible
  // failure. Each retry delays baseDelayMs * 2^attempt with ±50 % jitter, capped
  // at maxDelayMs. After maxRetries the call fails with code RPC_THROTTLED.
  rpcRetry: {
    maxRetries: parsePositiveInt(process.env.RPC_RETRY_MAX_RETRIES, 4, 'RPC_RETRY_MAX_RETRIES'),
    baseDelayMs: parsePositiveInt(process.env.RPC_RETRY_BASE_DELAY_MS, 200, 'RPC_RETRY_BASE_DELAY_MS'),
    maxDelayMs: parsePositiveInt(process.env.RPC_RETRY_MAX_DELAY_MS, 5_000, 'RPC_RETRY_MAX_DELAY_MS'),
  },
});

export default config;

// Fallback logger used when validateConfig() is called without a pino instance
// (e.g. the operator dry-run: node -e "import('./src/config.js').then(m => m.validateConfig())")
const _consoleLog = {
  fatal: (obj, msg) => console.error(`FATAL: ${msg}`, JSON.stringify(obj)),
  warn: (msg) => console.warn(`WARN: ${msg}`),
};

/**
 * Validate all required environment variables and format constraints in a single
 * pass. Logs every problem at once before exiting so operators don't have to
 * restart the process to discover each missing variable one-by-one.
 *
 * Pass a pino logger instance so errors are emitted as structured JSON.
 * Omit it (or call from a script) and it falls back to console output.
 */
export function validateConfig(log = _consoleLog) {
  const missing = required.filter((key) => !process.env[key]);
  const errors = missing.map((k) => `${k} is not set`);

  if (
    process.env.PAYMENT_ADDRESS &&
    !/^G[A-Z2-7]{55}$/.test(process.env.PAYMENT_ADDRESS)
  ) {
    errors.push(
      `Invalid PAYMENT_ADDRESS="${process.env.PAYMENT_ADDRESS}" — must be a valid G... Stellar address`,
    );
  }

  // A forgotten CORS_ORIGIN in production silently falls back to
  // http://localhost:3000, which fails closed for real users but is
  // confusing to diagnose. Require it to be set explicitly instead.
  if (config.nodeEnv === 'production' && !config._corsOriginExplicit) {
    errors.push(
      'CORS_ORIGIN must be set explicitly when NODE_ENV=production (refusing to fall back to http://localhost:3000)',
    );
  }

  // credentials: true is always enabled on the CORS middleware (see index.js),
  // so an origin of "*" is both spec-invalid and a footgun that would trust
  // any site with credentialed requests. Reject it in every environment.
  if (config.corsOrigin.includes('*')) {
    errors.push(
      "CORS_ORIGIN cannot include '*' because CORS is mounted with credentials: true — list explicit origin(s) instead",
    );
  }

  if (errors.length > 0) {
    log.fatal(
      { missingVars: missing, errors },
      `Server startup failed: missing required environment variables: ${missing.join(', ')}`,
    );
    process.exit(1);
  }

  if (!process.env.AGENTS_CONTRACT_ID) {
    log.warn(
      'AGENTS_CONTRACT_ID is not set. Agent credit scoring will return 503 AGENTS_NOT_CONFIGURED. ' +
        'Set AGENTS_CONTRACT_ID in your environment if credit scoring is required.',
    );
  }
}
