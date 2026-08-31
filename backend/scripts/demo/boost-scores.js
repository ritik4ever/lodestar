/**
 * Demo-only script: boosts agent scores for testnet demonstration purposes.
 *
 * This script exists solely to seed the agent leaderboard with varied scores
 * so the demo UI shows a realistic-looking range of agent tiers. It directly
 * calls recordPaymentOnChain to inflate scores, which would undermine the
 * credibility of the scoring system if run on mainnet.
 *
 * ── Guard ────────────────────────────────────────────────────────────────
 * This script refuses to run against the Stellar mainnet passphrase.
 * Set STELLAR_NETWORK_PASSPHRASE to the testnet passphrase to proceed.
 *
 *   testnet:  Test SDF Network ; September 2015
 *   mainnet:  Public Global Stellar Network ; September 2015
 *
 * ── Usage ────────────────────────────────────────────────────────────────
 *   node scripts/demo/boost-scores.js              # live mode
 *   node scripts/demo/boost-scores.js --dry-run     # preview only
 */

import 'dotenv/config';
import { listAgents, recordPaymentOnChain } from '../../src/lib/contract.js';
import logger from '../../src/lib/logger.js';

const MAINNET_PASSPHRASE = 'Public Global Stellar Network ; September 2015';

const passphrase = process.env.STELLAR_NETWORK_PASSPHRASE;
if (!passphrase || passphrase === MAINNET_PASSPHRASE) {
  logger.error(
    { passphrase },
    'Refusing to run: this is a demo-only script that inflates scores. '
    + 'Set STELLAR_NETWORK_PASSPHRASE to the testnet passphrase '
    + '("Test SDF Network ; September 2015") to proceed.',
  );
  process.exit(1);
}

// Target scores: first agent ~110, second ~600, third ~1000
const TARGETS = [110, 600, 1000];
const AMOUNT = 10_000n; // 0.001 USDC

export async function boost({ dryRun = false, targets = TARGETS, amount = AMOUNT } = {}) {
  try {
    if (!dryRun && !process.env.AGENTS_CONTRACT_ID) {
      logger.error('AGENTS_CONTRACT_ID not set');
      process.exit(1);
    }

    if (dryRun) {
      logger.info('DRY RUN — no transactions will be submitted');
    }

    const agents = await listAgents(10);
    logger.info({ count: agents.length }, 'Fetched agents');

    // Sort by registered_at to get original seed order
    const sorted = [...agents].sort((a, b) => a.registered_at - b.registered_at);

    for (let i = 0; i < Math.min(sorted.length, targets.length); i++) {
      const agent = sorted[i];
      const target = targets[i];
      const currentScore = agent.score;
      const needed = Math.max(0, Math.ceil((target - currentScore) / 10));

      if (needed === 0) {
        logger.info({ name: agent.name, score: currentScore }, 'Score already at target — skipping');
        continue;
      }

      logger.info({ name: agent.name, currentScore, target, payments: needed }, 'Building score…');

      for (let j = 0; j < needed; j++) {
        if (!dryRun) {
          await recordPaymentOnChain(agent.address, amount, true);
        }
        if ((j + 1) % 10 === 0) {
          logger.info({ name: agent.name, progress: `${j + 1}/${needed}` }, 'Progress…');
        }
      }

      logger.info({ name: agent.name, targetScore: target }, 'Done');
    }

    logger.info({ dryRun }, 'Score boost complete');
  } catch (err) {
    logger.error({ err }, 'boost-scores failed');
    process.exit(1);
  }
}

// CLI entry point — only when run directly (not imported)
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('/demo/boost-scores.js') ||
  process.argv[1].endsWith('\\demo\\boost-scores.js')
);

if (isDirectRun) {
  const isDryRun = process.argv.includes('--dry-run');
  boost({ dryRun: isDryRun });
}
