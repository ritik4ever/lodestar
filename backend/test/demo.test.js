import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import demoRouter from "../src/routes/demo.js";
import * as contract from "../src/lib/contract.js";

vi.mock("../src/lib/contract.js", () => ({
  getService: vi.fn(),
}));

vi.mock("../src/routes/demoValidate.js", () => ({
  validateDemoEndpoint: vi.fn().mockReturnValue("http://localhost:9999/demo"),
}));

vi.mock("@x402/core/client", () => {
  return {
    x402Client: vi.fn().mockImplementation(() => ({
      register: vi.fn().mockReturnThis(),
    })),
    x402HTTPClient: vi.fn().mockImplementation(() => ({
      fetchWithTx: vi.fn(),
    })),
  };
});

vi.mock("@x402/stellar", () => ({
  createEd25519Signer: vi.fn(),
}));

vi.mock("@x402/stellar/exact/client", () => ({
  ExactStellarScheme: vi.fn(),
}));

const app = express();
app.use(express.json());
app.use("/api", demoRouter);

describe("POST /api/demo-run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 if serviceId or category is missing", async () => {
    const res = await request(app).post("/api/demo-run").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("serviceId and category are required");
  });

  it("handles AbortError appropriately", async () => {
    contract.getService.mockResolvedValue({ name: "Test Service", endpoint: "test", price_usdc: "1" });
    
    // We mock fetchWithTx to throw an AbortError to simulate client cancelling the request
    const { x402HTTPClient } = await import("@x402/core/client");
    x402HTTPClient.mockImplementationOnce(() => ({
      fetchWithTx: vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" })),
    }));

    const res = await request(app).post("/api/demo-run").send({ serviceId: 1, category: "weather" });
    expect(res.status).toBe(499);
    expect(res.body.code).toBe("CANCELLED");
  });
});
