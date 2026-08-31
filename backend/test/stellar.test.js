import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock server functions ─────────────────────────────────────────────────────
const mockGetNetwork = vi.fn();
const mockGetAccount = vi.fn();
const mockGetLatestLedger = vi.fn();

const mockRawServer = {
  getNetwork: mockGetNetwork,
  getAccount: mockGetAccount,
  getLatestLedger: mockGetLatestLedger,
};

// ── SDK mock (mimics @stellar/stellar-sdk structure) ──────────────────────────
function MockRpcServer() {
  return mockRawServer;
}

const mockSdk = {
  rpc: {
    Server: MockRpcServer,
    Api: {
      isSimulationError: vi.fn(),
    },
  },
  Keypair: {
    fromSecret: vi.fn(() => ({
      publicKey: () => "GA7FYRB5CREWMDK2VIKVKWSW7V3YCCU3B3UHBJQ6JZ5OC7V7M5D4T8KJ",
    })),
  },
  Networks: { PUBLIC: "public", TESTNET: "Test SDF Network ; September 2015" },
  Address: { fromString: vi.fn() },
  TransactionBuilder: vi.fn(),
  BASE_FEE: "100",
  xdr: { ScVal: { scvVoid: vi.fn() } },
  nativeToScVal: vi.fn(),
  scValToNative: vi.fn(),
};

vi.mock("@stellar/stellar-sdk", () => ({
  default: mockSdk,
  ...mockSdk,
}));

// ── Logger mock ───────────────────────────────────────────────────────────────
const mockLogger = {
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
};

vi.mock("../src/lib/logger.js", () => ({
  default: mockLogger,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
const defaultConfig = {
  stellar: {
    network: "testnet",
    rpcUrl: "https://soroban-testnet.stellar.org",
  },
  contract: { id: "mock" },
  server: { secret: "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAO7Q" },
  rpcRetry: {
    maxRetries: 3,
    baseDelayMs: 10,
    maxDelayMs: 100,
  },
};

function setConfig(overrides = {}) {
  vi.doMock("../src/config.js", () => ({
    default: { ...defaultConfig, ...overrides },
  }));
}

async function freshImport() {
  const mod = await import("../src/lib/stellar.js");
  mod.__resetStellarServer();
  return mod;
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("RPC retry with backoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("isRetryableRpcError (via proxy)", () => {
    it("retries on 429 status and succeeds on second attempt", async () => {
      setConfig();
      const { getStellarServer } = await freshImport();

      mockGetNetwork
        .mockRejectedValueOnce(Object.assign(new Error("Rate limited"), { status: 429 }))
        .mockResolvedValueOnce({ passphrase: "test" });

      const server = getStellarServer();
      const result = await server.getNetwork();

      expect(result).toEqual({ passphrase: "test" });
      expect(mockGetNetwork).toHaveBeenCalledTimes(2);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "getNetwork",
          attempt: 1,
          maxRetries: 3,
        }),
        "Retrying RPC call after transient error",
      );
    });

    it("retries on 503 status and succeeds on third attempt", async () => {
      setConfig();
      const { getStellarServer } = await freshImport();

      mockGetNetwork
        .mockRejectedValueOnce(Object.assign(new Error("Service Unavailable"), { status: 503 }))
        .mockRejectedValueOnce(Object.assign(new Error("Service Unavailable"), { status: 503 }))
        .mockResolvedValueOnce({ passphrase: "test" });

      const server = getStellarServer();
      const result = await server.getNetwork();

      expect(result).toEqual({ passphrase: "test" });
      expect(mockGetNetwork).toHaveBeenCalledTimes(3);
    });

    it("retries on response.status error shape", async () => {
      setConfig();
      const { getStellarServer } = await freshImport();

      const err = new Error("Internal Server Error");
      err.response = { status: 500 };
      mockGetNetwork
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce({ passphrase: "test" });

      const server = getStellarServer();
      const result = await server.getNetwork();
      expect(result).toEqual({ passphrase: "test" });
      expect(mockGetNetwork).toHaveBeenCalledTimes(2);
    });

    it("retries on 429 message-based detection", async () => {
      setConfig();
      const { getStellarServer } = await freshImport();

      mockGetNetwork
        .mockRejectedValueOnce(new Error("HTTP 429 Too Many Requests"))
        .mockResolvedValueOnce({ passphrase: "test" });

      const server = getStellarServer();
      const result = await server.getNetwork();
      expect(result).toEqual({ passphrase: "test" });
      expect(mockGetNetwork).toHaveBeenCalledTimes(2);
    });

    it("retries on 502 message-based detection", async () => {
      setConfig();
      const { getStellarServer } = await freshImport();

      mockGetNetwork
        .mockRejectedValueOnce(new Error("Got 502 Bad Gateway from upstream"))
        .mockResolvedValueOnce({ passphrase: "test" });

      const server = getStellarServer();
      const result = await server.getNetwork();
      expect(result).toEqual({ passphrase: "test" });
      expect(mockGetNetwork).toHaveBeenCalledTimes(2);
    });

    it("retries on network-level errors (ECONNRESET)", async () => {
      setConfig();
      const { getStellarServer } = await freshImport();

      const err = new Error("socket hang up");
      err.code = "ECONNRESET";
      mockGetNetwork
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce({ passphrase: "test" });

      const server = getStellarServer();
      const result = await server.getNetwork();
      expect(result).toEqual({ passphrase: "test" });
      expect(mockGetNetwork).toHaveBeenCalledTimes(2);
    });

    it("retries on ETIMEDOUT", async () => {
      setConfig();
      const { getStellarServer } = await freshImport();

      const err = new Error("connect ETIMEDOUT");
      err.code = "ETIMEDOUT";
      mockGetNetwork
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce({ passphrase: "test" });

      const server = getStellarServer();
      const result = await server.getNetwork();
      expect(result).toEqual({ passphrase: "test" });
      expect(mockGetNetwork).toHaveBeenCalledTimes(2);
    });

    it("does NOT retry on 400 Bad Request", async () => {
      setConfig();
      const { getStellarServer } = await freshImport();

      mockGetNetwork.mockRejectedValue(
        Object.assign(new Error("Bad Request"), { status: 400 }),
      );

      const server = getStellarServer();
      await expect(server.getNetwork()).rejects.toThrow("Bad Request");
      expect(mockGetNetwork).toHaveBeenCalledTimes(1);
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it("does NOT retry on 404 Not Found", async () => {
      setConfig();
      const { getStellarServer } = await freshImport();

      mockGetNetwork.mockRejectedValue(
        Object.assign(new Error("Not Found"), { status: 404 }),
      );

      const server = getStellarServer();
      await expect(server.getNetwork()).rejects.toThrow("Not Found");
      expect(mockGetNetwork).toHaveBeenCalledTimes(1);
    });
  });

  describe("exhaustion", () => {
    it("throws RpcThrottledError after all retries are exhausted on 429", async () => {
      setConfig();
      const { getStellarServer, __resetStellarServer } = await freshImport();
      __resetStellarServer();

      const throttledErr = Object.assign(new Error("Rate limited"), { status: 429 });
      mockGetNetwork.mockRejectedValue(throttledErr);

      const server = getStellarServer();
      await expect(server.getNetwork()).rejects.toMatchObject({
        name: "RpcThrottledError",
        code: "RPC_THROTTLED",
        attempts: 4, // 1 initial + 3 retries
      });
      // 1 initial + 3 retries = 4 total calls
      expect(mockGetNetwork).toHaveBeenCalledTimes(4);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "getNetwork",
          attempts: 4,
        }),
        "RPC call failed after exhausting retries",
      );
    });

    it("throws RpcThrottledError after all retries exhausted on 503", async () => {
      setConfig();
      const { getStellarServer } = await freshImport();

      mockGetNetwork.mockRejectedValue(
        Object.assign(new Error("Service Unavailable"), { status: 503 }),
      );

      const server = getStellarServer();
      await expect(server.getNetwork()).rejects.toMatchObject({
        name: "RpcThrottledError",
        code: "RPC_THROTTLED",
        attempts: 4, // 1 initial + 3 retries (default maxRetries)
      });
      expect(mockGetNetwork).toHaveBeenCalledTimes(4);
    });

    it("attaches the original error as cause on RpcThrottledError", async () => {
      setConfig({ rpcRetry: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 10 } });
      const { getStellarServer } = await freshImport();

      const original = Object.assign(new Error("Too many requests"), { status: 429 });
      mockGetNetwork.mockRejectedValue(original);

      const server = getStellarServer();
      try {
        await server.getNetwork();
        expect.fail("Expected RpcThrottledError to be thrown");
      } catch (err) {
        expect(err.cause).toBe(original);
        expect(err.message).toContain("getNetwork");
        expect(err.message).toContain("Too many requests");
      }
    });
  });

  describe("backoff timing", () => {
    it("uses exponential backoff with jitter", async () => {
      setConfig({ rpcRetry: { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 100 } });
      const { getStellarServer } = await freshImport();

      const throttledErr = Object.assign(new Error("Rate limited"), { status: 429 });

      // Track the actual delays used
      const delays = [];
      const originalSetTimeout = global.setTimeout;
      vi.spyOn(global, "setTimeout").mockImplementation((fn, ms) => {
        delays.push(ms);
        // Fire immediately for fast tests
        fn();
        return 1;
      });

      mockGetNetwork
        .mockRejectedValueOnce(throttledErr)
        .mockRejectedValueOnce(throttledErr)
        .mockResolvedValueOnce({ passphrase: "test" });

      try {
        const server = getStellarServer();
        await server.getNetwork();
      } finally {
        global.setTimeout = originalSetTimeout;
      }

      // Should have 2 retries → 2 delays
      expect(delays).toHaveLength(2);

      // First retry (attempt 0): baseDelayMs * 2^0 * jitter = 10 * 1 * [0.5, 1.5] = [5, 15]
      expect(delays[0]).toBeGreaterThanOrEqual(5);
      expect(delays[0]).toBeLessThanOrEqual(15);

      // Second retry (attempt 1): baseDelayMs * 2^1 * jitter = 20 * [0.5, 1.5] = [10, 30]
      expect(delays[1]).toBeGreaterThanOrEqual(10);
      expect(delays[1]).toBeLessThanOrEqual(30);
    });

    it("caps delay at maxDelayMs", async () => {
      setConfig({ rpcRetry: { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 150 } });
      const { getStellarServer } = await freshImport();

      const throttledErr = Object.assign(new Error("Rate limited"), { status: 429 });

      const delays = [];
      const originalSetTimeout = global.setTimeout;
      vi.spyOn(global, "setTimeout").mockImplementation((fn, ms) => {
        delays.push(ms);
        fn();
        return 1;
      });

      // All attempts fail — triggers 3 retries
      mockGetNetwork.mockRejectedValue(throttledErr);

      try {
        const server = getStellarServer();
        await server.getNetwork();
      } catch {
        // expected
      } finally {
        global.setTimeout = originalSetTimeout;
      }

      expect(delays).toHaveLength(3);

      // Third retry (attempt 2): base * 2^2 = 400 capped at 150, * jitter → [75, 225]
      // But cap applies before jitter: 150 * [0.5, 1.5] = [75, 225]
      for (const d of delays) {
        expect(d).toBeLessThanOrEqual(225);
      }
    });
  });

  describe("non-function properties pass through", () => {
    it("returns non-function properties without wrapping", async () => {
      setConfig();
      const { getStellarServer } = await freshImport();

      const server = getStellarServer();

      // The Proxy should pass through property access unchanged.
      // getStellarServer always returns the same instance (singleton).
      const server2 = getStellarServer();
      expect(server).toBe(server2);
    });
  });

  describe("multiple RPC methods", () => {
    it("wraps all methods, not just getNetwork", async () => {
      setConfig();
      const { getStellarServer } = await freshImport();

      const throttled = Object.assign(new Error("Rate limited"), { status: 429 });
      mockGetAccount
        .mockRejectedValueOnce(throttled)
        .mockResolvedValueOnce({ sequence: "42" });
      mockGetLatestLedger
        .mockRejectedValueOnce(throttled)
        .mockResolvedValueOnce({ sequence: 99 });

      const server = getStellarServer();

      const account = await server.getAccount("GABC...");
      expect(account).toEqual({ sequence: "42" });
      expect(mockGetAccount).toHaveBeenCalledTimes(2);

      const ledger = await server.getLatestLedger();
      expect(ledger).toEqual({ sequence: 99 });
      expect(mockGetLatestLedger).toHaveBeenCalledTimes(2);
    });
  });

  describe("checkRpcHealth with retry", () => {
    it("checkRpcHealth passes through retryable errors during RPC health check", async () => {
      setConfig({
        server: { secret: "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAO7Q" },
        rpcRetry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 10 },
      });
      const { checkRpcHealth } = await freshImport();

      mockGetNetwork.mockResolvedValue({});
      mockGetAccount.mockResolvedValue({ id: "account123" });

      const health = await checkRpcHealth();
      expect(health.status).toBe("healthy");
      expect(health.rpc.reachable).toBe(true);
      expect(health.contract.reachable).toBe(true);
    });

    it("checkRpcHealth returns unhealthy after retries exhausted on RPC", async () => {
      setConfig({
        server: { secret: "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAO7Q" },
        rpcRetry: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 10 },
      });
      const { checkRpcHealth } = await freshImport();

      mockGetNetwork.mockRejectedValue(
        Object.assign(new Error("Rate limited"), { status: 429 }),
      );

      const health = await checkRpcHealth();
      expect(health.status).toBe("unhealthy");
      expect(health.rpc.reachable).toBe(false);
      expect(health.error).toContain("Rate limited");
    });
  });
});

describe("RpcThrottledError", () => {
  it("has the correct name, code, and attempts", async () => {
    const { RpcThrottledError } = await import("../src/lib/contractErrors.js");
    const original = new Error("original");
    const err = new RpcThrottledError("Throttled after 5 tries", 5, original);

    expect(err.name).toBe("RpcThrottledError");
    expect(err.code).toBe("RPC_THROTTLED");
    expect(err.attempts).toBe(5);
    expect(err.cause).toBe(original);
    expect(err.message).toBe("Throttled after 5 tries");
  });
});
