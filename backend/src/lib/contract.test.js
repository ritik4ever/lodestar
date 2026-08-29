import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../config.js', () => ({
  default: {
    contract: { id: 'mock', agentsId: 'mock', txPollMaxWaitMs: 10_000 },
    server: { address: 'mock', secret: 'SDY7R6HC2UK4D4CWWBKZBJTE6FLY5QHGQCK2U6U3R3KASMW5OPWMBDO2' },
    stellar: { network: 'testnet', rpcUrl: 'https://mock', networkPassphrase: 'mock', usdcContractId: 'mock' },
    x402: { facilitatorUrl: 'https://mock', searchPrice: '0.001', weatherPrice: '0.001', payTo: 'G_MOCK_PAYMENT' },
    braveApiKey: '',
    corsOrigin: ['http://localhost:3000'],
    jsonBodyLimit: '100kb',
    nodeEnv: 'test',
    port: 3001,
    logLevel: 'silent',
  },
}));

const { mockGetAccount, mockSimulateTransaction, mockSendTransaction, mockGetTransaction } = vi.hoisted(() => ({
  mockGetAccount: vi.fn(),
  mockSimulateTransaction: vi.fn(),
  mockSendTransaction: vi.fn(),
  mockGetTransaction: vi.fn(),
}));

const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('./logger.js', () => ({ default: mockLogger }));

vi.mock('./stellar.js', () => ({
  getStellarServer: () => ({
    getAccount: mockGetAccount,
    simulateTransaction: mockSimulateTransaction,
    sendTransaction: mockSendTransaction,
    getTransaction: mockGetTransaction,
  }),
  getNetworkPassphrase: () => 'Test SDF Network ; September 2015',
}));

vi.mock('node:fs', () => ({
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

import sdkPkg from '@stellar/stellar-sdk';
import * as contractLib from './contract.js';

const { StrKey } = sdkPkg;
const VALID_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32));

const { mapAgent, mapPolicy } = contractLib;

function resetMockServer() {
  mockGetAccount.mockReset();
  mockSimulateTransaction.mockReset();
  mockSendTransaction.mockReset();
  mockGetTransaction.mockReset();
}

function mockTransactionPollServer() {
  const pollServer = {
    getTransaction: mockGetTransaction,
    httpClient: { defaults: {} },
  };
  contractLib.__setTransactionPollServerForTest(() => pollServer);
}

describe('registerServiceOnChain duplicate checks', () => {
  let activeServiceExistsSpy;
  let activeServiceExistsByNameSpy;

  beforeEach(() => {
    process.env.SEEDING_MODE = 'true';
    activeServiceExistsSpy = vi.spyOn(contractLib.contractHelpers, 'activeServiceExists');
    activeServiceExistsByNameSpy = vi.spyOn(contractLib.contractHelpers, 'activeServiceExistsByName');
  });

  afterEach(() => {
    delete process.env.SEEDING_MODE;
    vi.restoreAllMocks();
  });

  it('returns true when an active service exists for the same provider and endpoint', async () => {
    const provider = 'GA7FYRB5CREWMDK2VIKVKWSW7V3YCCU3B3UHBJQ6JZ5OC7V7M5D4T8KJ';
    const endpoint = 'https://test.example.com';
    activeServiceExistsSpy.mockResolvedValueOnce(true);

    expect(await contractLib.activeServiceExists(provider, endpoint)).toBe(true);
    expect(activeServiceExistsSpy).toHaveBeenCalledWith(provider, endpoint, expect.any(Function));
  });

  it('returns false when no matching active service exists', async () => {
    activeServiceExistsSpy.mockResolvedValueOnce(false);

    expect(await contractLib.activeServiceExists('GA7FYRB5CREWMDK2VIKVKWSW7V3YCCU3B3UHBJQ6JZ5OC7V7M5D4T8KJ', 'https://test.example.com')).toBe(false);
  });

  it('returns true when an active service exists for the same provider and name', async () => {
    const provider = 'GA7FYRB5CREWMDK2VIKVKWSW7V3YCCU3B3UHBJQ6JZ5OC7V7M5D4T8KJ';
    const name = 'Test Service';
    activeServiceExistsByNameSpy.mockResolvedValueOnce(true);

    expect(await contractLib.activeServiceExistsByName(provider, name)).toBe(true);
    expect(activeServiceExistsByNameSpy).toHaveBeenCalledWith(provider, name, expect.any(Function));
  });

  it('returns false when no matching active service name exists', async () => {
    activeServiceExistsByNameSpy.mockResolvedValueOnce(false);

    expect(await contractLib.activeServiceExistsByName('GA7FYRB5CREWMDK2VIKVKWSW7V3YCCU3B3UHBJQ6JZ5OC7V7M5D4T8KJ', 'Test Service')).toBe(false);
  });

  it('throws when duplicate active service endpoint exists during registration', async () => {
    activeServiceExistsSpy.mockResolvedValueOnce(true);

    await expect(
      contractLib.registerServiceOnChain('Service', 'Description', 'https://test.example.com', '0.001', 'test')
    ).rejects.toThrow('Active service with same provider and endpoint already exists');

    expect(activeServiceExistsSpy).toHaveBeenCalled();
  });

  it('throws when duplicate active service name exists during registration', async () => {
    activeServiceExistsSpy.mockResolvedValueOnce(false);
    activeServiceExistsByNameSpy.mockResolvedValueOnce(true);

    await expect(
      contractLib.registerServiceOnChain('Service', 'Description', 'https://test.example.com', '0.001', 'test')
    ).rejects.toThrow('Active service with same provider and name already exists');

    expect(activeServiceExistsByNameSpy).toHaveBeenCalled();
  });

  it('rejects server-signed registration when seeding mode is disabled', async () => {
    delete process.env.SEEDING_MODE;

    await expect(
      contractLib.registerServiceOnChain('Service', 'Description', 'https://test.example.com', '0.001', 'test')
    ).rejects.toThrow('Server-signed service registration is disabled');
  });
});

describe('activeServiceExists pagination', () => {
  it('continues scanning when a page is shorter than the requested page size', async () => {
    const provider = 'GA7FYRB5CREWMDK2VIKVKWSW7V3YCCU3B3UHBJQ6JZ5OC7V7M5D4T8KJ';
    const endpoint = 'https://test.example.com';

    const fetchServices = vi
      .fn()
      .mockResolvedValueOnce([
        { provider: 'GAOTHER', endpoint: 'https://other.example.com' },
      ])
      .mockResolvedValueOnce([
        { provider, endpoint },
      ]);

    await expect(
      contractLib.contractHelpers.activeServiceExists(provider, endpoint, fetchServices)
    ).resolves.toBe(true);

    expect(fetchServices).toHaveBeenNthCalledWith(1, { offset: 0, limit: 20 });
    expect(fetchServices).toHaveBeenNthCalledWith(2, { offset: 20, limit: 20 });
  });
});

describe('listServicesByProvider pagination', () => {
  it('collects matching services across every page', async () => {
    const provider = 'GA7FYRB5CREWMDK2VIKVKWSW7V3YCCU3B3UHBJQ6JZ5OC7V7M5D4T8KJ';
    const fetchServices = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 1, provider },
        { id: 2, provider: 'GAOTHER' },
      ])
      .mockResolvedValueOnce([
        { id: 3, provider },
      ])
      .mockResolvedValueOnce([]);

    await expect(contractLib.listServicesByProvider(provider, fetchServices)).resolves.toEqual([
      { id: 1, provider },
      { id: 3, provider },
    ]);

    expect(fetchServices).toHaveBeenNthCalledWith(1, { offset: 0, limit: 20 });
    expect(fetchServices).toHaveBeenNthCalledWith(2, { offset: 20, limit: 20 });
    expect(fetchServices).toHaveBeenNthCalledWith(3, { offset: 40, limit: 20 });
  });
});

describe('mapAgent', () => {
  it('should map a basic agent object', () => {
    const raw = {
      address: 'GA7FYRB5CREWMDK2VIKVKWSW7V3YCCU3B3UHBJQ6JZ5OC7V7M5D4T8KJ',
      name: 'Test Agent',
      description: 'A test agent',
      owner: 'GBV4ZDEPLQTVPQFJRME2BGYL6VQJLTTRIWJHTJNFGXBVF4WY5DJIQK2K',
      score: 100n,
      total_payments: 5n,
      successful_payments: 3n,
      failed_payments: 2n,
      total_volume_stroops: 10000000n,
      registered_at: 1000n,
      last_active: 2000n,
      active: true,
      flagged: false,
      flag_reason: '',
    };

    const result = mapAgent(raw);

    expect(result.address).toBe(raw.address);
    expect(result.name).toBe('Test Agent');
    expect(result.score).toBe(100);
    expect(result.total_payments).toBe('5');
    expect(result.total_volume_stroops).toBe('10000000');
    expect(result.active).toBe(true);
    expect(result.flagged).toBe(false);
  });

  it('should handle zero values', () => {
    const raw = {
      address: 'GA7FYRB5CREWMDK2VIKVKWSW7V3YCCU3B3UHBJQ6JZ5OC7V7M5D4T8KJ',
      name: 'Zero Agent',
      description: 'All zeros',
      owner: 'GBV4ZDEPLQTVPQFJRME2BGYL6VQJLTTRIWJHTJNFGXBVF4WY5DJIQK2K',
      score: 0n,
      total_payments: 0n,
      successful_payments: 0n,
      failed_payments: 0n,
      total_volume_stroops: 0n,
      registered_at: 0n,
      last_active: 0n,
      active: true,
      flagged: false,
      flag_reason: '',
    };

    const result = mapAgent(raw);

    expect(result.score).toBe(0);
    expect(result.total_payments).toBe('0');
    expect(result.total_volume_stroops).toBe('0');
    expect(result.registered_at).toBe('0');
    expect(result.last_active).toBe('0');
  });

  it('should handle values at Number.MAX_SAFE_INTEGER', () => {
    const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
    const raw = {
      address: 'GA7FYRB5CREWMDK2VIKVKWSW7V3YCCU3B3UHBJQ6JZ5OC7V7M5D4T8KJ',
      name: 'Safe Agent',
      description: 'At max safe integer',
      owner: 'GBV4ZDEPLQTVPQFJRME2BGYL6VQJLTTRIWJHTJNFGXBVF4WY5DJIQK2K',
      score: maxSafe,
      total_payments: maxSafe,
      successful_payments: maxSafe,
      failed_payments: maxSafe,
      total_volume_stroops: maxSafe,
      registered_at: maxSafe,
      last_active: maxSafe,
      active: true,
      flagged: false,
      flag_reason: '',
    };

    const result = mapAgent(raw);

    expect(result.score).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.total_payments).toBe(String(Number.MAX_SAFE_INTEGER));
    expect(result.total_volume_stroops).toBe(String(Number.MAX_SAFE_INTEGER));
    expect(result.registered_at).toBe(String(Number.MAX_SAFE_INTEGER));
    expect(result.last_active).toBe(String(Number.MAX_SAFE_INTEGER));
  });

  it('should handle values exceeding Number.MAX_SAFE_INTEGER', () => {
    const large = BigInt(Number.MAX_SAFE_INTEGER) * 2n;
    const raw = {
      address: 'GA7FYRB5CREWMDK2VIKVKWSW7V3YCCU3B3UHBJQ6JZ5OC7V7M5D4T8KJ',
      name: 'Large Agent',
      description: 'Exceeding safe integer',
      owner: 'GBV4ZDEPLQTVPQFJRME2BGYL6VQJLTTRIWJHTJNFGXBVF4WY5DJIQK2K',
      score: large,
      total_payments: large,
      successful_payments: large,
      failed_payments: large,
      total_volume_stroops: large,
      registered_at: large,
      last_active: large,
      active: true,
      flagged: false,
      flag_reason: '',
    };

    const result = mapAgent(raw);

    expect(result.total_volume_stroops).toBe(large.toString());
    expect(result.score).toBe(large.toString());
    expect(result.total_payments).toBe(large.toString());
    expect(result.successful_payments).toBe(large.toString());
    expect(result.failed_payments).toBe(large.toString());
    expect(result.registered_at).toBe(large.toString());
    expect(result.last_active).toBe(large.toString());
  });

  it('should handle negative i128 values', () => {
    const raw = {
      address: 'GA7FYRB5CREWMDK2VIKVKWSW7V3YCCU3B3UHBJQ6JZ5OC7V7M5D4T8KJ',
      name: 'Negative Agent',
      description: 'Negative scores',
      owner: 'GBV4ZDEPLQTVPQFJRME2BGYL6VQJLTTRIWJHTJNFGXBVF4WY5DJIQK2K',
      score: -50n,
      total_payments: 10n,
      successful_payments: 5n,
      failed_payments: 5n,
      total_volume_stroops: 0n,
      registered_at: 0n,
      last_active: 0n,
      active: true,
      flagged: false,
      flag_reason: '',
    };

    const result = mapAgent(raw);

    expect(result.score).toBe(-50);
    expect(result.total_payments).toBe('10');
  });

  it('should handle values at Number.MIN_SAFE_INTEGER', () => {
    const minSafe = BigInt(Number.MIN_SAFE_INTEGER);
    const raw = {
      address: 'GA7FYRB5CREWMDK2VIKVKWSW7V3YCCU3B3UHBJQ6JZ5OC7V7M5D4T8KJ',
      name: 'Min Safe Agent',
      description: 'At min safe integer',
      owner: 'GBV4ZDEPLQTVPQFJRME2BGYL6VQJLTTRIWJHTJNFGXBVF4WY5DJIQK2K',
      score: minSafe,
      total_payments: 0n,
      successful_payments: 0n,
      failed_payments: 0n,
      total_volume_stroops: 0n,
      registered_at: 0n,
      last_active: 0n,
      active: true,
      flagged: false,
      flag_reason: '',
    };

    const result = mapAgent(raw);

    expect(result.score).toBe(Number.MIN_SAFE_INTEGER);
  });

  it('should handle values below Number.MIN_SAFE_INTEGER as string', () => {
    const belowMin = BigInt(Number.MIN_SAFE_INTEGER) * 2n;
    const raw = {
      address: 'GA7FYRB5CREWMDK2VIKVKWSW7V3YCCU3B3UHBJQ6JZ5OC7V7M5D4T8KJ',
      name: 'Below Min Agent',
      description: 'Below min safe integer',
      owner: 'GBV4ZDEPLQTVPQFJRME2BGYL6VQJLTTRIWJHTJNFGXBVF4WY5DJIQK2K',
      score: belowMin,
      total_payments: 0n,
      successful_payments: 0n,
      failed_payments: 0n,
      total_volume_stroops: 0n,
      registered_at: 0n,
      last_active: 0n,
      active: true,
      flagged: false,
      flag_reason: '',
    };

    const result = mapAgent(raw);

    expect(result.score).toBe(belowMin.toString());
  });

  it('should handle Address-like objects with toString', () => {
    const raw = {
      address: { toString: () => 'GA7FYRB5CREWMDK2VIKVKWSW7V3YCCU3B3UHBJQ6JZ5OC7V7M5D4T8KJ' },
      name: 'Obj Agent',
      description: 'Address as object',
      owner: { toString: () => 'GBV4ZDEPLQTVPQFJRME2BGYL6VQJLTTRIWJHTJNFGXBVF4WY5DJIQK2K' },
      score: 200n,
      total_payments: 10n,
      successful_payments: 8n,
      failed_payments: 2n,
      total_volume_stroops: 5000000n,
      registered_at: 3000n,
      last_active: 4000n,
      active: true,
      flagged: false,
      flag_reason: '',
    };

    const result = mapAgent(raw);

    expect(result.address).toBe('GA7FYRB5CREWMDK2VIKVKWSW7V3YCCU3B3UHBJQ6JZ5OC7V7M5D4T8KJ');
    expect(result.owner).toBe('GBV4ZDEPLQTVPQFJRME2BGYL6VQJLTTRIWJHTJNFGXBVF4WY5DJIQK2K');
  });
});

describe('mapPolicy', () => {
  it('should map a basic policy object', () => {
    const raw = {
      agent_address: 'GA7FYRB5CREWMDK2VIKVKWSW7V3YCCU3B3UHBJQ6JZ5OC7V7M5D4T8KJ',
      max_per_tx_stroops: 10000000n,
      max_per_day_stroops: 50000000n,
      allowed_categories: ['weather', 'search'],
      min_score_to_earn: 300n,
      daily_spent_stroops: 0n,
      last_reset_ledger: 12345n,
    };

    const result = mapPolicy(raw);

    expect(result.agent_address).toBe(raw.agent_address);
    expect(result.max_per_tx_stroops).toBe('10000000');
    expect(result.max_per_day_stroops).toBe('50000000');
    expect(result.allowed_categories).toEqual(['weather', 'search']);
    expect(result.min_score_to_earn).toBe(300);
    expect(result.daily_spent_stroops).toBe('0');
    expect(result.last_reset_ledger).toBe('12345');
  });

  it('should handle zero values', () => {
    const raw = {
      agent_address: 'GA7FYRB5CREWMDK2VIKVKWSW7V3YCCU3B3UHBJQ6JZ5OC7V7M5D4T8KJ',
      max_per_tx_stroops: 0n,
      max_per_day_stroops: 0n,
      allowed_categories: [],
      min_score_to_earn: 0n,
      daily_spent_stroops: 0n,
      last_reset_ledger: 0n,
    };

    const result = mapPolicy(raw);

    expect(result.max_per_tx_stroops).toBe('0');
    expect(result.max_per_day_stroops).toBe('0');
    expect(result.allowed_categories).toEqual([]);
    expect(result.min_score_to_earn).toBe(0);
    expect(result.daily_spent_stroops).toBe('0');
    expect(result.last_reset_ledger).toBe('0');
  });

  it('should handle values at Number.MAX_SAFE_INTEGER', () => {
    const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
    const raw = {
      agent_address: 'GA7FYRB5CREWMDK2VIKVKWSW7V3YCCU3B3UHBJQ6JZ5OC7V7M5D4T8KJ',
      max_per_tx_stroops: maxSafe,
      max_per_day_stroops: maxSafe,
      allowed_categories: ['premium'],
      min_score_to_earn: maxSafe,
      daily_spent_stroops: maxSafe,
      last_reset_ledger: maxSafe,
    };

    const result = mapPolicy(raw);

    expect(result.max_per_tx_stroops).toBe(String(Number.MAX_SAFE_INTEGER));
    expect(result.max_per_day_stroops).toBe(String(Number.MAX_SAFE_INTEGER));
    expect(result.min_score_to_earn).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.daily_spent_stroops).toBe(String(Number.MAX_SAFE_INTEGER));
    expect(result.last_reset_ledger).toBe(String(Number.MAX_SAFE_INTEGER));
  });

  it('should handle values exceeding Number.MAX_SAFE_INTEGER', () => {
    const large = BigInt(Number.MAX_SAFE_INTEGER) * 10n;
    const raw = {
      agent_address: 'GA7FYRB5CREWMDK2VIKVKWSW7V3YCCU3B3UHBJQ6JZ5OC7V7M5D4T8KJ',
      max_per_tx_stroops: large,
      max_per_day_stroops: large,
      allowed_categories: ['all'],
      min_score_to_earn: large,
      daily_spent_stroops: large,
      last_reset_ledger: large,
    };

    const result = mapPolicy(raw);

    expect(result.max_per_tx_stroops).toBe(large.toString());
    expect(result.max_per_day_stroops).toBe(large.toString());
    expect(result.daily_spent_stroops).toBe(large.toString());
    expect(result.min_score_to_earn).toBe(large.toString());
    expect(result.last_reset_ledger).toBe(large.toString());
  });

  it('should handle negative i128 values', () => {
    const raw = {
      agent_address: 'GA7FYRB5CREWMDK2VIKVKWSW7V3YCCU3B3UHBJQ6JZ5OC7V7M5D4T8KJ',
      max_per_tx_stroops: 10000000n,
      max_per_day_stroops: 50000000n,
      allowed_categories: ['weather'],
      min_score_to_earn: -100n,
      daily_spent_stroops: 0n,
      last_reset_ledger: 1000n,
    };

    const result = mapPolicy(raw);

    expect(result.min_score_to_earn).toBe(-100);
  });

  it('should handle values at Number.MIN_SAFE_INTEGER', () => {
    const minSafe = BigInt(Number.MIN_SAFE_INTEGER);
    const raw = {
      agent_address: 'GA7FYRB5CREWMDK2VIKVKWSW7V3YCCU3B3UHBJQ6JZ5OC7V7M5D4T8KJ',
      max_per_tx_stroops: 0n,
      max_per_day_stroops: 0n,
      allowed_categories: [],
      min_score_to_earn: minSafe,
      daily_spent_stroops: 0n,
      last_reset_ledger: 0n,
    };

    const result = mapPolicy(raw);

    expect(result.min_score_to_earn).toBe(Number.MIN_SAFE_INTEGER);
  });

  it('should handle values below Number.MIN_SAFE_INTEGER as string', () => {
    const belowMin = BigInt(Number.MIN_SAFE_INTEGER) * 2n;
    const raw = {
      agent_address: 'GA7FYRB5CREWMDK2VIKVKWSW7V3YCCU3B3UHBJQ6JZ5OC7V7M5D4T8KJ',
      max_per_tx_stroops: 0n,
      max_per_day_stroops: 0n,
      allowed_categories: [],
      min_score_to_earn: belowMin,
      daily_spent_stroops: 0n,
      last_reset_ledger: belowMin,
    };

    const result = mapPolicy(raw);

    expect(result.min_score_to_earn).toBe(belowMin.toString());
    expect(result.last_reset_ledger).toBe(belowMin.toString());
  });

  it('should handle object-like addresses', () => {
    const raw = {
      agent_address: { toString: () => 'GA7FYRB5CREWMDK2VIKVKWSW7V3YCCU3B3UHBJQ6JZ5OC7V7M5D4T8KJ' },
      max_per_tx_stroops: 10000000n,
      max_per_day_stroops: 50000000n,
      allowed_categories: ['weather'],
      min_score_to_earn: 100n,
      daily_spent_stroops: 2000000n,
      last_reset_ledger: 54321n,
    };

    const result = mapPolicy(raw);

    expect(result.agent_address).toBe('GA7FYRB5CREWMDK2VIKVKWSW7V3YCCU3B3UHBJQ6JZ5OC7V7M5D4T8KJ');
  });

  it('should default allowed_categories to empty array when not array', () => {
    const raw = {
      agent_address: 'GA7FYRB5CREWMDK2VIKVKWSW7V3YCCU3B3UHBJQ6JZ5OC7V7M5D4T8KJ',
      max_per_tx_stroops: 10000000n,
      max_per_day_stroops: 50000000n,
      allowed_categories: null,
      min_score_to_earn: 100n,
      daily_spent_stroops: 0n,
      last_reset_ledger: 0n,
    };

    const result = mapPolicy(raw);

    expect(result.allowed_categories).toEqual([]);
  });
});


describe('simulateAndSubmit transaction polling', () => {
  let contract;

  beforeEach(() => {
    resetMockServer();
    mockTransactionPollServer();
    contractLib.resetRpcMetrics();
    contract = new sdkPkg.Contract(VALID_CONTRACT_ID);
    mockGetAccount.mockResolvedValue({ sequence: '1' });
    mockSimulateTransaction.mockResolvedValue({ result: { retval: sdkPkg.xdr.ScVal.scvVoid() } });
    contractLib.__setAssembleTransactionForTest((tx) => ({ build: () => tx }));
    mockSendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'txhash123' });
  });

  afterEach(() => {
    contractLib.__setTransactionPollServerForTest();
    contractLib.__setAssembleTransactionForTest();
  });

  it('throws TransactionFailedError when getTransaction reports FAILED', async () => {
    mockGetTransaction.mockResolvedValueOnce({ status: 'FAILED', resultXdr: 'raw-failure' });

    await expect(contractLib.simulateAndSubmit(contract.call('get_service_count'))).rejects.toMatchObject({
      name: 'TransactionFailedError',
      code: 'TRANSACTION_FAILED',
      hash: 'txhash123',
    });
  });

  it('propagates getTransaction XDR parse errors instead of assuming success', async () => {
    const parseErr = new Error('Bad union switch: XDR parse failed');
    mockGetTransaction.mockRejectedValueOnce(parseErr);

    await expect(contractLib.simulateAndSubmit(contract.call('get_service_count'))).rejects.toBe(parseErr);
  });

  it('throws ReturnValueParseError when a successful transaction return value cannot be parsed', async () => {
    mockGetTransaction.mockResolvedValueOnce({ status: 'SUCCESS', returnValue: 'not-an-scval' });

    await expect(contractLib.simulateAndSubmit(contract.call('get_service_count'))).rejects.toMatchObject({
      name: 'ReturnValueParseError',
      code: 'RETURN_VALUE_PARSE_FAILED',
      hash: 'txhash123',
    });
  });

  it('uses exponential backoff until the configured deadline and logs timeout context', async () => {
    vi.useFakeTimers();
    try {
      const deadlineAt = Date.now() + 10_000;
      mockGetTransaction.mockResolvedValue({ status: 'NOT_FOUND' });
      const promise = contractLib.simulateAndSubmit(contract.call('get_service_count'));
      const rejection = expect(promise).rejects.toMatchObject({
        code: 'TRANSACTION_TIMEOUT',
        hash: 'txhash123',
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(mockGetTransaction).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1_500);
      expect(mockGetTransaction).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(3_000);
      expect(mockGetTransaction).toHaveBeenCalledTimes(3);

      await vi.advanceTimersByTimeAsync(5_500);
      await rejection;
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ hash: 'txhash123', maxWaitMs: 10_000, deadlineAt, pollCount: 3 }),
        expect.stringContaining('remains pending'),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('releases the submit queue when transaction lookup never settles', async () => {
    vi.useFakeTimers();
    try {
      mockGetTransaction.mockReturnValue(new Promise(() => {}));
      const promise = contractLib.simulateAndSubmit(contract.call('get_service_count'));
      const rejection = expect(promise).rejects.toMatchObject({
        code: 'TRANSACTION_TIMEOUT',
        hash: 'txhash123',
      });

      await vi.advanceTimersByTimeAsync(10_000);
      await rejection;
      expect(mockGetTransaction).toHaveBeenCalledTimes(1);
      expect(contractLib.getSubmitQueueDepth()).toBe(0);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ hash: 'txhash123', pollCount: 1 }),
        expect.stringContaining('remains pending'),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('simulateReadBatch', () => {
  let contract;

  beforeEach(() => {
    resetMockServer();
    contractLib.resetRpcMetrics();
    contract = new sdkPkg.Contract(VALID_CONTRACT_ID);
  });

  it('returns empty array when operations is empty', async () => {
    const results = await contractLib.simulateReadBatch([]);

    expect(results).toEqual([]);
    expect(mockSimulateTransaction).toHaveBeenCalledTimes(0);
  });

  it('throws ContractError on simulation error', async () => {
    mockSimulateTransaction.mockResolvedValueOnce({ error: 'simulation exploded' });
    const ops = [contract.call('get_service_count')];

    await expect(contractLib.simulateReadBatch(ops)).rejects.toThrow('Batch simulation failed');
  });

  it('returns array of retvals for multiple operations', async () => {
    mockSimulateTransaction
      .mockResolvedValueOnce({ result: { retval: 'result_1' } })
      .mockResolvedValueOnce({ result: { retval: 'result_2' } });

    const ops = [
      contract.call('get_service_count'),
      contract.call('get_agent_count'),
    ];

    const results = await contractLib.simulateReadBatch(ops);

    expect(results).toEqual(['result_1', 'result_2']);
    expect(mockSimulateTransaction).toHaveBeenCalledTimes(2);
  });
});

describe('rpcMetrics', () => {
  beforeEach(() => {
    resetMockServer();
    contractLib.resetRpcMetrics();
  });

  it('getRpcMetrics returns current counts', () => {
    const metrics = contractLib.getRpcMetrics();
    expect(metrics).toEqual({
      getAccount: 0,
      simulateTransaction: 0,
      sendTransaction: 0,
      getTransaction: 0,
    });
  });

  it('resetRpcMetrics clears all counters', async () => {
    mockSimulateTransaction.mockResolvedValue({ result: { retval: 'x' } });
    const contract = new sdkPkg.Contract(VALID_CONTRACT_ID);
    await contractLib.simulateReadBatch([contract.call('get_service_count')]);

    contractLib.resetRpcMetrics();
    const metrics = contractLib.getRpcMetrics();
    expect(metrics.simulateTransaction).toBe(0);
  });
});

describe('pendingTransactions registry', () => {
  let contract;

  beforeEach(() => {
    resetMockServer();
    mockTransactionPollServer();
    contractLib.resetRpcMetrics();
    contractLib.__resetPendingTransactions();
    contract = new sdkPkg.Contract(VALID_CONTRACT_ID);
    mockGetAccount.mockResolvedValue({ sequence: '1' });
    mockSimulateTransaction.mockResolvedValue({ result: { retval: sdkPkg.xdr.ScVal.scvVoid() } });
    contractLib.__setAssembleTransactionForTest((tx) => ({ build: () => tx }));
  });

  afterEach(() => {
    contractLib.__setTransactionPollServerForTest();
    contractLib.__setAssembleTransactionForTest();
    contractLib.__resetPendingTransactions();
  });

  it('reports zero by default', () => {
    expect(contractLib.getPendingTransactionCount()).toBe(0);
    expect(contractLib.getPendingTransactions()).toEqual([]);
  });

  it('retains pending transaction on NOT_FOUND timeout (tx may still confirm on-chain)', async () => {
    vi.useFakeTimers();
    try {
      mockSendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'pending-hash-1' });
      mockGetTransaction.mockResolvedValue({ status: 'NOT_FOUND' });

      const promise = contractLib.simulateAndSubmit(contract.call('get_service_count'));
      const rejection = expect(promise).rejects.toThrow('Transaction not confirmed after polling');
      await vi.advanceTimersByTimeAsync(10_000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }

    expect(contractLib.getPendingTransactionCount()).toBe(1);
    const pending = contractLib.getPendingTransactions();
    expect(pending[0].hash).toBe('pending-hash-1');
    expect(pending[0].operation).toBe('unknown');
    expect(pending[0].submittedAt).toBeGreaterThan(0);
  });

  it('removes tracked transaction on SUCCESS', async () => {
    mockSendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'success-hash' });
    mockGetTransaction.mockResolvedValue({ status: 'SUCCESS', returnValue: sdkPkg.xdr.ScVal.scvVoid() });

    await contractLib.simulateAndSubmit(contract.call('get_service_count'));

    expect(contractLib.getPendingTransactionCount()).toBe(0);
  });

  it('removes tracked transaction on FAILED', async () => {
    mockSendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'fail-hash' });
    mockGetTransaction.mockResolvedValue({ status: 'FAILED', resultXdr: 'raw-failure' });

    await expect(contractLib.simulateAndSubmit(contract.call('get_service_count'))).rejects.toThrow();
    expect(contractLib.getPendingTransactionCount()).toBe(0);
  });

  it('tracks and removes on SUCCESS with one NOT_FOUND retry', async () => {
    mockSendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'retry-hash' });
    mockGetTransaction
      .mockResolvedValueOnce({ status: 'NOT_FOUND' })
      .mockResolvedValue({ status: 'SUCCESS', returnValue: sdkPkg.xdr.ScVal.scvVoid() });

    await contractLib.simulateAndSubmit(contract.call('get_service_count'));
    expect(contractLib.getPendingTransactionCount()).toBe(0);
  });
});

describe('dumpPendingTransactions', () => {
  let fsWriteFileSync;
  let fsExistsSync;
  let fsUnlinkSync;
  let fsReadFileSync;

  beforeEach(async () => {
    contractLib.__resetPendingTransactions();
    const fs = await import('node:fs');
    fsWriteFileSync = fs.writeFileSync;
    fsExistsSync = fs.existsSync;
    fsUnlinkSync = fs.unlinkSync;
    fsReadFileSync = fs.readFileSync;
    fsExistsSync.mockReturnValue(false);
    fsReadFileSync.mockReturnValue('[]');
    mockGetAccount.mockResolvedValue({ sequence: '1' });
    mockSimulateTransaction.mockResolvedValue({ result: { retval: sdkPkg.xdr.ScVal.scvVoid() } });
    contractLib.__setAssembleTransactionForTest((tx) => ({ build: () => tx }));
  });

  afterEach(async () => {
    contractLib.__resetPendingTransactions();
    await contractLib.drainSubmitQueue();
    vi.restoreAllMocks();
  });

  it('writes nothing when there are no pending transactions', () => {
    contractLib.dumpPendingTransactions();
    expect(fsWriteFileSync).not.toHaveBeenCalled();
  });

  it('writes pending entries to file', { timeout: 35000 }, async () => {
    mockSendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'dump-hash' });
    mockGetTransaction.mockResolvedValue({ status: 'NOT_FOUND' });
    const contract = new sdkPkg.Contract(VALID_CONTRACT_ID);

    await expect(contractLib.simulateAndSubmit(contract.call('get_service_count'))).rejects.toThrow();

    contractLib.dumpPendingTransactions();

    expect(fsWriteFileSync).toHaveBeenCalledWith(
      'pending-transactions.json',
      expect.stringContaining('dump-hash'),
      'utf-8',
    );
  });

  it('includes hash and submittedAt in dumped entries', { timeout: 35000 }, async () => {
    mockSendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'op-hash' });
    mockGetTransaction.mockResolvedValue({ status: 'NOT_FOUND' });
    const contract = new sdkPkg.Contract(VALID_CONTRACT_ID);

    await expect(contractLib.simulateAndSubmit(contract.call('get_service_count'))).rejects.toThrow();

    contractLib.dumpPendingTransactions();
    const written = JSON.parse(fsWriteFileSync.mock.calls[0][1]);
    expect(written[0].hash).toBe('op-hash');
    expect(written[0].submittedAt).toBeGreaterThan(0);
  });
});

describe('resumePendingTransactions', () => {
  beforeEach(() => {
    contractLib.__resetPendingTransactions();
  });

  afterEach(() => {
    contractLib.__resetPendingTransactions();
    vi.restoreAllMocks();
  });

  it('does nothing when pending-transactions.json does not exist', async () => {
    const fs = await import('node:fs');
    fs.existsSync.mockReturnValue(false);

    await contractLib.resumePendingTransactions();

    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it('does nothing when file is empty array', async () => {
    const fs = await import('node:fs');
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('[]');

    await contractLib.resumePendingTransactions();
    expect(contractLib.getPendingTransactionCount()).toBe(0);
  });

  it('re-adds unconfirmed entries to pending registry', async () => {
    const fs = await import('node:fs');
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify([
      { hash: 'unconfirmed-hash', operation: 'register_agent', submittedAt: Date.now() },
    ]));
    mockGetTransaction.mockResolvedValue({ status: 'NOT_FOUND' });

    await contractLib.resumePendingTransactions();
    expect(contractLib.getPendingTransactionCount()).toBe(1);
    expect(contractLib.getPendingTransactions()[0].hash).toBe('unconfirmed-hash');
  });

  it('removes confirmed SUCCESS entries without re-adding', async () => {
    const fs = await import('node:fs');
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify([
      { hash: 'confirmed-hash', operation: 'record_payment', submittedAt: Date.now() },
    ]));
    mockGetTransaction.mockResolvedValue({ status: 'SUCCESS' });

    await contractLib.resumePendingTransactions();
    expect(contractLib.getPendingTransactionCount()).toBe(0);
  });

  it('removes confirmed FAILED entries without re-adding', async () => {
    const fs = await import('node:fs');
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify([
      { hash: 'failed-hash', operation: 'record_payment', submittedAt: Date.now() },
    ]));
    mockGetTransaction.mockResolvedValue({ status: 'FAILED' });

    await contractLib.resumePendingTransactions();
    expect(contractLib.getPendingTransactionCount()).toBe(0);
  });

  it('deletes the file after processing all entries', async () => {
    const fs = await import('node:fs');
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify([
      { hash: 'done-hash', operation: 'register_agent', submittedAt: Date.now() },
    ]));
    mockGetTransaction.mockResolvedValue({ status: 'SUCCESS' });
    fs.unlinkSync.mockClear();

    await contractLib.resumePendingTransactions();
    expect(fs.unlinkSync).toHaveBeenCalledWith('pending-transactions.json');
  });
});

describe('submitQueue management', () => {
  beforeEach(() => {
    contractLib.__resetPendingTransactions();
    resetMockServer();
    mockTransactionPollServer();
    mockGetAccount.mockResolvedValue({ sequence: '1' });
    mockSimulateTransaction.mockResolvedValue({ result: { retval: sdkPkg.xdr.ScVal.scvVoid() } });
    contractLib.__setAssembleTransactionForTest((tx) => ({ build: () => tx }));
  });

  afterEach(() => {
    contractLib.__setTransactionPollServerForTest();
    contractLib.__setAssembleTransactionForTest();
  });

  it('reports zero queue depth when idle', () => {
    expect(contractLib.getSubmitQueueDepth()).toBe(0);
  });

  it('drainSubmitQueue resolves when queue is empty', async () => {
    await expect(contractLib.drainSubmitQueue()).resolves.toBeUndefined();
  });

  it('reports positive depth while a transaction is in flight', async () => {
    const contract = new sdkPkg.Contract(VALID_CONTRACT_ID);
    mockSendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'depth-hash' });
    mockGetTransaction.mockResolvedValue({ status: 'SUCCESS', returnValue: sdkPkg.xdr.ScVal.scvVoid() });

    const promise = contractLib.simulateAndSubmit(contract.call('get_service_count'));
    expect(contractLib.getSubmitQueueDepth()).toBeGreaterThan(0);
    await promise;
  });
});
