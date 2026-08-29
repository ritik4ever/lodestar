/**
 * Readiness checks (#841).
 *
 * Liveness and readiness answer different questions:
 *
 *   liveness  — is this process running? If not, restart it.
 *   readiness — can this process serve traffic right now? If not, stop routing
 *               to it, but do not restart it.
 *
 * A backend that is up but cannot reach RPC is alive and *not* ready. Conflating
 * the two makes an orchestrator route traffic to instances that cannot serve it,
 * and restart instances whose only problem is a dependency being slow.
 *
 * Every dependency check is bounded by a short timeout: a readiness probe that
 * hangs is worse than one that fails, because the orchestrator learns nothing
 * until its own probe timeout fires.
 */

import logger from './logger.js';
import config from '../config.js';

/** Default per-dependency timeout. Kept well under a typical probe timeout. */
export const READINESS_TIMEOUT_MS = Number(process.env.READINESS_TIMEOUT_MS ?? 2000);

async function withTimeout(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} check timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Time a dependency check and normalise its result.
 * A thrown error is a failed check, never a failed probe.
 */
async function checkDependency(name, required, run, timeoutMs) {
  const startedAt = Date.now();
  try {
    await withTimeout(run(), timeoutMs, name);
    return { name, required, ok: true, latencyMs: Date.now() - startedAt };
  } catch (err) {
    return {
      name,
      required,
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: err?.message ?? String(err),
    };
  }
}

/**
 * Evaluate every dependency the backend needs in order to serve requests.
 *
 * Redis is treated as **optional**: the rate limiter falls back to an in-memory
 * store when it is unavailable, so a Redis outage degrades the service rather
 * than making it unable to serve. It is still reported, so the degradation is
 * visible rather than silent.
 *
 * @param {{ timeoutMs?: number, checkRpc?: () => Promise<unknown>, checkRedis?: (() => Promise<unknown>) | null }} [deps]
 */
export async function checkReadiness(deps = {}) {
  const timeoutMs = deps.timeoutMs ?? READINESS_TIMEOUT_MS;

  const checkRpc =
    deps.checkRpc ??
    (async () => {
      const { getStellarServer } = await import('./stellar.js');
      await getStellarServer().getNetwork();
    });

  const checkRedis =
    deps.checkRedis === undefined
      ? config.redisUrl
        ? async () => {
            const { getRateLimiterRedis } = await import('../middleware/rateLimiter.js');
            const client = getRateLimiterRedis();
            if (!client) throw new Error('Redis client not initialised');
            await client.ping();
          }
        : null
      : deps.checkRedis;

  const checks = [await checkDependency('rpc', true, checkRpc, timeoutMs)];

  if (checkRedis) {
    checks.push(await checkDependency('redis', false, checkRedis, timeoutMs));
  }

  const failedRequired = checks.filter((c) => c.required && !c.ok);
  const failedOptional = checks.filter((c) => !c.required && !c.ok);

  const status = failedRequired.length > 0 ? 'not_ready' : failedOptional.length > 0 ? 'degraded' : 'ready';

  if (status !== 'ready') {
    logger.warn(
      { status, failed: [...failedRequired, ...failedOptional].map((c) => c.name) },
      'Readiness check did not fully pass',
    );
  }

  return {
    // Degraded still serves traffic — only a failed *required* dependency
    // removes the instance from rotation.
    ready: failedRequired.length === 0,
    status,
    checks,
    timestamp: new Date().toISOString(),
  };
}
