import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildRunSummary,
  writeRunSummary,
  resolveRunSummaryPath,
  RUN_SUMMARY_SCHEMA_VERSION,
  DEFAULT_RUN_SUMMARY_PATH,
} from './runSummary.js';

/**
 * Machine-readable run summary (#843).
 */

const START = Date.parse('2026-08-29T10:00:00.000Z');
const END = Date.parse('2026-08-29T10:02:30.000Z');

function successfulTask(overrides = {}) {
  return {
    category: 'weather',
    success: true,
    servicesDiscovered: 4,
    servicesEligible: 3,
    attempts: 1,
    priceUsdc: '0.010000',
    txHash: 'abc123',
    scoreAfter: 72,
    durationMs: 1200,
    selection: {
      serviceId: 'svc-1',
      serviceName: 'Weather API',
      reputation: 90,
      priceUsdc: '0.010000',
      strategy: 'reputation_weighted_random',
      candidatesConsidered: 3,
      minReputation: 0,
    },
    ...overrides,
  };
}

describe('agent run summary (#843)', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lodestar-summary-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  describe('schema', () => {
    it('stamps a schema version so consumers can detect incompatibility', () => {
      const summary = buildRunSummary({ startedAt: START, finishedAt: END, tasks: [successfulTask()] });

      expect(summary.schemaVersion).toBe(RUN_SUMMARY_SCHEMA_VERSION);
      expect(typeof summary.schemaVersion).toBe('number');
    });

    it('carries the fields the issue asks for: services, rationale, amount paid, score', () => {
      const summary = buildRunSummary({
        agentAddress: 'GAGENT',
        agentName: 'lodestar-agent',
        startedAt: START,
        finishedAt: END,
        tasks: [successfulTask()],
        totalUsdcSpent: 0.01,
        scoreBefore: 70,
        scoreAfter: 72,
      });

      expect(summary.tasks[0].servicesDiscovered).toBe(4);
      expect(summary.tasks[0].selection).toMatchObject({
        serviceId: 'svc-1',
        strategy: 'reputation_weighted_random',
        candidatesConsidered: 3,
      });
      expect(summary.totals.usdcSpent).toBe('0.010000');
      expect(summary.score).toEqual({ before: 70, after: 72, delta: 2 });
      expect(summary.agent).toEqual({ address: 'GAGENT', name: 'lodestar-agent' });
    });

    it('emits ISO timestamps and a duration', () => {
      const summary = buildRunSummary({ startedAt: START, finishedAt: END, tasks: [successfulTask()] });

      expect(summary.startedAt).toBe('2026-08-29T10:00:00.000Z');
      expect(summary.finishedAt).toBe('2026-08-29T10:02:30.000Z');
      expect(summary.durationMs).toBe(150000);
    });

    it('is JSON-serialisable with no undefined holes', () => {
      const summary = buildRunSummary({ startedAt: START, finishedAt: END, tasks: [{ category: 'search', success: false }] });
      const roundTripped = JSON.parse(JSON.stringify(summary));

      expect(roundTripped).toEqual(summary);
      expect(roundTripped.tasks[0].selection).toBeNull();
      expect(roundTripped.tasks[0].servicesDiscovered).toBe(0);
    });

    it('leaves score delta null when a score is unavailable', () => {
      const summary = buildRunSummary({ startedAt: START, tasks: [successfulTask()], scoreBefore: null, scoreAfter: 70 });

      expect(summary.score.delta).toBeNull();
    });
  });

  describe('status derivation', () => {
    it('reports success when every task succeeded', () => {
      expect(buildRunSummary({ startedAt: START, tasks: [successfulTask(), successfulTask()] }).status).toBe('success');
    });

    it('reports partial when some tasks failed', () => {
      const summary = buildRunSummary({
        startedAt: START,
        tasks: [successfulTask(), { category: 'search', success: false, failureReason: 'all_candidates_exhausted' }],
      });

      expect(summary.status).toBe('partial');
      expect(summary.totals).toMatchObject({ tasks: 2, succeeded: 1, failed: 1 });
    });

    it('reports failure when no task succeeded', () => {
      expect(
        buildRunSummary({ startedAt: START, tasks: [{ category: 'weather', success: false }] }).status,
      ).toBe('failure');
    });

    it('reports failure for a crashed run', () => {
      const summary = buildRunSummary({ startedAt: START, tasks: [], error: new TypeError('boom') });

      expect(summary.status).toBe('failure');
      expect(summary.error).toEqual({ message: 'boom', name: 'TypeError' });
    });

    it('does not claim success when the run was cut short by shutdown', () => {
      const summary = buildRunSummary({ startedAt: START, tasks: [successfulTask()], shutdownInitiated: true });

      expect(summary.status).toBe('partial');
      expect(summary.shutdownInitiated).toBe(true);
    });

    it('records unresolved payments', () => {
      const summary = buildRunSummary({
        startedAt: START,
        tasks: [{ category: 'search', success: false }],
        unresolvedPayments: [{ category: 'search', serviceId: 'svc-9', priceUsdc: '0.02' }],
      });

      expect(summary.totals.unresolvedPayments).toBe(1);
      expect(summary.unresolvedPayments[0].serviceId).toBe('svc-9');
    });
  });

  describe('writing', () => {
    it('writes valid JSON on success', () => {
      const path = join(dir, 'summary.json');
      const summary = buildRunSummary({ startedAt: START, tasks: [successfulTask()] });

      const result = writeRunSummary(summary, { path });

      expect(result).toMatchObject({ written: true, path });
      expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual(summary);
    });

    it('writes on failure too', () => {
      const path = join(dir, 'failed.json');

      writeRunSummary(buildRunSummary({ startedAt: START, tasks: [], error: new Error('nope') }), { path });

      const written = JSON.parse(readFileSync(path, 'utf-8'));
      expect(written.status).toBe('failure');
      expect(written.error.message).toBe('nope');
    });

    it('creates missing parent directories', () => {
      const path = join(dir, 'nested', 'deeper', 'summary.json');

      expect(writeRunSummary(buildRunSummary({ startedAt: START, tasks: [] }), { path }).written).toBe(true);
      expect(existsSync(path)).toBe(true);
    });

    it('never throws when the path is unwritable', () => {
      // A directory cannot be overwritten by a file.
      const result = writeRunSummary(buildRunSummary({ startedAt: START, tasks: [] }), { path: dir });

      expect(result.written).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('logs where it wrote', () => {
      const logger = { info: vi.fn(), warn: vi.fn() };
      const path = join(dir, 'logged.json');

      writeRunSummary(buildRunSummary({ startedAt: START, tasks: [] }), { path, logger });

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'run_summary_written', path }),
        expect.any(String),
      );
    });
  });

  describe('configurable path', () => {
    it('defaults when the env var is unset', () => {
      vi.stubEnv('AGENT_RUN_SUMMARY_PATH', undefined);

      expect(resolveRunSummaryPath({})).toContain(DEFAULT_RUN_SUMMARY_PATH);
    });

    it('honours AGENT_RUN_SUMMARY_PATH', () => {
      const custom = join(dir, 'custom-name.json');

      expect(resolveRunSummaryPath({ AGENT_RUN_SUMMARY_PATH: custom })).toBe(custom);
    });

    it('resolves a relative path to an absolute one', () => {
      const resolved = resolveRunSummaryPath({ AGENT_RUN_SUMMARY_PATH: 'out/run.json' });

      expect(resolved).toMatch(/out[\\/]run\.json$/);
      expect(resolved).not.toBe('out/run.json');
    });

    it('treats an empty value as "do not write"', () => {
      expect(resolveRunSummaryPath({ AGENT_RUN_SUMMARY_PATH: '' })).toBeNull();
      expect(writeRunSummary(buildRunSummary({ startedAt: START, tasks: [] }), { path: null })).toEqual({
        written: false,
        path: null,
      });
    });
  });
});
