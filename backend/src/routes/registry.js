import { Router } from "express";
import {
  listServices,
  listServicesByProvider,
  getService,
  getServiceCount,
  deactivateServiceOnChain,
  updateReputation,
  isAllowedReputationAgent,
  buildUnsignedRegistryTx,
  validatePreparedRegistrySubmission,
  submitSignedRegistryTx,
  SERVICE_MAX_TTL,
  SERVICE_TTL_WARNING_LEDGERS,
} from "../lib/contract.js";
import { getCurrentLedgerSequence } from "../lib/stellar.js";
import { getReputationHistory } from "../lib/reputationHistory.js";
import logger from "../lib/logger.js";
import { ContractError, handleContractError } from "../lib/ContractError.js";
import { writeRateLimiter } from "../middleware/rateLimiter.js";
import { isValidStellarAddress } from "../middleware/addressValidator.js";

const router = Router();

const PAGE_SIZE = 20;
const SERVICE_CATEGORIES = new Set(["search", "weather", "finance", "ai", "data", "compute"]);
const PRICE_USDC_REGEX = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function normalizePriceUsdc(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const normalized = String(value);
    if (!PRICE_USDC_REGEX.test(normalized)) return null;
    return value >= 0.0001 ? normalized : null;
  }

  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized !== value || !PRICE_USDC_REGEX.test(normalized)) {
    return null;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0.0001) {
    return null;
  }

  return normalized;
}

/**
 * Annotate a service entry with a ttl_warning flag.
 * Returns true when the estimated remaining TTL falls below
 * SERVICE_TTL_WARNING_LEDGERS. Omits the field when currentLedger
 * is unavailable so callers treat absence as "no warning data".
 */
function annotateTtlWarning(service, currentLedger) {
  if (currentLedger == null) return service;
  const expiry = service.registered_at + SERVICE_MAX_TTL;
  const warnOnset = expiry - SERVICE_TTL_WARNING_LEDGERS;
  return { ...service, ttl_warning: currentLedger >= warnOnset };
}

function parsePositiveSafeInteger(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

// Appends ttl_warning:true when the entry's estimated remaining TTL falls
// below SERVICE_TTL_WARNING_LEDGERS. Omits the field entirely when currentLedger
// is unavailable so callers can always treat absence as "no warning data".
function parseFiniteNumericValue(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function annotateTtlWarning(service, currentLedger) {
  const parsedCurrentLedger = parseFiniteNumericValue(currentLedger);
  const registeredAt = parseFiniteNumericValue(service?.registered_at);

  if (parsedCurrentLedger === null || registeredAt === null) {
    return { ...service };
  }

  const expiryLedger = registeredAt + SERVICE_MAX_TTL;
  const warningOnset = expiryLedger - SERVICE_TTL_WARNING_LEDGERS;

  return {
    ...service,
    ttl_warning: parsedCurrentLedger >= warningOnset,
  };
}

router.get("/services", async (req, res) => {
  try {
    const { category, q, offset: offsetStr, limit: limitStr } = req.query;
    const offset = Math.max(0, parseInt(offsetStr, 10) || 0);
    const limit = Math.min(50, Math.max(1, parseInt(limitStr, 10) || PAGE_SIZE));

    const [servicesResult, ledgerResult] = await Promise.allSettled([
      listServices({ category: category || undefined, offset, limit }),
      getCurrentLedgerSequence(),
    ]);

    if (servicesResult.status === "rejected") throw servicesResult.reason;

    if (ledgerResult.status === "rejected") {
      logger.warn(
        { err: ledgerResult.reason },
        "Failed to fetch current ledger for TTL annotation on GET /api/services",
      );
    }

    const currentLedger =
      ledgerResult.status === "fulfilled" ? ledgerResult.value : null;

    let services = servicesResult.value.map((s) =>
      annotateTtlWarning(s, currentLedger),
    );

    if (q && typeof q === "string" && q.trim()) {
      const query = q.trim().toLowerCase();
      services = services.filter(
        (s) =>
          (s.name && s.name.toLowerCase().includes(query)) ||
          (s.description && s.description.toLowerCase().includes(query)),
      );
    }

    res.json({ services, count: services.length });
  } catch (err) {
    return handleContractError(err, res, "Failed to fetch services", "FETCH_ERROR");
  }
});

router.get("/services/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) {
      return res
        .status(400)
        .json({ error: "Invalid service ID", code: "INVALID_ID" });
    }

    const [serviceResult, ledgerResult] = await Promise.allSettled([
      getService(id),
      getCurrentLedgerSequence(),
    ]);

    if (serviceResult.status === "rejected") throw serviceResult.reason;

    const service = serviceResult.value;
    if (!service) {
      return res
        .status(404)
        .json({ error: "Service not found", code: "NOT_FOUND" });
    }

    if (ledgerResult.status === "rejected") {
      logger.warn(
        { err: ledgerResult.reason },
        "Failed to fetch current ledger for TTL annotation on GET /api/services/:id",
      );
    }

    const currentLedger =
      ledgerResult.status === "fulfilled" ? ledgerResult.value : null;
    res.json(annotateTtlWarning(service, currentLedger));
  } catch (err) {
    return handleContractError(err, res, "Failed to fetch service", "FETCH_ERROR");
  }
});

/**
 * POST /api/services/:id/deactivate
 * Provider-authenticated deactivation. The caller must supply a valid
 * `providerAddress` that matches the service's registered provider.
 * The on-chain contract enforces `provider.require_auth()` so the returned
 * unsigned transaction must be signed by the provider's wallet (e.g.
 * Freighter) and submitted through POST /api/registry/submit-signed-tx.
 *
 * Body: { providerAddress: string }
 * Returns: { xdr, submitToken } — unsigned tx ready for wallet signing
 */
router.post("/services/:id/deactivate", writeRateLimiter(), async (req, res) => {
  const parsedId = parsePositiveSafeInteger(req.params.id);
  if (parsedId == null) {
    return res
      .status(400)
      .json({ error: "Invalid service ID", code: "INVALID_ID" });
  }

  try {
    const { providerAddress } = req.body ?? {};
    if (!isValidStellarAddress(providerAddress)) {
      return res.status(400).json({
        error: "`providerAddress` must be a valid Stellar address",
        code: "INVALID_BODY",
      });
    }

    const prepared = await deactivateServiceOnChain(parsedId, providerAddress);
    logger.info({ id: parsedId, providerAddress }, "Built unsigned deactivation tx");
    res.json(prepared);
  } catch (err) {
    return handleContractError(err, res, "Failed to deactivate service", "DEACTIVATE_ERROR");
  }
});

router.get("/services/:id/history", async (req, res) => {
  let id;
  try {
    id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) {
      return res
        .status(400)
        .json({ error: "Invalid service ID", code: "INVALID_ID" });
    }
    const service = await getService(id);
    if (!service) {
      return res
        .status(404)
        .json({ error: "Service not found", code: "NOT_FOUND" });
    }
    const history = getReputationHistory(id);
    res.json({ history });
  } catch (err) {
    return handleContractError(err, res, "Failed to fetch reputation history", "FETCH_ERROR");
  }
});

router.get("/stats", async (req, res) => {
  try {
    const totalServices = await getServiceCount();
    const totalPages = Math.ceil(totalServices / PAGE_SIZE);
    let allServices = [];
    for (let i = 0; i < totalPages; i++) {
      const page = await listServices({ offset: i * PAGE_SIZE, limit: PAGE_SIZE });
      allServices.push(...page);
    }

    const categories = [...new Set(allServices.map((s) => s.category))];
    const latestService = allServices.reduce(
      (latest, s) =>
        s.registered_at > (latest?.registered_at ?? 0) ? s : latest,
      null,
    );

    res.json({ totalServices, categories, latestService });
  } catch (err) {
    return handleContractError(err, res, "Failed to fetch stats", "FETCH_ERROR");
  }
});

router.get("/registry/by-provider/:address", async (req, res) => {
  try {
    const { address } = req.params;
    if (!isValidStellarAddress(address)) {
      return res.status(400).json({
        error: "Invalid Stellar address format",
        code: "INVALID_ADDRESS",
      });
    }

    const [servicesResult, ledgerResult] = await Promise.allSettled([
      listServicesByProvider(address),
      getCurrentLedgerSequence(),
    ]);

    if (servicesResult.status === "rejected") throw servicesResult.reason;

    if (ledgerResult.status === "rejected") {
      logger.warn(
        { err: ledgerResult.reason },
        "Failed to fetch current ledger for TTL annotation on GET /api/registry/by-provider/:address",
      );
    }

    const currentLedger =
      ledgerResult.status === "fulfilled" ? ledgerResult.value : null;

    const services = servicesResult.value.map((s) =>
      annotateTtlWarning(s, currentLedger),
    );

    res.json({ services, count: services.length });
  } catch (err) {
    return handleContractError(err, res, "Failed to fetch services", "FETCH_ERROR");
  }
});

router.post("/registry/prepare-register", writeRateLimiter(), async (req, res) => {
  try {
    const {
      name,
      description,
      endpoint,
      priceUsdc,
      category,
      providerAddress,
      payTo,
    } = req.body ?? {};

    if (!isValidStellarAddress(providerAddress)) {
      return res.status(400).json({ error: "`providerAddress` must be a valid Stellar address", code: "INVALID_BODY" });
    }
    if (typeof name !== "string" || name.trim().length < 3 || name.trim().length > 64) {
      return res.status(400).json({ error: "`name` must be 3-64 characters", code: "INVALID_BODY" });
    }
    if (typeof description !== "string" || description.trim().length < 10 || description.trim().length > 256) {
      return res.status(400).json({ error: "`description` must be 10-256 characters", code: "INVALID_BODY" });
    }
    if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) {
      return res.status(400).json({ error: "`endpoint` must start with https://", code: "INVALID_BODY" });
    }
    if (endpoint.trim().length > 256) {
      return res.status(400).json({ error: "`endpoint` must be at most 256 characters", code: "INVALID_BODY" });
    }
    if (!SERVICE_CATEGORIES.has(category)) {
      return res.status(400).json({ error: "`category` is invalid", code: "INVALID_BODY" });
    }

    const normalizedPriceUsdc = normalizePriceUsdc(priceUsdc);
    if (!normalizedPriceUsdc) {
      return res.status(400).json({ error: "`priceUsdc` must be at least 0.0001", code: "INVALID_BODY" });
    }
    if (payTo !== undefined && (typeof payTo !== "string" || payTo.trim().length === 0)) {
      return res.status(400).json({ error: "`payTo` must be a non-empty string when provided", code: "INVALID_BODY" });
    }

    const prepared = await buildUnsignedRegistryTx("register", providerAddress, {
      name: name.trim(),
      description: description.trim(),
      endpoint: endpoint.trim(),
      priceUsdc: normalizedPriceUsdc,
      category,
      payTo: payTo?.trim(),
    });
    logger.info({ providerAddress, endpoint, category }, "Built unsigned registry registration tx");
    res.json(prepared);
  } catch (err) {
    return handleContractError(err, res, "Failed to build transaction", "BUILD_TX_ERROR");
  }
});

router.post("/registry/prepare-deactivate", writeRateLimiter(), async (req, res) => {
  try {
    const { providerAddress, id } = req.body ?? {};
    if (!isValidStellarAddress(providerAddress)) {
      return res.status(400).json({ error: "`providerAddress` must be a valid Stellar address", code: "INVALID_BODY" });
    }

    const parsedId = parsePositiveSafeInteger(id);
    if (parsedId == null) {
      return res.status(400).json({ error: "`id` must be a positive integer", code: "INVALID_BODY" });
    }

    const prepared = await buildUnsignedRegistryTx("deactivate", providerAddress, { id: parsedId });
    logger.info({ providerAddress, id: parsedId }, "Built unsigned registry deactivation tx");
    res.json(prepared);
  } catch (err) {
    return handleContractError(err, res, "Failed to build transaction", "BUILD_TX_ERROR");
  }
});

router.post("/registry/submit-signed-tx", writeRateLimiter(), async (req, res) => {
  try {
    const { signedXdr, submitToken } = req.body ?? {};
    if (!signedXdr || typeof signedXdr !== "string") {
      return res.status(400).json({ error: "`signedXdr` is required", code: "INVALID_BODY" });
    }
    if (!submitToken || typeof submitToken !== "string") {
      return res.status(400).json({ error: "`submitToken` is required", code: "INVALID_BODY" });
    }
    validatePreparedRegistrySubmission(submitToken, signedXdr);

    const result = await submitSignedRegistryTx(signedXdr);
    logger.info({ hash: result.hash, id: result.id }, "Submitted wallet-signed registry tx");
    res.json({ success: true, ...result });
  } catch (err) {
    return handleContractError(err, res, "Failed to submit transaction", "SUBMIT_TX_ERROR");
  }
});

// POST /api/reputation/:id — Body: { positive: boolean, agent: string }
// `agent` must be a registered agent the backend is allowed to sign for. The
// on-chain contract enforces require_auth + agent registration + a per-agent
// cooldown, so reputation can no longer be moved by anonymous callers.
router.post("/reputation/:id", writeRateLimiter(), async (req, res) => {
  let id;
  try {
    id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) {
      return res
        .status(400)
        .json({ error: "Invalid service ID", code: "INVALID_ID" });
    }

    // Default to {} so a missing/non-JSON body yields a 400 INVALID_BODY rather
    // than a TypeError surfacing as a generic 500.
    const { positive, agent } = req.body ?? {};
    if (typeof positive !== "boolean") {
      return res
        .status(400)
        .json({ error: "`positive` must be a boolean", code: "INVALID_BODY" });
    }
    if (!isValidStellarAddress(agent)) {
      return res.status(400).json({
        error: "`agent` must be a valid Stellar address",
        code: "INVALID_BODY",
      });
    }
    if (!isAllowedReputationAgent(agent)) {
      return res.status(403).json({
        error:
          "This agent is not permitted to vote through the hosted backend. Only registered demo agents may; other agents must submit a wallet-signed transaction.",
        code: "AGENT_NOT_ALLOWED",
      });
    }

    const newReputation = await updateReputation(id, positive, agent);
    res.json({ success: true, newReputation });
  } catch (err) {
    return handleContractError(err, res, "Failed to update reputation", "UPDATE_ERROR");
  }
});

router.get("/health", async (req, res) => {
  const { default: config } = await import("../config.js");
  const { checkRpcHealth } = await import("../lib/stellar.js");
  try {
    const health = await checkRpcHealth();
    res.json({
      status: health.status,
      network: config.stellar.network,
      contractId: config.contract.id,
      rpc: health.rpc,
      contract: health.contract,
      timestamp: new Date().toISOString(),
      ...(health.error && { error: health.error }),
    });
  } catch (err) {
    logger.error({ err }, "GET /api/health failed");
    res.status(500).json({
      status: "unhealthy",
      error: "Health check failed",
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
