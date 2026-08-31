/**
 * Machine-readable run summary (#843).
 *
 * The agent logs progress as human-readable lines, which nothing downstream can
 * consume without parsing prose. On completion — success or failure — it now also
 * writes a single JSON document describing the run.
 *
 * The schema is documented in `docs/agent-run-summary.md` and versioned by
 * `schemaVersion`, so a consumer can tell whether it understands the file.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const RUN_SUMMARY_SCHEMA_VERSION = 1;

export const DEFAULT_RUN_SUMMARY_PATH = 'agent-run-summary.json';

/**
 * Resolve the output path. Configurable via `AGENT_RUN_SUMMARY_PATH`; an empty
 * value disables writing entirely, so a deployment that does not want the
 * artefact does not have to tolerate a stray file.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | null} absolute path, or null when disabled
 */
export function resolveRunSummaryPath(env = process.env) {
  const configured = env.AGENT_RUN_SUMMARY_PATH;
  if (configured === '') return null;
  return resolve(configured ?? DEFAULT_RUN_SUMMARY_PATH);
}

/**
 * Build the summary document.
 *
 * `status` is derived rather than passed in: a run is `success` only when every
 * task succeeded, `partial` when some did, and `failure` when none did or the run
 * ended early. A crash is reported explicitly by the caller via `error`.
 *
 * @param {object} input
 * @returns {object} the summary document
 */
export function buildRunSummary({
  agentAddress = null,
  agentName = null,
  startedAt,
  finishedAt = Date.now(),
  tasks = [],
  totalUsdcSpent = 0,
  scoreBefore = null,
  scoreAfter = null,
  unresolvedPayments = [],
  shutdownInitiated = false,
  error = null,
} = {}) {
  const successCount = tasks.filter((t) => t.success).length;
  const failCount = tasks.length - successCount;

  let status;
  if (error) status = 'failure';
  else if (tasks.length === 0) status = 'failure';
  else if (failCount === 0 && !shutdownInitiated) status = 'success';
  else if (successCount > 0) status = 'partial';
  else status = 'failure';

  return {
    schemaVersion: RUN_SUMMARY_SCHEMA_VERSION,
    status,
    agent: { address: agentAddress, name: agentName },
    startedAt: toIso(startedAt),
    finishedAt: toIso(finishedAt),
    durationMs: startedAt ? Math.max(0, finishedAt - startedAt) : null,
    tasks: tasks.map(normaliseTask),
    totals: {
      tasks: tasks.length,
      succeeded: successCount,
      failed: failCount,
      usdcSpent: Number(totalUsdcSpent ?? 0).toFixed(6),
      unresolvedPayments: unresolvedPayments.length,
    },
    score: {
      before: scoreBefore,
      after: scoreAfter,
      delta:
        typeof scoreBefore === 'number' && typeof scoreAfter === 'number'
          ? scoreAfter - scoreBefore
          : null,
    },
    unresolvedPayments,
    shutdownInitiated,
    error: error ? { message: error.message ?? String(error), name: error.name ?? 'Error' } : null,
  };
}

function normaliseTask(task) {
  return {
    category: task.category ?? null,
    success: Boolean(task.success),
    servicesDiscovered: task.servicesDiscovered ?? 0,
    servicesEligible: task.servicesEligible ?? 0,
    selection: task.selection ?? null,
    attempts: task.attempts ?? 0,
    priceUsdc: task.priceUsdc ?? null,
    txHash: task.txHash ?? null,
    scoreAfter: task.scoreAfter ?? null,
    durationMs: task.durationMs ?? null,
    failureReason: task.failureReason ?? null,
  };
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Write the summary to disk. Never throws: failing to write an observability
 * artefact must not change the agent's exit status.
 *
 * @returns {{ written: boolean, path: string | null, error?: string }}
 */
export function writeRunSummary(summary, { path, logger } = {}) {
  const target = path === undefined ? resolveRunSummaryPath() : path;
  if (!target) return { written: false, path: null };

  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(summary, null, 2)}\n`, 'utf-8');
    logger?.info?.(
      { event: 'run_summary_written', path: target, status: summary.status },
      'Run summary written',
    );
    return { written: true, path: target };
  } catch (err) {
    logger?.warn?.(
      { event: 'run_summary_write_failed', path: target, err },
      'Failed to write run summary',
    );
    return { written: false, path: target, error: err?.message ?? String(err) };
  }
}
