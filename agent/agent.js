import 'dotenv/config';
import pino from 'pino';
import pkg from '@stellar/stellar-sdk';
const { Keypair } = pkg;
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { createEd25519Signer } from '@x402/stellar';
import { ExactStellarScheme } from '@x402/stellar/exact/client';

// ── Config ────────────────────────────────────────────────────────────────────

const required = ['AGENT_STELLAR_SECRET', 'STELLAR_RPC_URL', 'LODESTAR_API_URL'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
}

const AGENT_SECRET     = process.env.AGENT_STELLAR_SECRET;
const RPC_URL          = process.env.STELLAR_RPC_URL;
const LODESTAR_API_URL = process.env.LODESTAR_API_URL;
const AGENT_NAME       = process.env.AGENT_NAME ?? 'LodestarAgent';
const AGENT_DESC       = process.env.AGENT_DESC ?? 'Autonomous x402 agent powered by Lodestar service discovery';
const MAX_PER_TX       = process.env.AGENT_MAX_PER_TX ?? '0.001';
const MAX_PER_DAY      = process.env.AGENT_MAX_PER_DAY ?? '1.00';
const ALLOWED_CATS     = (process.env.AGENT_ALLOWED_CATEGORIES ?? '').split(',').filter(Boolean);

const agentKeypair = Keypair.fromSecret(AGENT_SECRET);
const AGENT_ADDRESS = agentKeypair.publicKey();

const logger = pino({
  level: 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } },
});

// ── Credit scoring helpers ────────────────────────────────────────────────────

let currentScore = null;

function tag() {
  return currentScore !== null ? `[${AGENT_NAME} | Score: ${currentScore}]` : `[${AGENT_NAME}]`;
}

async function ensureRegistered() {
  try {
    const res = await fetch(`${LODESTAR_API_URL}/api/agents/${AGENT_ADDRESS}`);
    if (res.status === 503) {
      logger.info(`${tag()} Agents contract not deployed — scoring disabled`);
      return false;
    }
    if (res.ok) {
      const data = await res.json();
      const agent = data.agent ?? data;
      currentScore = agent.score;
      const policy = data.policy;
      logger.info(
        `${tag()} Already registered — score: ${agent.score}` +
        (policy ? ` | daily limit: $${(Number(BigInt(policy.max_per_day_stroops)) / 10_000_000).toFixed(2)} USDC` : '')
      );
      return true;
    }
    if (res.status === 404) {
      logger.info(`${tag()} Not registered — registering now…`);
      const regRes = await fetch(`${LODESTAR_API_URL}/api/agents/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentAddress: AGENT_ADDRESS,
          name: AGENT_NAME,
          description: AGENT_DESC,
          maxPerTxUsdc: MAX_PER_TX,
          maxPerDayUsdc: MAX_PER_DAY,
          allowedCategories: ALLOWED_CATS,
        }),
      });
      if (regRes.ok) {
        currentScore = 100;
        logger.info(`${tag()} Registered — starting score: 100`);
        return true;
      }
      const err = await regRes.json().catch(() => ({}));
      logger.warn({ err }, `${tag()} Registration failed — scoring disabled`);
      return false;
    }
  } catch {
    logger.warn(`${tag()} Could not reach agents API — scoring disabled`);
  }
  return false;
}

async function checkSpend(amountUsdc, category) {
  try {
    const res = await fetch(
      `${LODESTAR_API_URL}/api/agents/${AGENT_ADDRESS}/can-spend` +
      `?amount=${encodeURIComponent(amountUsdc)}&category=${encodeURIComponent(category)}`
    );
    if (!res.ok) return { allowed: true, reason: 'OK' };
    return await res.json();
  } catch {
    return { allowed: true, reason: 'OK' };
  }
}

async function recordOutcome(amountUsdc, success) {
  try {
    const res = await fetch(`${LODESTAR_API_URL}/api/agents/${AGENT_ADDRESS}/payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountUsdc, success }),
    });
    if (res.ok) {
      const data = await res.json();
      const oldScore = currentScore;
      currentScore = data.newScore;
      logger.info(`${tag()} Score updated: ${oldScore} → ${currentScore}`);
    }
  } catch {
    // non-critical
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
  }).catch(() => {});
}

// ── Agent task ────────────────────────────────────────────────────────────────

async function runTask(category, buildUrl, scoringEnabled) {
  logger.info(`\n${tag()} ── Task: ${category} ──────────────────────────────────`);

  logger.info(`${tag()} Step 1: Querying Lodestar registry…`);
  const services = await fetchServices(category);

  if (!services.length) {
    logger.error(`${tag()} No services found for category "${category}"`);
    return;
  }

  logger.info(`${tag()} Step 2: Found ${services.length} service(s)`);
  const best = [...services].sort((a, b) => b.reputation - a.reputation)[0];
  logger.info(`${tag()} Step 3: Selected "${best.name}" — $${best.price_usdc} USDC`);

  // Spending policy check
  if (scoringEnabled) {
    const check = await checkSpend(best.price_usdc, category);
    if (!check.allowed) {
      logger.warn(`${tag()} Payment blocked by spending policy: ${check.reason}`);
      return;
    }
    logger.info(`${tag()} Spending policy check passed`);
  }

  const endpointUrl = buildUrl(best.endpoint);
  logger.info(`${tag()} Step 4: Sending x402 payment on Stellar…`);

  const httpClient = buildHttpClient();
  let response;
  try {
    response = await httpClient.fetch(endpointUrl);
  } catch (err) {
    logger.error({ err }, `${tag()} x402 payment failed`);
    if (scoringEnabled) await recordOutcome(best.price_usdc, false);
    return;
  }

  if (!response.ok) {
    logger.error({ status: response.status }, `${tag()} Service error after payment`);
    if (scoringEnabled) await recordOutcome(best.price_usdc, false);
    return;
  }

  const txHash = response.headers.get('x-payment-transaction') ?? '(no hash)';
  logger.info(`${tag()} Step 5: Payment confirmed — tx: ${txHash}`);

  const data = await response.json();
  logger.info({ data }, `${tag()} Paid $${best.price_usdc} USDC — data received`);

  if (scoringEnabled) await recordOutcome(best.price_usdc, true);

  await submitReputation(best.id, true);
  logger.info(`${tag()} Submitted positive reputation for "${best.name}"`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  logger.info(`${tag()} Lodestar Agent starting`);
  logger.info(`${tag()} Address: ${AGENT_ADDRESS}`);

  const scoringEnabled = await ensureRegistered();

  await runTask('weather', (ep) => `${ep}?lat=40.7128&lon=-74.0060`, scoringEnabled);
  await runTask('search', (ep) => `${ep}?q=Stellar+blockchain+AI+agents`, scoringEnabled);

  logger.info(`\n${tag()} Agent complete.`);
}

main().catch((err) => {
  logger.error({ err }, 'Agent crashed');
  process.exit(1);
});
