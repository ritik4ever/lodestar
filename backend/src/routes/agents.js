import { Router } from 'express';
import {
  listAgents,
  getAgent,
  getAgentPolicy,
  getAgentScore,
  getAgentCount,
  registerAgentOnChain,
  recordPaymentOnChain,
  checkSpendingAllowed,
} from '../lib/contract.js';
import config from '../config.js';
import logger from '../lib/logger.js';

const router = Router();

// Guard — returns 503 if agents contract not configured
function requireAgentsContract(req, res, next) {
  if (!config.contract.agentsId) {
    return res.status(503).json({
      error: 'Agents contract not yet deployed. Set AGENTS_CONTRACT_ID in .env',
      code: 'AGENTS_NOT_CONFIGURED',
    });
  }
  next();
}

// GET /api/agents — list all agents (limit via query)
router.get('/agents', requireAgentsContract, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 100);
    const agents = await listAgents(limit);
    res.json({ agents, count: agents.length });
  } catch (err) {
    logger.error({ err }, 'GET /api/agents failed');
    res.status(500).json({ error: 'Failed to fetch agents', code: 'FETCH_ERROR' });
  }
});

// GET /api/agents/count
router.get('/agents/count', requireAgentsContract, async (req, res) => {
  try {
    const count = await getAgentCount();
    res.json({ count });
  } catch (err) {
    logger.error({ err }, 'GET /api/agents/count failed');
    res.status(500).json({ error: 'Failed to fetch count', code: 'FETCH_ERROR' });
  }
});

// GET /api/agents/:address
router.get('/agents/:address', requireAgentsContract, async (req, res) => {
  try {
    const { address } = req.params;
    const agent = await getAgent(address);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found', code: 'NOT_FOUND' });
    }
    res.json(agent);
  } catch (err) {
    logger.error({ err, address: req.params.address }, 'GET /api/agents/:address failed');
    res.status(500).json({ error: 'Failed to fetch agent', code: 'FETCH_ERROR' });
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
    res.status(500).json({ error: 'Failed to fetch policy', code: 'FETCH_ERROR' });
  }
});

// GET /api/agents/:address/score
router.get('/agents/:address/score', requireAgentsContract, async (req, res) => {
  try {
    const score = await getAgentScore(req.params.address);
    res.json({ score });
  } catch (err) {
    logger.error({ err }, 'GET /api/agents/:address/score failed');
    res.status(500).json({ error: 'Failed to fetch score', code: 'FETCH_ERROR' });
  }
});

// POST /api/agents/register
// Body: { agentAddress, name, description }
router.post('/agents/register', requireAgentsContract, async (req, res) => {
  try {
    const { agentAddress, name, description } = req.body;

    if (!agentAddress || typeof agentAddress !== 'string') {
      return res.status(400).json({ error: '`agentAddress` is required', code: 'INVALID_BODY' });
    }
    if (!name || typeof name !== 'string' || name.length > 64) {
      return res.status(400).json({ error: '`name` is required (max 64 chars)', code: 'INVALID_BODY' });
    }
    if (!description || typeof description !== 'string' || description.length > 256) {
      return res.status(400).json({ error: '`description` is required (max 256 chars)', code: 'INVALID_BODY' });
    }

    const count = await registerAgentOnChain(agentAddress, name, description);
    logger.info({ agentAddress, name }, 'Agent registered on-chain');
    res.status(201).json({ success: true, agentCount: count, agentAddress });
  } catch (err) {
    logger.error({ err }, 'POST /api/agents/register failed');
    if (err.message?.includes('already registered')) {
      return res.status(409).json({ error: 'Agent already registered', code: 'ALREADY_EXISTS' });
    }
    res.status(500).json({ error: 'Registration failed', code: 'REGISTER_ERROR' });
  }
});

// POST /api/agents/:address/payment
// Body: { amountStroops, success }
router.post('/agents/:address/payment', requireAgentsContract, async (req, res) => {
  try {
    const { address } = req.params;
    const { amountStroops, success } = req.body;

    if (typeof amountStroops !== 'number' && typeof amountStroops !== 'string') {
      return res.status(400).json({ error: '`amountStroops` is required', code: 'INVALID_BODY' });
    }
    if (typeof success !== 'boolean') {
      return res.status(400).json({ error: '`success` must be boolean', code: 'INVALID_BODY' });
    }

    await recordPaymentOnChain(address, BigInt(amountStroops), success);
    const agent = await getAgent(address);
    res.json({ success: true, newScore: agent?.score ?? 0 });
  } catch (err) {
    logger.error({ err, address: req.params.address }, 'POST /api/agents/:address/payment failed');
    res.status(500).json({ error: 'Failed to record payment', code: 'RECORD_ERROR' });
  }
});

// GET /api/agents/:address/check?amount=1000000
router.get('/agents/:address/check', requireAgentsContract, async (req, res) => {
  try {
    const { address } = req.params;
    const amount = BigInt(req.query.amount ?? '0');
    const allowed = await checkSpendingAllowed(address, amount);
    res.json({ allowed, agentAddress: address, amountStroops: amount.toString() });
  } catch (err) {
    logger.error({ err }, 'GET /api/agents/:address/check failed');
    res.status(500).json({ error: 'Check failed', code: 'CHECK_ERROR' });
  }
});

export default router;
