# @lodestar/client

Typed OpenAPI client for the [Lodestar](https://github.com/Stellar-Ecosystem/lodestar) backend API (#832).

Lodestar is the discovery and credit scoring protocol for x402 AI agents on Stellar. `@lodestar/client` provides a typed, promise-based API client for interacting with Lodestar registry and agent credit scoring endpoints.

## Installation

```bash
npm install @lodestar/client
```

## Quickstart

### JavaScript / ESM

```javascript
import { LodestarClient, createClient } from '@lodestar/client';

const client = createClient({
  baseUrl: process.env.LODESTAR_API_URL || 'http://localhost:3001',
  timeoutMs: 30_000,
});

// Discover active services in the 'weather' category
const { services } = await client.getServices({ category: 'weather' });

// Query an agent's credit score and spending policy
const { agent, policy } = await client.getAgent('GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVAAA');
console.log(`Agent ${agent.name} score: ${agent.score}`);
```

### TypeScript

```typescript
import { LodestarClient, ServiceEntry, AgentEntry } from '@lodestar/client';

const client = new LodestarClient({
  baseUrl: 'https://api.lodestar.example',
});

// Fully typed response objects
const services: ServiceEntry[] = (await client.getServices({ category: 'ai' })).services;
```

## API Methods

### System & Health

- `client.getHealth()`: Check process liveness, uptime, and transaction queues.
- `client.getReadiness()`: Check dependency connectivity (Soroban RPC, Redis).

### Service Registry & Reputation

- `client.getStats()`: Aggregate registry and agent metrics.
- `client.getServices({ category })`: List active registered services (optionally filtered by category).
- `client.getServiceById(id)`: Fetch details for a specific service.
- `client.getServicesByProvider(address)`: Fetch all services registered by a provider address.
- `client.prepareRegisterService(data)`: Generate unsigned Soroban transaction XDR for registering a new service.
- `client.submitSignedRegistryTx({ signedXdr, submitToken })`: Submit a wallet-signed registration transaction.
- `client.submitReputation(id, { positive, agent })`: Cast an on-chain reputation vote for a service.

### Agent Scoring & Policy

- `client.getAgents({ page, pageSize, sort })`: Paginated list of agents sorted by score, payments, or registration date.
- `client.getAgentStats()`: Aggregate scoring statistics and tier distribution (unrated, bronze, silver, gold, platinum).
- `client.getAgent(address)`: Get an agent's profile, credit score, and spending policy.
- `client.registerAgent({ name, description, address, endpoint })`: Register an AI agent on-chain.
- `client.getAgentEligibility(address, minScore)`: Verify if an agent meets the minimum score threshold for a tier.
- `client.checkAgentCanSpend(address, { amount, category })`: Validate transaction against daily and per-tx spending limits.
- `client.recordAgentPayment(address, { success, stroops, txHash })`: Record payment execution and update score.
- `client.buildAgentTx(address, data, callerAddress)`: Build unsigned transaction for owner policy updates.
- `client.submitSignedAgentTx(address, { signedXdr })`: Submit signed agent policy transaction.

### Activity

- `client.getActivity({ page, limit })`: Paginated event stream of on-chain and off-chain protocol activity.
- `client.getDemoActivity()`: Recent demo runs and service invocations.

## Error Handling

All failed HTTP responses throw `LodestarApiError`:

```javascript
import { LodestarApiError } from '@lodestar/client';

try {
  await client.getAgent('INVALID_ADDRESS');
} catch (err) {
  if (err instanceof LodestarApiError) {
    console.error(`API Error (${err.status}): ${err.message}`);
    console.error(`Error Code: ${err.code}`);
    console.error(`Request ID: ${err.requestId}`);
  }
}
```

## OpenAPI Specification

The complete OpenAPI 3.0 specification is bundled with the package:

```javascript
import spec from '@lodestar/client/openapi.json' assert { type: 'json' };
```
