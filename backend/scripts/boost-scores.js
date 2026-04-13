import 'dotenv/config';
import { listAgents, recordPaymentOnChain } from '../src/lib/contract.js';
import logger from '../src/lib/logger.js';

if (!process.env.AGENTS_CONTRACT_ID) {
  logger.error('AGENTS_CONTRACT_ID not set');
  process.exit(1);
}

// Target scores: first agent ~110, second ~600, third ~1000
const TARGETS = [110, 600, 1000];
const AMOUNT = 10_000n; // 0.001 USDC

async function boost() {
  try {
    const agents = await listAgents(10);
    logger.info({ count: agents.length }, 'Fetched agents');

    // Sort by registered_at to get original seed order
    const sorted = [...agents].sort((a, b) => a.registered_at - b.registered_at);

    for (let i = 0; i < Math.min(sorted.length, TARGETS.length); i++) {
      const agent = sorted[i];
      const target = TARGETS[i];
      const currentScore = agent.score;
      const needed = Math.max(0, Math.ceil((target - currentScore) / 10));

      if (needed === 0) {
        logger.info({ name: agent.name, score: currentScore }, 'Score already at target — skipping');
        continue;
      }

      logger.info({ name: agent.name, currentScore, target, payments: needed }, 'Building score…');

      for (let j = 0; j < needed; j++) {
        await recordPaymentOnChain(agent.address, AMOUNT, true);
        if ((j + 1) % 10 === 0) {
          logger.info({ name: agent.name, progress: `${j + 1}/${needed}` }, 'Progress…');
        }
      }

      logger.info({ name: agent.name, targetScore: target }, 'Done');
    }

    logger.info('Score boost complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'boost-scores failed');
    process.exit(1);
  }
}

boost();
