import 'dotenv/config';
import pkg from '@stellar/stellar-sdk';
const { Keypair } = pkg;
import { getAgentCount, registerAgentOnChain, recordPaymentOnChain } from '../src/lib/contract.js';
import logger from '../src/lib/logger.js';

if (!process.env.AGENTS_CONTRACT_ID) {
  logger.error('AGENTS_CONTRACT_ID not set — deploy the agents contract first');
  process.exit(1);
}

// Use env secrets if provided, otherwise generate ephemeral keypairs.
// Re-runs are idempotent via the agent count check.
function resolveKeypair(envKey) {
  const secret = process.env[envKey];
  if (secret) {
    try {
      return Keypair.fromSecret(secret);
    } catch {
      logger.warn({ envKey }, 'Invalid secret in env — generating random keypair');
    }
  }
  return Keypair.random();
}

const AGENTS = [
  {
    keypair: resolveKeypair('DEMO_AGENT_1_SECRET'),
    name: 'NewAgent',
    description: 'A freshly registered agent. Just getting started on the Lodestar network.',
    successPayments: 1,   // score → 110
    failPayments: 0,
  },
  {
    keypair: resolveKeypair('DEMO_AGENT_2_SECRET'),
    name: 'EstablishedAgent',
    description: 'Mid-tier agent with a solid track record of successful x402 payments.',
    successPayments: 50,  // score → 600
    failPayments: 0,
  },
  {
    keypair: resolveKeypair('DEMO_AGENT_3_SECRET'),
    name: 'TrustedAgent',
    description: 'High-trust agent. Consistent payment history across weather, search, and finance services.',
    successPayments: 90,  // score → 1000 (capped)
    failPayments: 0,
  },
];

async function seed() {
  try {
    const count = await getAgentCount();
    logger.info({ count }, 'Current agent count');

    if (count >= AGENTS.length) {
      logger.info('Agents already seeded — skipping');
      process.exit(0);
    }

    for (const agent of AGENTS) {
      const address = agent.keypair.publicKey();
      try {
        logger.info({ name: agent.name, address }, 'Registering agent…');
        await registerAgentOnChain(address, agent.name, agent.description);
        logger.info({ name: agent.name }, 'Registered — building payment history…');

        const AMOUNT = 10_000n; // 0.001 USDC in stroops

        for (let i = 0; i < agent.successPayments; i++) {
          await recordPaymentOnChain(address, AMOUNT, true);
        }
        for (let i = 0; i < agent.failPayments; i++) {
          await recordPaymentOnChain(address, AMOUNT, false);
        }

        const finalScore = Math.min(
          1000,
          Math.max(0, 100 + agent.successPayments * 10 - agent.failPayments * 25)
        );
        logger.info(
          { name: agent.name, payments: agent.successPayments + agent.failPayments, finalScore },
          'Payment history recorded'
        );
      } catch (err) {
        logger.error({ err, name: agent.name }, 'Failed to seed agent');
      }
    }

    logger.info('Agent seed complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Seed-agents script failed');
    process.exit(1);
  }
}

seed();
