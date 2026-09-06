import logger from '../lib/logger.js';

const STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/;

export function isValidStellarAddress(address) {
  return typeof address === 'string' && STELLAR_ADDRESS_REGEX.test(address);
}

export function validateAgentAddressParam(req, res, next) {
  try {
    const address = req?.params?.address;
    if (!isValidStellarAddress(address)) {
      logger.warn({ address }, 'Invalid agent address parameter');
      return res.status(400).json({
        error: 'Invalid Stellar address format',
        code: 'INVALID_ADDRESS',
      });
    }
    next();
  } catch (err) {
    logger.error({ err }, 'Address validation error');
    if (typeof next === 'function') {
      return next(err);
    }
    throw err;
  }
}
