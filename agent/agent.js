import 'dotenv/config';
import pino from 'pino';
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

const AGENT_SECRET      = process.env.AGENT_STELLAR_SECRET;
const RPC_URL           = process.env.STELLAR_RPC_URL;
const LODESTAR_API_URL  = process.env.LODESTAR_API_URL;

const logger = pino({
  level: 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } },
});

// ── x402 client ───────────────────────────────────────────────────────────────

function buildHttpClient() {
  const signer = createEd25519Signer(AGENT_SECRET, 'stellar:testnet');
  const scheme = new ExactStellarScheme(signer, { url: RPC_URL });
  const client = new x402Client().register('stellar:*', scheme);
  return new x402HTTPClient(client);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

async function runTask(category, buildUrl) {
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

  const endpointUrl = buildUrl(best.endpoint);

  // 3. Build x402 client and make request
  logger.info('Step 4: Sending x402 payment on Stellar…');
  const httpClient = buildHttpClient();

  const response = await httpClient.fetch(endpointUrl);

  if (!response.ok) {
    logger.error({ status: response.status }, 'Service returned error after payment');
    return;
  }

  const txHash = response.headers.get('x-payment-transaction') ?? '(no hash)';
  logger.info(`Step 5: Payment confirmed — tx: ${txHash}`);

  const data = await response.json();
  logger.info({ data }, `Paid $${best.price_usdc} USDC — received data`);

  // 4. Submit positive reputation
  await submitReputation(best.id, true);
  logger.info(`Submitted positive reputation for "${best.name}"`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  logger.info('Lodestar Agent starting — zero hardcoded service URLs');

  await runTask('weather', (endpoint) => `${endpoint}?lat=40.7128&lon=-74.0060`);
  await runTask('search',  (endpoint) => `${endpoint}?q=Stellar+blockchain+AI+agents`);

  logger.info('\nAgent complete.');
}

main().catch((err) => {
  logger.error({ err }, 'Agent crashed');
  process.exit(1);
});
