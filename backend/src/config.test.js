import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Minimal set of required env vars so config.js loads without throwing.
const REQUIRED = {
  CONTRACT_ID: 'C_TEST',
  SERVER_STELLAR_ADDRESS: 'G_TEST',
  SERVER_STELLAR_SECRET: 'S_TEST',
  STELLAR_RPC_URL: 'https://rpc.test',
  STELLAR_NETWORK_PASSPHRASE: 'Test',
  FACILITATOR_URL: 'https://facilitator.test',
  USDC_CONTRACT_ID: 'C_USDC',
  PAYMENT_ADDRESS: 'GRWM5W4EBCAOVKAMBUDAMODYPOA7L6IJ33YQGLNQVQV6ETJ3JFYL6VLV',
};

const ORIGINAL_ENV = { ...process.env };

async function loadConfig(overrides = {}) {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV, ...REQUIRED, ...overrides };
  // Strip optional vars not explicitly provided so defaults apply.
  for (const key of [
    'AGENTS_CONTRACT_ID',
    'RATE_LIMIT_WINDOW_MS',
    'RATE_LIMIT_MAX',
    'PAYMENT_RATE_LIMIT_WINDOW_MS',
    'PAYMENT_RATE_LIMIT_MAX',
    'TRUST_PROXY',
    'DEMO_RUN_POLL_MAX_WAIT_MS',
    'DEMO_RUN_POLL_INITIAL_DELAY_MS',
    'DEMO_RUN_POLL_MAX_DELAY_MS',
  ]) {
    if (!(key in overrides)) delete process.env[key];
  }
  return (await import('./config.js')).default;
}

describe('config rate-limit env validation', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('uses safe defaults when rate-limit vars are unset', async () => {
    const config = await loadConfig();
    expect(config.rateLimit.windowMs).toBe(60_000);
    expect(config.rateLimit.max).toBe(20);
    expect(config.rateLimit.payment.windowMs).toBe(60_000);
    expect(config.rateLimit.payment.max).toBe(10);
  });

  it('honors valid positive-integer overrides', async () => {
    const config = await loadConfig({ RATE_LIMIT_MAX: '5', RATE_LIMIT_WINDOW_MS: '1000' });
    expect(config.rateLimit.max).toBe(5);
    expect(config.rateLimit.windowMs).toBe(1000);
  });

  it('falls back and warns on non-numeric values', async () => {
    const config = await loadConfig({ RATE_LIMIT_MAX: 'abc' });
    expect(config.rateLimit.max).toBe(20);
    expect(console.warn).toHaveBeenCalled();
  });

  it('falls back on zero or negative values', async () => {
    const config = await loadConfig({ RATE_LIMIT_MAX: '0', PAYMENT_RATE_LIMIT_MAX: '-3' });
    expect(config.rateLimit.max).toBe(20);
    expect(config.rateLimit.payment.max).toBe(10);
  });
});

describe('config demoRun polling env validation', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('uses safe defaults when demo-run poll vars are unset', async () => {
    const config = await loadConfig();
    expect(config.demoRun.pollMaxWaitMs).toBe(8000);
    expect(config.demoRun.pollInitialDelayMs).toBe(250);
    expect(config.demoRun.pollMaxDelayMs).toBe(2000);
  });

  it('honors valid positive-integer overrides', async () => {
    const config = await loadConfig({
      DEMO_RUN_POLL_MAX_WAIT_MS: '5000',
      DEMO_RUN_POLL_INITIAL_DELAY_MS: '100',
      DEMO_RUN_POLL_MAX_DELAY_MS: '1000',
    });
    expect(config.demoRun.pollMaxWaitMs).toBe(5000);
    expect(config.demoRun.pollInitialDelayMs).toBe(100);
    expect(config.demoRun.pollMaxDelayMs).toBe(1000);
  });

  it('falls back and warns on non-numeric values', async () => {
    const config = await loadConfig({ DEMO_RUN_POLL_MAX_WAIT_MS: 'abc' });
    expect(config.demoRun.pollMaxWaitMs).toBe(8000);
    expect(console.warn).toHaveBeenCalled();
  });

  it('falls back on zero or negative values', async () => {
    const config = await loadConfig({
      DEMO_RUN_POLL_INITIAL_DELAY_MS: '0',
      DEMO_RUN_POLL_MAX_DELAY_MS: '-1',
    });
    expect(config.demoRun.pollInitialDelayMs).toBe(250);
    expect(config.demoRun.pollMaxDelayMs).toBe(2000);
  });
});

describe('config x402.payTo PAYMENT_ADDRESS validation', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('uses explicit PAYMENT_ADDRESS when set to a valid Stellar address', async () => {
    const config = await loadConfig({
  PAYMENT_ADDRESS: 'GRWM5W4EBCAOVKAMBUDAMODYPOA7L6IJ33YQGLNQVQV6ETJ3JFYL6VLV',
    });
    expect(config.x402.payTo).toBe('GRWM5W4EBCAOVKAMBUDAMODYPOA7L6IJ33YQGLNQVQV6ETJ3JFYL6VLV');
  });

  it('falls back to SERVER_STELLAR_ADDRESS when PAYMENT_ADDRESS is not set', async () => {
    // Delete PAYMENT_ADDRESS from the REQUIRED that loadConfig always applies
    const overrides = {};
    const env = { ...ORIGINAL_ENV, ...REQUIRED, ...overrides };
    delete env.PAYMENT_ADDRESS;
    vi.resetModules();
    process.env = { ...env };
    for (const key of [
      'RATE_LIMIT_WINDOW_MS',
      'RATE_LIMIT_MAX',
      'PAYMENT_RATE_LIMIT_WINDOW_MS',
      'PAYMENT_RATE_LIMIT_MAX',
      'TRUST_PROXY',
      'DEMO_RUN_POLL_MAX_WAIT_MS',
      'DEMO_RUN_POLL_INITIAL_DELAY_MS',
      'DEMO_RUN_POLL_MAX_DELAY_MS',
    ]) {
      delete process.env[key];
    }
    const config = (await import('./config.js')).default;
    expect(config.x402.payTo).toBe('G_TEST');
  });

  it('calls logger.fatal and exits when PAYMENT_ADDRESS has invalid format', async () => {
    const log = { fatal: vi.fn(), warn: vi.fn() };
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, ...REQUIRED, PAYMENT_ADDRESS: 'INVALID' };
    const { validateConfig } = await import('./config.js');
    validateConfig(log);
    expect(log.fatal).toHaveBeenCalledWith(
      expect.objectContaining({
        errors: expect.arrayContaining([expect.stringContaining('PAYMENT_ADDRESS')]),
      }),
      expect.any(String),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});

describe('config trustProxy parsing', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('defaults to false when unset', async () => {
    const config = await loadConfig();
    expect(config.trustProxy).toBe(false);
  });

  it('parses "true"/"false" booleans', async () => {
    expect((await loadConfig({ TRUST_PROXY: 'true' })).trustProxy).toBe(true);
    expect((await loadConfig({ TRUST_PROXY: 'false' })).trustProxy).toBe(false);
  });

  it('parses a numeric hop count', async () => {
    expect((await loadConfig({ TRUST_PROXY: '1' })).trustProxy).toBe(1);
  });

  it('passes through an IP/subnet string', async () => {
    expect((await loadConfig({ TRUST_PROXY: '127.0.0.1' })).trustProxy).toBe('127.0.0.1');
  });
});

describe('config AGENTS_CONTRACT_ID startup warning', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('warns via validateConfig when AGENTS_CONTRACT_ID is not set', async () => {
    const log = { fatal: vi.fn(), warn: vi.fn() };
    await loadConfig();
    const { validateConfig } = await import('./config.js');
    validateConfig(log);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('AGENTS_CONTRACT_ID is not set'),
    );
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('AGENTS_NOT_CONFIGURED'),
    );
  });

  it('does not warn via validateConfig when AGENTS_CONTRACT_ID is set', async () => {
    const log = { fatal: vi.fn(), warn: vi.fn() };
    await loadConfig({ AGENTS_CONTRACT_ID: 'C_AGENTS' });
    const { validateConfig } = await import('./config.js');
    validateConfig(log);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('sets contract.agentsId to the env value when provided', async () => {
    const config = await loadConfig({ AGENTS_CONTRACT_ID: 'C_AGENTS_TEST' });
    expect(config.contract.agentsId).toBe('C_AGENTS_TEST');
  });

  it('sets contract.agentsId to null when not provided', async () => {
    const config = await loadConfig();
    expect(config.contract.agentsId).toBeNull();
  });
});

describe('config CORS_ORIGIN validation', () => {
  let exitSpy;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
    exitSpy.mockRestore();
  });

  it('falls back to localhost outside production when CORS_ORIGIN is unset', async () => {
    const config = await loadConfig({ NODE_ENV: 'development' });
    expect(config.corsOrigin).toEqual(['http://localhost:3000']);
  });

  it('fails startup when NODE_ENV=production and CORS_ORIGIN is unset', async () => {
    const log = { fatal: vi.fn(), warn: vi.fn() };
    await loadConfig({ NODE_ENV: 'production' });
    const { validateConfig } = await import('./config.js');
    validateConfig(log);
    expect(log.fatal).toHaveBeenCalledWith(
      expect.objectContaining({
        errors: expect.arrayContaining([expect.stringContaining('CORS_ORIGIN must be set explicitly')]),
      }),
      expect.any(String),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('does not fail startup when NODE_ENV=production and CORS_ORIGIN is set', async () => {
    const log = { fatal: vi.fn(), warn: vi.fn() };
    await loadConfig({ NODE_ENV: 'production', CORS_ORIGIN: 'https://app.example.com', AGENTS_CONTRACT_ID: 'C_AGENTS' });
    const { validateConfig } = await import('./config.js');
    validateConfig(log);
    expect(log.fatal).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('rejects CORS_ORIGIN="*" even outside production', async () => {
    const log = { fatal: vi.fn(), warn: vi.fn() };
    await loadConfig({ NODE_ENV: 'development', CORS_ORIGIN: '*' });
    const { validateConfig } = await import('./config.js');
    validateConfig(log);
    expect(log.fatal).toHaveBeenCalledWith(
      expect.objectContaining({
        errors: expect.arrayContaining([expect.stringContaining("cannot include '*'")]),
      }),
      expect.any(String),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('rejects "*" mixed in with other explicit origins', async () => {
    const log = { fatal: vi.fn(), warn: vi.fn() };
    await loadConfig({ NODE_ENV: 'production', CORS_ORIGIN: 'https://app.example.com,*' });
    const { validateConfig } = await import('./config.js');
    validateConfig(log);
    expect(log.fatal).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('parses a comma-separated CORS_ORIGIN into a trimmed array', async () => {
    const config = await loadConfig({
      CORS_ORIGIN: 'https://app.example.com, https://admin.example.com',
    });
    expect(config.corsOrigin).toEqual([
      'https://app.example.com',
      'https://admin.example.com',
    ]);
  });
});

describe('validateConfig', () => {
  let exitSpy;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
    exitSpy.mockRestore();
  });

  it('does not exit when all required vars are present', async () => {
    const log = { fatal: vi.fn(), warn: vi.fn() };
    await loadConfig({ AGENTS_CONTRACT_ID: 'C_AGENTS' });
    const { validateConfig } = await import('./config.js');
    validateConfig(log);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(log.fatal).not.toHaveBeenCalled();
  });

  it('reports all missing vars in a single fatal call', async () => {
    const log = { fatal: vi.fn(), warn: vi.fn() };
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    for (const key of ['CONTRACT_ID', 'SERVER_STELLAR_SECRET', 'FACILITATOR_URL']) {
      delete process.env[key];
    }
    const { validateConfig } = await import('./config.js');
    validateConfig(log);
    expect(log.fatal).toHaveBeenCalledTimes(1);
    const [obj] = log.fatal.mock.calls[0];
    expect(obj.missingVars).toContain('CONTRACT_ID');
    expect(obj.missingVars).toContain('SERVER_STELLAR_SECRET');
    expect(obj.missingVars).toContain('FACILITATOR_URL');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
