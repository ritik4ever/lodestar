import { getAgent } from '../lib/contract.js';
import config from '../config.js';
import logger from '../lib/logger.js';

/**
 * Middleware to ensure the request is made by the owner of the agent.
 * Expects the caller's Stellar address in the 'x-caller-address' header.
 * Sets `req.callerAddress` on success.
 */
export async function ownerAuth(req, res, next) {
  try {
    const callerAddress = req.headers['x-caller-address'];
    if (!callerAddress || typeof callerAddress !== 'string') {
      return res.status(config.ownerAuth.missing.status).json({ error: 'Caller address missing', code: config.ownerAuth.missing.code });
    }
    const { address } = req.params;
    if (!address) {
      return res.status(config.ownerAuth.invalidParams.status).json({ error: 'Agent address param missing', code: config.ownerAuth.invalidParams.code });
    }
    const agent = await getAgent(address);
    if (!agent) {
      return res.status(config.ownerAuth.notFound.status).json({ error: 'Agent not found', code: config.ownerAuth.notFound.code });
    }
    if (agent.owner !== callerAddress) {
      return res.status(config.ownerAuth.forbidden.status).json({ error: 'Caller is not the owner of this agent', code: config.ownerAuth.forbidden.code });
    }
    // Attach to request for downstream handlers
    req.callerAddress = callerAddress;
    next();
  } catch (err) {
    logger.error({ err }, 'ownerAuth middleware failed');
    res.status(config.ownerAuth.internalError.status).json({ error: 'Internal auth error', code: config.ownerAuth.internalError.code });
  }
}
