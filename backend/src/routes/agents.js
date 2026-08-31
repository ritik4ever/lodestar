import { Router } from 'express';
import {
  listAgentsPage,
  getAgent,
  getAgentPolicy,
  getAgentScore,
  getAgentCount,
  registerAgentOnChain,
  recordPaymentOnChain,
  checkSpendingAllowed,
  isAgentEligible,
  flagAgentOnChain,
  deactivateAgentOnChain,
  adminDeactivateAgentOnChain,
  updatePolicyOnChain,
  buildUnsignedAgentTx,
  submitSignedAgentTx,
  isAgentRegistered,
} from '../lib/contract.js';
import { usdcToStroops, stroopsToUsdcDisplay } from '../lib/stroops.js';
import config from '../config.js';
import { ownerAuth } from '../middleware/ownerAuth.js';
import { adminAuth } from '../middleware/adminAuth.js';
import { hmacAuth } from '../middleware/hmacAuth.js';
import { paymentRateLimiter } from '../middleware/paymentRateLimiter.js';
import { writeRateLimiter } from '../middleware/rateLimiter.js';
import { validateAgentAddressParam, isValidStellarAddress } from '../middleware/addressValidator.js';
import logger from '../lib/logger.js';
import { handleContractError } from '../lib/ContractError.js';
import {
  isValidIdempotencyKey,
  getEntry,
  markPending,
  markComplete,
  markFailed,
} from '../lib/idempotency.js';
import { getActivityFeed, parseActivityPagination } from '../lib/activityFeed.js';

const router = Router();

// Shared page-size constants — keep in sync with frontend/lib/pagination.ts.
// CONTRACT_PAGE_SIZE_CAP must match the .min(20u32) clamp in contract/src/lib.rs
// so the backend never promises a slice larger than the contract can return.
const PAGE_SIZE = 12;
const CONTRACT_PAGE_SIZE_CAP = 20;

// In-memory cache: avoids fetching all agents from Soroban on every paginated request.
// TTL matches the frontend's 30s auto-refresh interval.
let agentsCache = null;
let agentsCacheTime = 0;
const AGENTS_CACHE_TTL = 30_000;

const CACHE_BATCH_SIZE = 50;

async function getCachedAgents() {
  const now = Date.now();
  if (agentsCache && now - agentsCacheTime < AGENTS_CACHE_TTL) return agentsCache;

  const total = await getAgentCount();
  const pages = Math.ceil(total / CACHE_BATCH_SIZE);
  const results = [];
  for (let i = 0; i < pages; i++) {
    const batch = await listAgentsPage(i, CACHE_BATCH_SIZE);
    results.push(...batch);
  }

  agentsCache = results;
  agentsCacheTime = now;
  return agentsCache;
}

function sortAgents(agents, sort) {
  return [...agents].sort((a, b) => {
    if (sort === 'score') return b.score - a.score;
    if (sort === 'payments') return Number(b.total_payments) - Number(a.total_payments);
    return Number(b.registered_at) - Number(a.registered_at);
  });
}

function requireAgentsContract(_req, res, next) {
  if (!config.contract.agentsId) {
    return res.status(503).json({
      error: 'Agents contract not yet deployed. Set AGENTS_CONTRACT_ID in .env',
      code: 'AGENTS_NOT_CONFIGURED',
    });
  }
  next();
}

// GET /api/agents — paginated + sorted list
router.get('/agents', requireAgentsContract, async (req, res) => {
  try {
    const parsedPage = Number.parseInt(String(req.query.page ?? '0'), 10);
    const parsedPageSize = Number.parseInt(String(req.query.pageSize ?? String(PAGE_SIZE)), 10);
    const page = Number.isFinite(parsedPage) ? Math.max(0, parsedPage) : 0;
    const pageSize = Number.isFinite(parsedPageSize) ? Math.min(CONTRACT_PAGE_SIZE_CAP, Math.max(1, parsedPageSize)) : PAGE_SIZE;
    const sort = ['score', 'payments', 'newest'].includes(req.query.sort)
      ? req.query.sort
      : 'score';

    const allAgents = await getCachedAgents();
    const sorted = sortAgents(allAgents, sort);
    const total = sorted.length;
    const agents = sorted.slice(page * pageSize, (page + 1) * pageSize);

    res.json({ agents, total, page, pageSize });
  } catch (err) {
    logger.error({ err }, 'GET /api/agents failed');
    return handleContractError(err, res, 'Failed to fetch agents', 'FETCH_ERROR');
  }
});

// GET /api/agents/count
router.get('/agents/count', requireAgentsContract, async (_req, res) => {
  try {
    const count = await getAgentCount();
    res.json({ count });
  } catch (err) {
    logger.error({ err }, 'GET /api/agents/count failed');
    return handleContractError(err, res, 'Failed to fetch count', 'FETCH_ERROR');
  }
});

// GET /api/agents/stats
router.get('/agents/stats', requireAgentsContract, async (_req, res) => {
  try {
    const agents = await getCachedAgents();
    const totalAgents = agents.length;

    if (totalAgents === 0) {
      return res.json({ totalAgents: 0, avgScore: 0, topAgent: null, totalVolume: '0', totalVolumeStroops: '0' });
    }

    const avgScore = Math.round(agents.reduce((sum, a) => sum + a.score, 0) / totalAgents);
    const topAgent = agents.reduce((best, a) => (a.score > best.score ? a : best), agents[0]);

    const totalVolumeStroops = agents.reduce(
      (sum, a) => sum + BigInt(a.total_volume_stroops),
      0n
    );
    const totalVolume = stroopsToUsdcDisplay(totalVolumeStroops);

    res.json({ totalAgents, avgScore, topAgent, totalVolume, totalVolumeStroops: totalVolumeStroops.toString() });
  } catch (err) {
    logger.error({ err }, 'GET /api/agents/stats failed');
    return handleContractError(err, res, 'Failed to fetch stats', 'FETCH_ERROR');
  }
});

// Param middleware for agent address routes
router.use('/agents/:address', validateAgentAddressParam);

// GET /api/agents/:address
router.get('/agents/:address', requireAgentsContract, async (req, res) => {
  try {
    const { address } = req.params;
    const [agent, policy] = await Promise.all([
      getAgent(address),
      getAgentPolicy(address),
    ]);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found', code: 'NOT_FOUND' });
    }
    res.json({ agent, policy });
  } catch (err) {
    logger.error({ err, address: req.params.address }, 'GET /api/agents/:address failed');
    return handleContractError(err, res, 'Failed to fetch agent', 'FETCH_ERROR');
  }
});

// GET /api/agents/:address/policy
router.get('/agents/:address/policy', requireAgentsContract, async (req, res) => {
  try {
    const { address } = req.params;
    const policy = await getAgentPolicy(address);
    if (!policy) {
      return res.status(404).json({ error: 'Policy not found', code: 'NOT_FOUND' });
    }
    res.json(policy);
  } catch (err) {
    logger.error({ err, address: req.params.address }, 'GET /api/agents/:address/policy failed');
    return handleContractError(err, res, 'Failed to fetch policy', 'FETCH_ERROR');
  }
});

// GET /api/agents/:address/score
router.get('/agents/:address/score', requireAgentsContract, async (req, res) => {
  try {
    const score = await getAgentScore(req.params.address);
    res.json({ score });
  } catch (err) {
    logger.error({ err }, 'GET /api/agents/:address/score failed');
    return handleContractError(err, res, 'Failed to fetch score', 'FETCH_ERROR');
  }
});

// GET /api/agents/:address/eligible?min_score=500
router.get('/agents/:address/eligible', requireAgentsContract, async (req, res) => {
  try {
    const { address } = req.params;
    const minScore = parseInt(req.query.min_score ?? '0', 10);
    const [score, eligible] = await Promise.all([
      getAgentScore(address),
      isAgentEligible(address, minScore),
    ]);
    res.json({ eligible, score, required: minScore });
  } catch (err) {
    logger.error({ err, address: req.params.address }, 'GET /api/agents/:address/eligible failed');
    return handleContractError(err, res, 'Failed to check eligibility', 'FETCH_ERROR');
  }
});

// GET /api/agents/:address/can-spend?amount=0.001&category=weather
router.get('/agents/:address/can-spend', requireAgentsContract, async (req, res) => {
  try {
    const { address } = req.params;
    const amountUsdc = req.query.amount ?? '0';
    const category = req.query.category ?? '';
    const amountStroops = usdcToStroops(amountUsdc);

    const [allowed, policy, agent] = await Promise.all([
      checkSpendingAllowed(address, amountStroops),
      getAgentPolicy(address),
      getAgent(address),
    ]);

    if (!agent) {
      return res.json({ allowed: false, reason: 'Agent not registered' });
    }
    if (agent.flagged) {
      return res.json({ allowed: false, reason: 'Agent is flagged' });
    }
    if (!agent.active) {
      return res.json({ allowed: false, reason: 'Agent is deactivated' });
    }

    // Category check (backend-level since contract stores policy)
    if (policy && policy.allowed_categories.length > 0 && category) {
      if (!policy.allowed_categories.includes(category)) {
        return res.json({
          allowed: false,
          reason: `Category "${category}" not in agent's allowed list`,
        });
      }
    }

    if (!allowed) {
      const maxTx = policy ? BigInt(policy.max_per_tx_stroops) : 0n;
      const dailySpent = policy ? BigInt(policy.daily_spent_stroops) : 0n;
      const maxDay = policy ? BigInt(policy.max_per_day_stroops) : 0n;

      if (amountStroops > maxTx) {
        return res.json({
          allowed: false,
          reason: `Amount exceeds per-transaction limit of $${stroopsToUsdcDisplay(maxTx)} USDC`,
        });
      }
      if (dailySpent + amountStroops > maxDay) {
        return res.json({
          allowed: false,
          reason: `Daily spending limit of $${stroopsToUsdcDisplay(maxDay)} USDC reached`,
        });
      }
      return res.json({ allowed: false, reason: 'Spending policy violation' });
    }

    res.json({ allowed: true, reason: 'OK' });
  } catch (err) {
    logger.error({ err, address: req.params.address }, 'GET /api/agents/:address/can-spend failed');
    return handleContractError(err, res, 'Check failed', 'CHECK_ERROR');
  }
});

// POST /api/agents/register — Body: { agentAddress, name, description }
router.post('/agents/register', requireAgentsContract, writeRateLimiter(), async (req, res) => {
  try {
    const { agentAddress, name, description } = req.body;

    if (!agentAddress || typeof agentAddress !== 'string') {
      return res.status(400).json({ error: '`agentAddress` is required', code: 'INVALID_BODY' });
    }
    if (!isValidStellarAddress(agentAddress)) {
      return res.status(400).json({ error: 'Invalid Stellar address format', code: 'INVALID_BODY' });
    }
    if (!name || typeof name !== 'string' || name.trim().length < 3 || name.trim().length > 64) {
      return res.status(400).json({ error: '`name` must be 3–64 characters', code: 'INVALID_BODY' });
    }
    if (!description || typeof description !== 'string' || description.trim().length < 10 || description.trim().length > 256) {
      return res.status(400).json({ error: '`description` must be 10–256 characters', code: 'INVALID_BODY' });
    }

    const isRegistered = await isAgentRegistered(agentAddress);
    if (isRegistered) {
      logger.info({ agentAddress }, 'Attempted to register an already registered agent');
      return res.status(409).json({ error: 'Agent already registered', code: 'ALREADY_EXISTS', agentAddress });
    }

    const count = await registerAgentOnChain(agentAddress, name.trim(), description.trim());
    agentsCache = null; // invalidate so next request reflects the new agent
    logger.info({ agentAddress, name }, 'Agent registered on-chain');
    res.status(201).json({ success: true, agentCount: count, agentAddress });
  } catch (err) {
    logger.error({ err }, 'POST /api/agents/register failed');
    if (err.message?.includes('already registered')) {
      return res.status(409).json({ error: 'Agent already registered', code: 'ALREADY_EXISTS', agentAddress });
    }
    return handleContractError(err, res, 'Registration failed', 'REGISTER_ERROR');
  }
});

// POST /api/agents/:address/payment — Body: { amountUsdc, success, serviceId }
// Requires header: X-Idempotency-Key — a unique key per logical payment (max 255 printable-ASCII chars).
// Retrying with the same key within 24 h replays the original response without hitting the chain again.
router.post(
  '/agents/:address/payment',
  requireAgentsContract,
  hmacAuth,
  paymentRateLimiter(config.rateLimit.payment.max, config.rateLimit.payment.windowMs),
  async (req, res) => {
    const { address } = req.params;

    // ── 1. Idempotency key validation ─────────────────────────────────────────
    const idempotencyKey = req.headers['x-idempotency-key'];
    if (!idempotencyKey) {
      return res.status(400).json({
        error: 'Missing X-Idempotency-Key header',
        code: 'IDEMPOTENCY_KEY_MISSING',
      });
    }
    if (!isValidIdempotencyKey(idempotencyKey)) {
      return res.status(400).json({
        error: 'X-Idempotency-Key must be 1–255 printable ASCII characters (no spaces)',
        code: 'IDEMPOTENCY_KEY_INVALID',
      });
    }

    // ── 2. Scope the key to this agent address so keys can't collide across agents ──
    const scopedKey = `${address}:${idempotencyKey}`;

    // ── 3. Check for an existing entry ────────────────────────────────────────
    const existing = getEntry(scopedKey);
    if (existing) {
      if (existing.status === 'pending') {
        // A concurrent request with the same key is still in-flight.
        logger.warn({ address, idempotencyKey }, 'Duplicate payment request while in-flight');
        return res.status(409).json({
          error: 'A payment with this idempotency key is already being processed',
          code: 'IDEMPOTENCY_CONFLICT',
        });
      }
      if (existing.status === 'complete') {
        logger.info({ address, idempotencyKey }, 'Replaying idempotent payment response');
        return res.json({ success: true, newScore: existing.result.newScore, idempotent: true });
      }
      if (existing.status === 'failed') {
        // Replay the original error so the caller can inspect it without re-hitting the chain.
        const { httpStatus, error, code } = existing.result;
        return res.status(httpStatus).json({ error, code, idempotent: true });
      }
    }

    // ── 4. Body validation ────────────────────────────────────────────────────
    const { amountUsdc, success, serviceId } = req.body;

    if (typeof amountUsdc !== 'string' && typeof amountUsdc !== 'number') {
      return res.status(400).json({ error: '`amountUsdc` is required', code: 'INVALID_BODY' });
    }
    if (typeof success !== 'boolean') {
      return res.status(400).json({ error: '`success` must be boolean', code: 'INVALID_BODY' });
    }
    if (!serviceId || typeof serviceId !== 'number') {
      return res.status(400).json({ error: '`serviceId` is required', code: 'INVALID_BODY' });
    }

    // ── 5. Validate amount before reserving the idempotency key ──────────────
    let amountStroops;
    try {
      amountStroops = usdcToStroops(amountUsdc);
    } catch {
      return res.status(400).json({ error: `Invalid amountUsdc: "${amountUsdc}"`, code: 'INVALID_BODY' });
    }

    // ── 6. Reserve the key before touching the chain ──────────────────────────
    markPending(scopedKey);

    try {
      await recordPaymentOnChain(address, serviceId, amountStroops, success);
      const agent = await getAgent(address);
      const newScore = agent?.score ?? 0;

      markComplete(scopedKey, { newScore });
      logger.info({ address, serviceId, amountUsdc, success, newScore, idempotencyKey }, 'Payment recorded on-chain');
      return res.json({ success: true, newScore });
    } catch (err) {
      // Derive the HTTP status the error would produce so we can replay it faithfully.
      const httpStatus =
        err.name === 'ContractError' && err.code === 'TRANSACTION_TIMEOUT' ? 504
        : err.name === 'ContractError' ? 400
        : 500;
      const error = err.name === 'ContractError' ? err.message : 'Failed to record payment';
      const code  = err.name === 'ContractError' ? err.code  : 'RECORD_ERROR';

      markFailed(scopedKey, { httpStatus, error, code });
      logger.error({ err, address, idempotencyKey }, 'POST /api/agents/:address/payment failed');
      return res.status(httpStatus).json({ error, code });
    }
  }
);

// GET /api/agents/:address/payment-history
router.get('/agents/:address/payment-history', requireAgentsContract, async (req, res) => {
  try {
    const { address } = req.params;
    const { limit, offset, errors } = parseActivityPagination(req.query);

    if (errors.length > 0) {
      logger.warn({ query: req.query, errors, address }, 'Invalid payment-history pagination params');
      return res.status(400).json({ error: errors.join('; '), code: 'INVALID_PAGINATION' });
    }

    const feed = getActivityFeed();
    const payments = feed.filter(
      (entry) => entry.agent === address && typeof entry.txHash === 'string' && entry.txHash.length > 0
    );

    const total = payments.length;
    const items = payments.slice(offset, offset + limit);
    const hasMore = offset + items.length < total;

    logger.info({ address, limit, offset, total, returned: items.length }, 'Payment history served');
    return res.json({
      payments: items,
      pagination: { total, limit, offset, hasMore },
    });
  } catch (err) {
    logger.error({ err, address: req.params.address }, 'GET /api/agents/:address/payment-history failed');
    return handleContractError(err, res, 'Failed to fetch payment history', 'FETCH_ERROR');
  }
});

// GET /api/agents/:address/check?amount=1000000 (legacy stroops endpoint)
router.get('/agents/:address/check', requireAgentsContract, async (req, res) => {
  try {
    const { address } = req.params;
    const amount = BigInt(req.query.amount ?? '0');
    const allowed = await checkSpendingAllowed(address, amount);
    res.json({ allowed, agentAddress: address, amountStroops: amount.toString() });
  } catch (err) {
    logger.error({ err }, 'GET /api/agents/:address/check failed');
    return handleContractError(err, res, 'Check failed', 'CHECK_ERROR');
  }
});

// ── Owner-signed mutation routes ─────────────────────────────────────────────
// Two-step flow:
//   1. POST /api/agents/:address/build-tx  → returns unsigned XDR for Freighter
//   2. POST /api/agents/:address/submit-signed-tx → submits wallet-signed XDR
//
// The ownerAuth middleware verifies x-caller-address matches the on-chain owner
// before building the XDR, preventing XDR construction for non-owners.

// POST /api/agents/:address/build-tx
// Body: { action: 'flag'|'deactivate'|'update_policy', ...actionParams }
router.post('/agents/:address/build-tx', requireAgentsContract, ownerAuth, async (req, res) => {
  try {
    const { address } = req.params;
    const { action, ...params } = req.body;
    if (!action || !['deactivate', 'update_policy'].includes(action)) {
      return res.status(400).json({ error: '`action` must be deactivate or update_policy', code: 'INVALID_BODY' });
    }
    if (action === 'update_policy') {
      if (!params.maxPerTxStroops || (typeof params.maxPerTxStroops !== 'string' && typeof params.maxPerTxStroops !== 'number')) {
        return res.status(400).json({ error: '`maxPerTxStroops` is required (string or number)', code: 'INVALID_BODY' });
      }
      if (!params.maxPerDayStroops || (typeof params.maxPerDayStroops !== 'string' && typeof params.maxPerDayStroops !== 'number')) {
        return res.status(400).json({ error: '`maxPerDayStroops` is required (string or number)', code: 'INVALID_BODY' });
      }
      if (!Array.isArray(params.allowedCategories)) {
        return res.status(400).json({ error: '`allowedCategories` must be an array of strings', code: 'INVALID_BODY' });
      }
      if (typeof params.minScoreToEarn !== 'number') {
        return res.status(400).json({ error: '`minScoreToEarn` must be a number', code: 'INVALID_BODY' });
      }
    }
    const xdrBase64 = await buildUnsignedAgentTx(action, address, params);
    logger.info({ address, action }, 'Built unsigned agent tx XDR');
    res.json({ xdr: xdrBase64 });
  } catch (err) {
    logger.error({ err }, 'POST /agents/:address/build-tx failed');
    return handleContractError(err, res, 'Failed to build transaction', 'BUILD_TX_ERROR');
  }
});

// POST /api/agents/:address/submit-signed-tx
// Body: { signedXdr: string }
router.post('/agents/:address/submit-signed-tx', requireAgentsContract, async (req, res) => {
  try {
    const { address } = req.params;
    const { signedXdr } = req.body;
    if (!signedXdr || typeof signedXdr !== 'string') {
      return res.status(400).json({ error: '`signedXdr` is required', code: 'INVALID_BODY' });
    }
    const hash = await submitSignedAgentTx(signedXdr);
    agentsCache = null; // invalidate so next read reflects the change
    logger.info({ address, hash }, 'Submitted wallet-signed agent tx');
    res.json({ success: true, hash });
  } catch (err) {
    logger.error({ err }, 'POST /agents/:address/submit-signed-tx failed');
    return handleContractError(err, res, 'Failed to submit transaction', 'SUBMIT_TX_ERROR');
  }
});

// Legacy direct-action routes kept for backwards-compat (server-side signing).
// These still work but owner must pass x-caller-address matching the on-chain owner.
router.post('/agents/:address/flag', requireAgentsContract, adminAuth, async (req, res) => {
  const { address } = req.params;
  try {
    const { reason } = req.body;
    if (!reason || typeof reason !== 'string') {
      return res.status(400).json({ error: '`reason` is required', code: 'INVALID_BODY' });
    }
    await flagAgentOnChain(address, reason);
    logger.info({ address, reason }, 'Agent flagged (legacy route)');
    res.json({ success: true });
  } catch (err) {
    logger.error({ err, address }, 'POST /agents/:address/flag failed');
    return handleContractError(err, res, 'Flagging failed', 'FLAG_ERROR');
  }
});

// POST /api/admin/agents/:address/flag — Admin-only agent flagging
router.post('/admin/agents/:address/flag', requireAgentsContract, adminAuth, async (req, res) => {
  try {
    const { address } = req.params;
    const { reason } = req.body;
    if (!reason || typeof reason !== 'string') {
      return res.status(400).json({ error: '`reason` is required', code: 'INVALID_BODY' });
    }
    const { address: addr } = req.params;
    await flagAgentOnChain(addr, reason);
    logger.info({ address: addr, reason }, 'Agent flagged by admin');
    res.json({ success: true });
  } catch (err) {
    const { address: addr } = req.params;
    logger.error({ err, address: addr }, 'POST /api/admin/agents/:address/flag failed');
    return handleContractError(err, res, 'Flagging failed', 'FLAG_ERROR');
  }
});

// POST /api/admin/agents/:address/deactivate — Admin-only agent deactivation
router.post('/admin/agents/:address/deactivate', requireAgentsContract, adminAuth, async (req, res) => {
  try {
    const { address: addr } = req.params;
    await adminDeactivateAgentOnChain(addr);
    logger.info({ address: addr }, 'Agent deactivated by admin');
    res.json({ success: true });
  } catch (err) {
    const { address: addr } = req.params;
    logger.error({ err, address: addr }, 'POST /api/admin/agents/:address/deactivate failed');
    return handleContractError(err, res, 'Deactivation failed', 'DEACTIVATE_ERROR');
  }
});

router.post('/agents/:address/deactivate', requireAgentsContract, ownerAuth, async (req, res) => {
  const { address } = req.params;
  try {
    await deactivateAgentOnChain(address, req.callerAddress);
    logger.info({ address, caller: req.callerAddress }, 'Agent deactivated by owner');
    res.json({ success: true });
  } catch (err) {
    logger.error({ err, address }, 'POST /agents/:address/deactivate failed');
    return handleContractError(err, res, 'Deactivation failed', 'DEACTIVATE_ERROR');
  }
});


// POST /api/agents/:address/update-policy
router.post('/agents/:address/update-policy', requireAgentsContract, ownerAuth, async (req, res) => {
  const { address } = req.params;
  try {
    const { maxPerTxStroops, maxPerDayStroops, allowedCategories, minScoreToEarn } = req.body;

    // Validation
    if (!maxPerTxStroops || (typeof maxPerTxStroops !== 'string' && typeof maxPerTxStroops !== 'number')) {
      return res.status(400).json({ error: '`maxPerTxStroops` is required (string or number)', code: 'INVALID_BODY' });
    }
    if (!maxPerDayStroops || (typeof maxPerDayStroops !== 'string' && typeof maxPerDayStroops !== 'number')) {
      return res.status(400).json({ error: '`maxPerDayStroops` is required (string or number)', code: 'INVALID_BODY' });
    }
    if (!Array.isArray(allowedCategories)) {
      return res.status(400).json({ error: '`allowedCategories` must be an array of strings', code: 'INVALID_BODY' });
    }
    if (typeof minScoreToEarn !== 'number') {
      return res.status(400).json({ error: '`minScoreToEarn` must be a number', code: 'INVALID_BODY' });
    }

    await updatePolicyOnChain(address, maxPerTxStroops, maxPerDayStroops, allowedCategories, minScoreToEarn, req.callerAddress);
    logger.info({ address, caller: req.callerAddress, maxPerTxStroops, maxPerDayStroops }, 'Agent policy updated');
    res.json({ success: true });
  } catch (err) {
    logger.error({ err, address }, 'POST /agents/:address/update-policy failed');
    return handleContractError(err, res, 'Policy update failed', 'POLICY_ERROR');
  }
});

router.put('/agents/:address/policy', requireAgentsContract, ownerAuth, async (req, res) => {
  const { address } = req.params;
  try {
    const { maxPerTxStroops, maxPerDayStroops, allowedCategories, minScoreToEarn } = req.body;

    // Validation
    if (!maxPerTxStroops || (typeof maxPerTxStroops !== 'string' && typeof maxPerTxStroops !== 'number')) {
      return res.status(400).json({ error: '`maxPerTxStroops` is required (string or number)', code: 'INVALID_BODY' });
    }
    if (!maxPerDayStroops || (typeof maxPerDayStroops !== 'string' && typeof maxPerDayStroops !== 'number')) {
      return res.status(400).json({ error: '`maxPerDayStroops` is required (string or number)', code: 'INVALID_BODY' });
    }
    if (!Array.isArray(allowedCategories)) {
      return res.status(400).json({ error: '`allowedCategories` must be an array of strings', code: 'INVALID_BODY' });
    }
    if (typeof minScoreToEarn !== 'number') {
      return res.status(400).json({ error: '`minScoreToEarn` must be a number', code: 'INVALID_BODY' });
    }

    await updatePolicyOnChain(address, maxPerTxStroops, maxPerDayStroops, allowedCategories, minScoreToEarn, req.callerAddress);
    logger.info({ address, caller: req.callerAddress, maxPerTxStroops, maxPerDayStroops }, 'Agent policy updated');
    res.json({ success: true });
  } catch (err) {
    logger.error({ err, address }, 'PUT /agents/:address/policy failed');
    return handleContractError(err, res, 'Policy update failed', 'POLICY_ERROR');
  }
});

export default router;
