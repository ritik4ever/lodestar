import 'dotenv/config';
import pino from 'pino';
import pkg from '@stellar/stellar-sdk';
const { Keypair } = pkg;
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { createEd25519Signer } from '@x402/stellar';
import { ExactStellarScheme } from '@x402/stellar/exact/client';

// ── Config ────────────────────────────────────────────────────────────────────

const required = [
  'AGENT_STELLAR_SECRET',
  'STELLAR_RPC_URL',
  'LODESTAR_API_URL',
];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

const AGENT_SECRET     = process.env.AGENT_STELLAR_SECRET;
const RPC_URL          = process.env.STELLAR_RPC_URL;
const LODESTAR_API_URL = process.env.LODESTAR_API_URL;
const AGENT_NAME       = process.env.AGENT_NAME ?? 'Lodestar Demo Agent';
const AGENT_DESC       = process.env.AGENT_DESC ?? 'Autonomous x402 agent powered by Lodestar service discovery';

const logger = pino({
  level: 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } },
});

// Derive agent address from secret
const agentKeypair = Keypair.fromSecret(AGENT_SECRET);
const AGENT_ADDRESS = agentKeypair.publicKey();

// ── Agent registration ────────────────────────────────────────────────────────

async function ensureRegistered() {
  try {
    const res = await fetch(`${LODESTAR_API_URL}/api/agents/${AGENT_ADDRESS}`);
    if (res.status === 503) {
      logger.info('Agents contract not yet deployed — skipping registration');
      return false;
    }
    if (res.ok) {
      const agent = await res.json();
      logger.info({ score: agent.score, address: AGENT_ADDRESS }, 'Agent already registered');
      return true;
    }
    if (res.status === 404) {
      logger.info('Agent not registered — registering now…');
      const regRes = await fetch(`${LODESTAR_API_URL}/api/agents/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentAddress: AGENT_ADDRESS,
          name: AGENT_NAME,
          description: AGENT_DESC,
        }),
      });
      if (regRes.ok) {
        logger.info({ address: AGENT_ADDRESS }, 'Agent registered — starting score: 100');
        return true;
      }
      const err = await regRes.json();
      logger.warn({ err }, 'Registration failed — proceeding without scoring');
      return false;
    }
  } catch {
    logger.warn('Could not check agent registration — proceeding without scoring');
  }
  return false;
}

async function getMyScore() {
  try {
    const res = await fetch(`${LODESTAR_API_URL}/api/agents/${AGENT_ADDRESS}/score`);
    if (!res.ok) return null;
    const { score } = await res.json();
    return score;
  } catch {
    return null;
  }
}

async function checkSpending(amountStroops) {
  try {
    const res = await fetch(
      `${LODESTAR_API_URL}/api/agents/${AGENT_ADDRESS}/check?amount=${amountStroops}`
    );
    if (!res.ok) return true; // fail open if service unavailable
    const { allowed } = await res.json();
    return allowed;
  } catch {
    return true; // fail open
  }
}

async function recordOutcome(amountStroops, success) {
  try {
    await fetch(`${LODESTAR_API_URL}/api/agents/${AGENT_ADDRESS}/payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountStroops, success }),
    });
  } catch {
    // non-critical — don't crash the agent
  }
}

// ── x402 client ───────────────────────────────────────────────────────────────

function buildHttpClient() {
  const signer = createEd25519Signer(AGENT_SECRET, 'stellar:testnet');
  const scheme = new ExactStellarScheme(signer, { url: RPC_URL });
  const client = new x402Client().register('stellar:*', scheme);
  return new x402HTTPClient(client);
}

// ── Registry helpers ──────────────────────────────────────────────────────────

async function fetchServices(category) {
  const res = await fetch(`${LODESTAR_API_URL}/api/services?category=${category}`);
  if (!res.ok) throw new Error(`Registry fetch failed: ${res.status}`);
  const body = await res.json();
  return body.services ?? [];
}

async function submitReputation(id, positive) {
  await fetch(`${LODESTAR_API_URL}/api/reputation/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ positive }),
  });
}

// ── Agent task ────────────────────────────────────────────────────────────────

async function runTask(category, buildUrl, scoringEnabled) {
  logger.info(`\n── Task: ${category} ──────────────────────────────────`);

  // 1. Discover
  logger.info('Step 1: Querying Lodestar registry…');
  const services = await fetchServices(category);

  if (!services.length) {
    logger.error(`No services found for category "${category}". Run the seed script first.`);
    return;
  }

  logger.info(`Step 2: Found ${services.length} matching service(s)`);

  // 2. Select best by reputation
  const best = [...services].sort((a, b) => b.reputation - a.reputation)[0];
  logger.info(`Step 3: Selected "${best.name}" at ${best.endpoint} ($${best.price_usdc} USDC)`);

  // 3. Check spending policy (1 USDC = 10,000,000 stroops)
  const priceStroops = Math.round(parseFloat(best.price_usdc) * 10_000_000);
  if (scoringEnabled) {
    const allowed = await checkSpending(priceStroops);
    if (!allowed) {
      logger.warn(
        { priceStroops, address: AGENT_ADDRESS },
        'Spending policy blocks this transaction — skipping'
      );
      return;
    }
    logger.info('Spending policy check passed');
  }

  const endpointUrl = buildUrl(best.endpoint);

  // 4. Build x402 client and make request
  logger.info('Step 4: Sending x402 payment on Stellar…');
  const httpClient = buildHttpClient();

  let response;
  try {
    response = await httpClient.fetch(endpointUrl);
  } catch (err) {
    logger.error({ err }, 'x402 payment failed');
    if (scoringEnabled) await recordOutcome(priceStroops, false);
    return;
  }

  if (!response.ok) {
    logger.error({ status: response.status }, 'Service returned error after payment');
    if (scoringEnabled) await recordOutcome(priceStroops, false);
    return;
  }

  const txHash = response.headers.get('x-payment-transaction') ?? '(no hash)';
  logger.info(`Step 5: Payment confirmed — tx: ${txHash}`);

  const data = await response.json();
  logger.info({ data }, `Paid $${best.price_usdc} USDC — received data`);

  // 5. Record payment outcome for credit scoring
  if (scoringEnabled) {
    await recordOutcome(priceStroops, true);
    const newScore = await getMyScore();
    if (newScore !== null) {
      logger.info({ score: newScore }, 'Credit score updated');
    }
  }

  // 6. Submit positive reputation for the service
  await submitReputation(best.id, true);
  logger.info(`Submitted positive reputation for "${best.name}"`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  logger.info('Lodestar Agent starting — zero hardcoded service URLs');
  logger.info(`Agent address: ${AGENT_ADDRESS}`);

  // Auto-register for credit scoring (gracefully skipped if contract not deployed)
  const scoringEnabled = await ensureRegistered();
  if (scoringEnabled) {
    const score = await getMyScore();
    if (score !== null) {
      logger.info({ score }, 'Current credit score');
    }
  }

  await runTask('weather', (endpoint) => `${endpoint}?lat=40.7128&lon=-74.0060`, scoringEnabled);
  await runTask('search',  (endpoint) => `${endpoint}?q=Stellar+blockchain+AI+agents`, scoringEnabled);

  logger.info('\nAgent complete.');
}

main().catch((err) => {
  logger.error({ err }, 'Agent crashed');
  process.exit(1);
});
