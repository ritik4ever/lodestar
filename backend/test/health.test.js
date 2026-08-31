import { describe, it, expect, vi, beforeEach } from "vitest";

const mockServer = {
  getNetwork: vi.fn(),
  getAccount: vi.fn(),
};

function MockRpcServer() {
  return mockServer;
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

vi.mock("../src/lib/logger.js", () => ({
  default: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe("checkRpcHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns healthy status when RPC and contract are reachable", async () => {
    vi.doMock("../src/config.js", () => ({
      default: {
        stellar: { network: "testnet", rpcUrl: "https://soroban-testnet.stellar.org" },
        contract: { id: "mock" },
        server: { secret: "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAO7Q" },
        rpcRetry: { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100 },
      },
    }));

    const { checkRpcHealth, __resetStellarServer } = await import("../src/lib/stellar.js");
    __resetStellarServer();

    mockServer.getNetwork.mockResolvedValue({});
    mockServer.getAccount.mockResolvedValue({ id: "account123" });

    const health = await checkRpcHealth();

    expect(health.status).toBe("healthy");
    expect(health.rpc.reachable).toBe(true);
    expect(health.contract.reachable).toBe(true);
    expect(health.error).toBeNull();
  });

  it("returns unhealthy status when RPC is unreachable", async () => {
    vi.doMock("../src/config.js", () => ({
      default: {
        stellar: { network: "testnet", rpcUrl: "https://soroban-testnet.stellar.org" },
        contract: { id: "mock" },
        server: { secret: "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAO7Q" },
        rpcRetry: { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100 },
      },
    }));

    const { checkRpcHealth, __resetStellarServer } = await import("../src/lib/stellar.js");
    __resetStellarServer();

    mockServer.getNetwork.mockRejectedValue(new Error("Connection refused"));

    const health = await checkRpcHealth();

    expect(health.status).toBe("unhealthy");
    expect(health.rpc.reachable).toBe(false);
    expect(health.error).toBe("Connection refused");
  });

  it("returns degraded status when contract is unreachable but RPC is up", async () => {
    vi.doMock("../src/config.js", () => ({
      default: {
        stellar: { network: "testnet", rpcUrl: "https://soroban-testnet.stellar.org" },
        contract: { id: "mock" },
        server: { secret: "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAO7Q" },
        rpcRetry: { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100 },
      },
    }));

    const { checkRpcHealth, __resetStellarServer } = await import("../src/lib/stellar.js");
    __resetStellarServer();

    mockServer.getNetwork.mockResolvedValue({});
    mockServer.getAccount.mockRejectedValue(new Error("Account not found"));

    const health = await checkRpcHealth();

    expect(health.status).toBe("degraded");
    expect(health.rpc.reachable).toBe(true);
    expect(health.contract.reachable).toBe(false);
    expect(health.contract.error).toBe("Account not found");
  });

  it("measures RPC latency", async () => {
    vi.doMock("../src/config.js", () => ({
      default: {
        stellar: { network: "testnet", rpcUrl: "https://soroban-testnet.stellar.org" },
        contract: { id: "mock" },
        server: { secret: "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAO7Q" },
      },
    }));

    const { checkRpcHealth } = await import("../src/lib/stellar.js");

    mockServer.getNetwork.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({}), 50);
        }),
    );
    mockServer.getAccount.mockResolvedValue({ id: "account123" });

    const health = await checkRpcHealth();

    expect(health.rpc.reachable).toBe(true);
    expect(health.rpc.latency).toBeGreaterThanOrEqual(0);
    expect(health.rpc.latency).toBeLessThan(1000);
  });

  it("includes timestamp in ISO format", async () => {
    vi.doMock("../src/config.js", () => ({
      default: {
        stellar: { network: "testnet", rpcUrl: "https://soroban-testnet.stellar.org" },
        contract: { id: "mock" },
        server: { secret: "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAO7Q" },
        rpcRetry: { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100 },
      },
    }));

    const { checkRpcHealth, __resetStellarServer } = await import("../src/lib/stellar.js");
    __resetStellarServer();

    mockServer.getNetwork.mockResolvedValue({});
    mockServer.getAccount.mockResolvedValue({ id: "account123" });

    const health = await checkRpcHealth();

    expect(health.timestamp).toBeDefined();
    expect(() => new Date(health.timestamp)).not.toThrow();
  });
});
