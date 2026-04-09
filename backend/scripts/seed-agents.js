import 'dotenv/config';
import { getAgentCount, registerAgentOnChain, recordPaymentOnChain } from '../src/lib/contract.js';
import logger from '../src/lib/logger.js';

// Three demo agents at different score tiers.
// Each uses a distinct Stellar testnet keypair (public only — server is the owner).
const AGENTS = [
  {
    // Score tier: New (starts at 100, net: 1 successful payment = +10 → 110)
    address: 'GDEMOAGENT1NEWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW',
    name: 'NewAgent-Alpha',
    description: 'A freshly registered agent. Just getting started on the Lodestar network.',
    payments: [{ amount: 10000, success: true }], // score → 110
  },
  {
    // Score tier: Established (100 + 50 successful * 10 = 600)
    address: 'GDEMOAGENT2ESTBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    name: 'EstablishedAgent-Beta',
    description: 'Mid-tier agent with a solid track record of successful x402 payments.',
    payments: Array(50).fill({ amount: 10000, success: true }), // score → 600
  },
  {
    // Score tier: Trusted (100 + 85 successful * 10 - 0 failures = 950)
    address: 'GDEMOAGENT3TRUSTEDCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
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
      try {
        await registerAgentOnChain(agent.address, agent.name, agent.description);
        logger.info({ name: agent.name, address: agent.address }, 'Agent registered');

        // Replay payment history to build score
        for (const p of agent.payments) {
          await recordPaymentOnChain(agent.address, BigInt(p.amount), p.success);
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
