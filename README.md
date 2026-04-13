# Lodestar
### Navigate the agent economy — discover, pay, and build trust.

Lodestar solves the missing discovery layer in the x402 agentic payments ecosystem on Stellar — today AI agents can pay for services but cannot find them autonomously because every service URL is hardcoded by a human, so Lodestar ships two Soroban smart contracts: the first is a permanent neutral on-chain registry where any service provider registers their x402 endpoint once with a price and category and it becomes discoverable forever, and the second tracks every AI agent's on-chain identity giving each agent a credit score from 0 to 1000 that rises with successful payments and falls with failures, enforces programmable per-transaction and daily spending limits at the contract level, and allows service providers to gate access to premium services by minimum score — all of this is exposed through an Express backend with real x402-protected demo endpoints for weather and search, a Next.js frontend where providers can register services and agents can view their scores, and a standalone autonomous agent script that starts with zero hardcoded URLs, queries the registry, discovers the best service by reputation, pays via USDC on Stellar testnet through the x402 protocol, receives real data back, and updates its own credit score on-chain — making Lodestar the complete infrastructure layer for the agentic economy covering discovery, payment, and trust in a single production-grade open source project that directly addresses all three requirements the Stellar Hacks judges explicitly called out in the hackathon brief.

---

Lodestar ships two Soroban contracts: the **Service Registry** (discovery + reputation) and the **Agent Credit Scoring** system (identity + trust + spending policies).

---

## The Problem

AI agents can already pay for services via the x402 protocol on Stellar. But they cannot find services on their own — every URL is hardcoded by a human. This breaks the promise of autonomous agents: if a developer has to manually wire every service endpoint into every agent, you haven't built autonomy, you've built a very expensive API client.

## The Solution

Lodestar is a Soroban smart contract that acts as a neutral, on-chain registry. Service providers call `register_service` once. AI agents call `list_services`, pick the best result by reputation, hit the endpoint, and pay via x402 — all without a single hardcoded URL. The registry is permanent and permissionless: no owner, no gatekeeping, no downtime.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          PROVIDERS                              │
│  register_service(name, endpoint, price, category)              │
│          │                                                      │
│          ▼                                                      │
│  ┌───────────────────────┐   ┌───────────────────────────────┐ │
│  │  LodestarRegistry     │   │  LodestarAgents               │ │
│  │  (Soroban contract)   │   │  (Soroban contract)           │ │
│  │                       │   │                               │ │
│  │  ServiceEntry[]       │   │  AgentEntry[]   score 0-1000  │ │
│  │  reputation scoring   │   │  SpendingPolicy per agent     │ │
│  │  category filtering   │   │  record_payment / is_eligible │ │
│  └───────────┬───────────┘   └──────────────┬────────────────┘ │
│              │                              │                   │
│              └──────────────┬───────────────┘                   │
│                             ▼                                   │
│                         AI AGENTS                               │
│                                                                 │
│  1. list_services(category)      → discover endpoints           │
│  2. is_eligible(address, score)  → check access                 │
│  3. check_spending_allowed()     → enforce policy               │
│  4. GET endpoint → 402 Payment Required                         │
│  5. pay via x402 on Stellar → receive data                      │
│  6. record_payment(success=true) → score += 10                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## How It Works

### Provider flow
1. Deploy any HTTP service that returns `402 Payment Required` with x402 headers
2. Call `register_service` on the Lodestar Soroban contract with your endpoint, price, and category
3. Your service is now permanently discoverable by any agent querying the registry

### Agent flow
1. Call `list_services(category)` — returns active services sorted by reputation
2. Pick the top result (highest reputation, lowest price, or newest)
3. Make an HTTP request to the endpoint — receive a `402 Payment Required` response
4. Build and sign an x402 payment transaction on Stellar using the agent's keypair
5. Retry the request with the payment header — receive the data
6. Optionally call `update_reputation` to improve the service's score for future agents

---

## Tech Stack

- **Smart Contract**: Rust + soroban-sdk on Stellar Testnet
- **Backend**: Node.js v22 + Express (ES modules)
- **Frontend**: Next.js 14 App Router + TypeScript + Tailwind CSS
- **Payments**: x402 protocol (`@x402/express`, `@x402/fetch`, `@x402/stellar`)
- **Stellar SDK**: `@stellar/stellar-sdk`
- **Wallet**: Freighter (`@stellar/freighter-api`)

---

## Prerequisites

- Node.js v22+
- Rust (stable) + `wasm32-unknown-unknown` target
- Stellar CLI
- Freighter browser extension (for frontend wallet interactions)

---

## Setup

### 1. Clone

```sh
git clone git@github.com:ritik4ever/lodestar.git
cd lodestar
```

### 2. Deploy the Soroban contract

Follow [contract/DEPLOY.md](contract/DEPLOY.md) for full instructions.

```sh
# Install Stellar CLI
curl -fsSL https://github.com/stellar/stellar-cli/raw/main/install.sh | sh

# Add wasm target
rustup target add wasm32-unknown-unknown

# Fund a deployer key
stellar keys generate deployer --network testnet --fund

# Build and deploy
cd contract
stellar contract build
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/lodestar_registry.wasm \
  --source deployer \
  --network testnet
```

Copy the printed contract ID — you will need it in the next steps.

### 3. Configure backend

```sh
cd backend
cp .env.example .env
# Fill in CONTRACT_ID, SERVER_STELLAR_ADDRESS, SERVER_STELLAR_SECRET, BRAVE_API_KEY
npm install
```

### 4. Run seed script

```sh
node scripts/seed.js
```

This registers the four demo services (weather, search, and two live Stellar services) into the on-chain registry.

### 5. Start backend

```sh
npm start
# Running on http://localhost:3001
```

### 6. Configure and start frontend

```sh
cd ../frontend
cp .env.local.example .env.local
# Fill in NEXT_PUBLIC_CONTRACT_ID
npm install
npm run dev
# Running on http://localhost:3000
```

### 7. Run the agent

```sh
cd ../agent
cp .env.example .env
# Fill in AGENT_STELLAR_SECRET
npm install
node agent.js
```

The agent will:
- Query the Lodestar registry for weather and search services
- Select the best by reputation
- Pay via x402 on Stellar
- Log the data received and update on-chain reputation

---

---

## Agent Credit Scoring

Lodestar ships a second Soroban contract that gives every AI agent a verifiable on-chain credit score.

### The Problem

Every agent is anonymous. Services cannot distinguish a reliable agent from a brand new untrusted one.

### The Solution

- Agents register on-chain and start with score **100**
- Every successful x402 payment increases score by **+10**
- Every failed payment decreases score by **−25**
- Services can set minimum score requirements
- Spending policies are enforced at contract level — cannot be bypassed

### Score Tiers

| Score | Tier | Access |
|-------|------|--------|
| 0–299 | New | Basic services only |
| 300–599 | Building | Standard services |
| 600–899 | Established | Premium services |
| 900–999 | Trusted | All services |
| 1000 | Elite | Elite tier |

### Spending Policies

Each agent has a programmable spending policy:
- Maximum USDC per transaction
- Maximum USDC per day (resets every ~17,280 ledgers ≈ 24 hours)
- Allowed service categories

Enforced at smart contract level — cannot be bypassed even if the agent wallet has sufficient balance.

### Deploy the Agent Contract

```sh
cd contract/agents
stellar contract build
stellar contract deploy \
  --wasm target/wasm32v1-none/release/lodestar_agents.wasm \
  --source deployer \
  --network testnet
```

Copy the printed contract ID, add to `.env` as `AGENTS_CONTRACT_ID`, then:

```sh
cd backend && npm run seed-agents
```

---

## Hackathon: Stellar Hacks Agentic AI 2026

Lodestar addresses all three brief requirements:

**Bazaar discoverability** — Lodestar is the discoverability layer. Any agent can call `list_services` and find x402 endpoints without human intervention. The registry is on-chain, so it is as neutral and permanent as Stellar itself.

**Bazaar-enabled facilitator** — The backend wraps the x402 facilitator and exposes a `/api/demo-run` endpoint that drives a full payment cycle: 402 → sign → retry → data. The demo page visualizes this step by step in real time.

**Mainnet-ready infrastructure** — The Soroban contract uses persistent storage with maximum TTL to prevent archival. The backend is production-grade (pino logging, env validation, proper error codes). The frontend is Next.js 14 with TypeScript strict mode. Switching to mainnet requires changing one env var: `STELLAR_NETWORK=mainnet`.

---

## Live Demo

- **Frontend**: https://lodestar-ruddy.vercel.app
- **Backend API**: https://lodestar-8na4.onrender.com/api/services
- **Health Check**: https://lodestar-8na4.onrender.com/healthz
- **Registry Contract**: [`CAKZALA72JTR6BV6N44E7L52C7QU5BAYYKVKYR2DFSV2YD2A2OI6WJMP`](https://stellar.expert/explorer/testnet/contract/CAKZALA72JTR6BV6N44E7L52C7QU5BAYYKVKYR2DFSV2YD2A2OI6WJMP)
- **Agents Contract**: [`CCT4FUTW54K7BYZFOCBEM5MVLS42ZE25WJ3ONW7RLYXAF3HQS7ZQYA2N`](https://stellar.expert/explorer/testnet/contract/CCT4FUTW54K7BYZFOCBEM5MVLS42ZE25WJ3ONW7RLYXAF3HQS7ZQYA2N)

---

## Testnet Transactions

Real x402 payment transactions on Stellar testnet:

| Transaction | Description |
|-------------|-------------|
| [2f76a396e640686b9fc426231415fd7786131f7bcc8482250ff6f65c4c28d042](https://stellar.expert/explorer/testnet/tx/2f76a396e640686b9fc426231415fd7786131f7bcc8482250ff6f65c4c28d042) | Agent credit score payment — NewAgent-Alpha |
| [6f13b95c5470a58f96b3fc43be3a8f0834bab8249e3fc91bc0c4b6627f5b5a59](https://stellar.expert/explorer/testnet/tx/6f13b95c5470a58f96b3fc43be3a8f0834bab8249e3fc91bc0c4b6627f5b5a59) | Agent credit score payment — EstablishedAgent-Beta |
| [bcf0b4328d8ce3bac0fcd72c88f61c3a29acfcd256e4bf07d6b82393e8f22d2e](https://stellar.expert/explorer/testnet/tx/bcf0b4328d8ce3bac0fcd72c88f61c3a29acfcd256e4bf07d6b82393e8f22d2e) | Agent credit score payment — TrustedAgent-Gamma |

> Add x402 weather/search payment tx hashes here after running the demo.

---

## Demo Video

> Paste link here after recording.

---

## License

MIT
