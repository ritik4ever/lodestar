import 'dotenv/config';
import pkg from '@stellar/stellar-sdk';
const { Keypair } = pkg;
import { getAgentCount, registerAgentOnChain, recordPaymentOnChain } from '../src/lib/contract.js';
import logger from '../src/lib/logger.js';

// Generate fresh random keypairs — addresses are stored on-chain so re-runs
// are skipped via the count check (idempotent).
const AGENTS = [
  {
    keypair: Keypair.random(),
    name: 'NewAgent-Alpha',
    description: 'A freshly registered agent. Just getting started on the Lodestar network.',
    payments: [{ amount: 10000, success: true }], // score → 110
  },
  {
    keypair: Keypair.random(),
    name: 'EstablishedAgent-Beta',
    description: 'Mid-tier agent with a solid track record of successful x402 payments.',
    payments: Array(50).fill({ amount: 10000, success: true }), // score → 600
  },
  {
    keypair: Keypair.random(),
    name: 'TrustedAgent-Gamma',
    description: 'High-trust agent. Consistent payment history across weather, search, and finance services.',
    payments: Array(85).fill({ amount: 10000, success: true }), // score → 950
  },
];

async function seed() {
  try {
    if (!process.env.AGENTS_CONTRACT_ID) {
      logger.error('AGENTS_CONTRACT_ID not set — deploy the agents contract first, then run this script');
      process.exit(1);
    }

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
        logger.info({ name: agent.name }, 'Agent registered — building payment history…');

        for (const p of agent.payments) {
          await recordPaymentOnChain(address, BigInt(p.amount), p.success);
        }
        logger.info({ name: agent.name, payments: agent.payments.length }, 'Payment history recorded');
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
