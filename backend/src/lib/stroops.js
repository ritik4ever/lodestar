/**
 * Backend-facing wrapper around the shared conversion package (#853).
 *
 * The conversion logic lives in `packages/stroops` so the backend and the agent
 * cannot drift apart on rounding. This shim adds consistent error wrapping for
 * any driver/library failure before it can reach route responses.
 */

import {
  usdcToStroops as convertUsdcToStroops,
  stroopsToUsdc as convertStroopsToUsdc,
  stroopsToUsdcDisplay as convertStroopsToUsdcDisplay,
  STROOPS_PER_USDC,
} from '../../../packages/stroops/index.js';

export class StroopsError extends Error {
  constructor(operation, input, cause) {
    super(`Stroops conversion failed during ${operation}.`);
    this.name = 'StroopsError';
    this.operation = operation;
    this.input = sanitizeInput(operation, input);
    if (cause) this.cause = cause;
  }
}

function sanitizeInput(operation, input) {
  if (operation === 'usdcToStroops') {
    return { usdc: String(input) };
  }
  if (operation === 'stroopsToUsdc' || operation === 'stroopsToUsdcDisplay') {
    return { stroops: String(input) };
  }
  return { value: String(input) };
}

function wrapStroopsError(operation, input, fn) {
  try {
    return fn();
  } catch (cause) {
    throw new StroopsError(operation, input, cause);
  }
}

export function usdcToStroops(usdc) {
  return wrapStroopsError('usdcToStroops', usdc, () => convertUsdcToStroops(usdc));
}

export function stroopsToUsdc(stroops) {
  return wrapStroopsError('stroopsToUsdc', stroops, () => convertStroopsToUsdc(stroops));
}

export function stroopsToUsdcDisplay(stroops) {
  return wrapStroopsError('stroopsToUsdcDisplay', stroops, () => convertStroopsToUsdcDisplay(stroops));
}

export { STROOPS_PER_USDC };
