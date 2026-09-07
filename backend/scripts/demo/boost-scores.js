import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { listAgents, recordPaymentOnChain } from '../../src/lib/contract.js';
import logger from '../../src/lib/logger.js';

const MAINNET_PASSPHRASE = 'Public Global Stellar Network ; September 2015';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const deploymentsPath = path.resolve(__dirname, '../../..', 'contract/deployments.json');
let knownContractIds = [];
try {
  const deployments = JSON.parse(readFileSync(deploymentsPath, 'utf8'));
  knownContractIds = (deployments.contracts ?? []).map((c) => c.contractId).filter(Boolean);
} catch (err) {
  logger.warn({ err }, 'Could not load deployments.json');
}

const demoMode = process.env.DEMO_MODE === 'true' || process.env.DEMO_MODE === '1';
const passphrase = process.env.STELLAR_NETWORK_PASSPHRASE;
const agentsContractId = process.env.AGENTS_CONTRACT_ID;

if (!demoMode) {
  logger.error('Refusing to run: set DEMO_MODE=true (demo-only script)');
  process.exit(1);
}
if (!passphrase || passphrase === MAINNET_PASSPHRASE) {
  logger.error('Refusing to run: demo-only script requires testnet passphrase');
  process.exit(1);
}
if (agentsContractId && knownContractIds.includes(agentsContractId)) {
  logger.error('Refusing to run: target contract is a known deployment');
  process.exit(1);
}

const TARGETS = [110, 600, 1000];
const AMOUNT = 10_000n;

export async function boost({ dryRun = false, targets = TARGETS, amount = AMOUNT } = {}) {
  try {
    if (!dryRun && !agentsContractId) {
      logger.error('AGENTS_CONTRACT_ID not set');
      process.exit(1);
    }
    const agents = await listAgents(10);
    const sorted = [...agents].sort((a, b) => a.registered_at - b.registered_at);
    for (let i = 0; i < Math.min(sorted.length, targets.length); i++) {
      const agent = sorted[i];
      const needed = Math.max(0, Math.ceil((targets[i] - agent.score) / 10));
      for (let j = 0; j < needed; j++) {
        if (!dryRun) await recordPaymentOnChain(agent.address, amount, true);
      }
      logger.info({ name: agent.name, target: targets[i] }, 'boosted');
    }
    logger.info({ dryRun }, 'complete');
  } catch (err) {
    logger.error({ err }, 'boost-scores failed');
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('/demo/boost-scores.js') || process.argv[1]?.endsWith('\\demo\\boost-scores.js')) {
  boost({ dryRun: process.argv.includes('--dry-run') });
}
