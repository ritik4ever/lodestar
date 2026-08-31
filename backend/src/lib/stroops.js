/**
 * Re-export of the shared conversion package (#853).
 *
 * The implementation lives in `packages/stroops` so the backend and the agent
 * cannot drift apart on rounding. This module is kept as the backend's import
 * path so existing callers do not change.
 */

export {
  usdcToStroops,
  stroopsToUsdc,
  stroopsToUsdcDisplay,
  STROOPS_PER_USDC,
} from '../../../packages/stroops/index.js';
