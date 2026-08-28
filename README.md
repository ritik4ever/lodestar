# Lodestar
### Navigate the agent economy — discover, pay, and build trust.


Lodestar solves the missing discovery layer in the x402 agentic payments ecosystem on Stellar — today AI agents can pay for services but cannot find them autonomously because every service URL is hardcoded by a human, so Lodestar ships two Soroban smart contracts: the first is a permanent neutral on-chain registry where any service provider registers their x402 endpoint once with a price and category and it becomes discoverable forever, and the second tracks every AI agent's on-chain identity giving each agent a credit score from 0 to 1000 that rises with successful payments and falls with failures, enforces programmable per-transaction and daily spending limits at the contract level, and allows service providers to gate access to premium services by minimum score — all of this is exposed through an Express backend with real x402-protected demo endpoints for weather and search, a Next.js frontend where providers can register services and agents can view their scores, and a standalone autonomous agent script that starts with zero hardcoded URLs, queries the registry, discovers the best service by reputation, pays via USDC on Stellar testnet through the x402 protocol, receives real data back, and updates its own credit score on-chain — making Lodestar the complete infrastructure layer for the agentic economy covering discovery, payment, and trust in a single production-grade open source project that directly addresses all three requirements the Stellar Hacks judges explicitly called out in the hackathon brief.

If you are new to x402, start with the [x402 primer](docs/x402-primer.md) for a simple explanation of the 402 challenge, the payment headers, the facilitator role, and how Stellar settlement fits into the flow.

---

## Project Status and Roadmap

Lodestar is currently an early-stage, demo-ready project for the Stellar ecosystem. It is suitable for evaluation, experimentation, and contributor feedback, but it is not yet a production-grade platform for mission-critical payments or broad public deployment.

### Current maturity
- The core discovery, payment, and reputation flow is implemented and exercised in the demo app.
- The project includes live testnet deployments for the frontend, backend API, and Soroban contracts.
- The codebase is actively evolving and is best treated as a working prototype with room for hardening.

### Deployment status
- Frontend: https://lodestar-ruddy.vercel.app
- Backend API: https://lodestar-8na4.onrender.com/api/services
- Health check: https://lodestar-8na4.onrender.com/healthz
- Registry contract: [CAKZALA72JTR6BV6N44E7L52C7QU5BAYYKVKYR2DFSV2YD2A2OI6WJMP](https://stellar.expert/explorer/testnet/contract/CAKZALA72JTR6BV6N44E7L52C7QU5BAYYKVKYR2DFSV2YD2A2OI6WJMP)
- Agents contract: [CCT4FUTW54K7BYZFOCBEM5MVLS42ZE25WJ3ONW7RLYXAF3HQS7ZQYA2N](https://stellar.expert/explorer/testnet/contract/CCT4FUTW54K7BYZFOCBEM5MVLS42ZE25WJ3ONW7RLYXAF3HQS7ZQYA2N)

### Known limitations
- The current deployment targets Stellar testnet and is not yet a mainnet production rollout.
- The demo experience is useful for validation, but operational hardening, monitoring, and broader real-world testing are still pending.
- Some UX and onboarding flows are intentionally lightweight and may evolve as contributors shape the roadmap.

### Roadmap
The short-term direction is to harden the core experience, improve documentation, and expand the set of supported payment and discovery flows. Follow the GitHub milestones for ongoing priorities: https://github.com/Stellar-Ecosystem/lodestar/milestones

---

Lodestar ships two Soroban contracts: the **Service Registry** (discovery + reputation) and the **Agent Credit Scoring** system (identity + trust + spending policies).

---

## The Problem

AI agents can already pay for services via the x402 protocol on Stellar. But they cannot find services on their own — every URL is hardcoded by a human. This breaks the promise of autonomous agents: if a developer has to manually wire every service endpoint into every agent, you haven't built autonomy, you've built a very expensive API client. For a beginner-friendly explanation of the flow, see the [x402 primer](docs/x402-primer.md).

## The Solution

Lodestar is a Soroban smart contract that acts as a neutral, on-chain registry. Service providers call `register_service` once. AI agents call `list_services`, pick the best result by reputation, hit the endpoint, and pay via x402 — all without a single hardcoded URL. The registry is permanent and permissionless: no owner, no gatekeeping, no downtime.

---

## Architecture

> **Note:** For a detailed breakdown of component responsibilities, trust boundaries, failure modes, data flow, and why the system is split this way, see [docs/architecture.md](docs/architecture.md).

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
2. Ask the backend for `POST /api/registry/prepare-register`, which builds an unsigned Soroban transaction using your real Stellar address as `provider`. `name` must be 3–64 characters and `description` must be 10–256 characters.
3. Sign that XDR in Freighter (or another wallet) and submit it through `POST /api/registry/submit-signed-tx`
4. If an active service with the same provider and endpoint already exists, registration is rejected to prevent duplicate active entries
5. Your service is now permanently discoverable by any agent querying the registry

### Agent flow
1. Call `list_services(category)` — returns active services sorted by reputation
2. Pick the top result (highest reputation, lowest price, or newest)
3. Make an HTTP request to the endpoint — receive a `402 Payment Required` response. For the search endpoint, the `q` query parameter is trimmed and normalized before forwarding. Queries longer than 256 characters are rejected with HTTP 400 `INVALID_QUERY`.
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
SEEDING_MODE=true node scripts/seed.js
```

This registers the four demo services (weather, search, and two live Stellar services) into the on-chain registry.

> **Seeded data caveat**: The demo seeding scripts (`scripts/demo/boost-scores.js`, `scripts/seed-agents.js`) programmatically inflate agent scores by submitting synthetic on-chain payments. This is intentional — without it the leaderboard would show every agent at score 100 and the demo would be uninteresting. These scripts are **demo-only** and must never be run against mainnet. The `boost-scores` script enforces this with a network passphrase guard.

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

### Score Recovery

Each spending policy carries a `min_score_to_earn` threshold. It controls **how
fast** an agent earns, never **whether** it can earn:

| Agent score | Increment per successful payment |
|-------------|----------------------------------|
| ≥ `min_score_to_earn` | **+10** (full rate) |
| < `min_score_to_earn` | **+2** (reduced rate) |

Failures always cost −25, so a run of failures can push an agent below the
threshold — but the reduced rate is deliberately non-zero, so successful payments
always move the score back up. An agent that drops to 25 with a threshold of 60
climbs back over it in 18 successful payments, and earns at the full rate again
from there. Setting `min_score_to_earn` to 0 (the default for new agents) gives
every agent the full rate.

The exact values are readable on-chain via `get_scoring_config`, which returns
`score_success` (+10) and `score_success_below_threshold` (+2).

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

To give the demo agents varied credit scores (so the leaderboard is not flat), run the optional demo boost script:

```sh
node scripts/demo/boost-scores.js --dry-run   # preview payments
node scripts/demo/boost-scores.js             # submit them
```

> This script is **demo-only** and refuses to run against the Stellar mainnet passphrase.

---

## Agent Leaderboard

The `/agents` page (`frontend/app/agents/page.tsx`) is a paginated leaderboard of all registered agents, sorted by score, activity, or registration date.

### The Problem

The original implementation called `fetchAgents(100)` on every page load, which triggered a single Soroban contract call that read up to 100 persistent storage entries at once. All 100 agent records were then sent over the wire to the browser, stored in component state, and rendered in a single pass. At small scale this worked, but it had two concrete failure modes:

- **Soroban compute limits**: A single `list_agents(100)` simulation reads 100 persistent storage entries in one call, which approaches Soroban's per-transaction compute budget as agent count grows (the same issue that affected `list_services` and was fixed in PR #109 with `list_services_page`).
- **Unnecessary data transfer**: The browser downloaded the full agent list on every 30-second refresh cycle, regardless of how many agents the user was actually viewing.

### How It Was Fixed

The fix spans three layers:

**1. Soroban contract** (`contract/agents/src/lib.rs`): Added `list_agents_page(page, page_size)` — reads only `page_size` entries from a specific offset in the `AgentIds` vec, keeping each simulation well within compute limits regardless of total agent count.

**2. Backend** (`backend/src/routes/agents.js`): The `GET /api/agents` route now accepts `?page=N&pageSize=M&sort=score|payments|newest`. An in-memory cache holds the full sorted agent list for 30 seconds (matching the frontend refresh interval), so Soroban is queried at most once per 30s no matter how many page changes the user makes. The route sorts from the cache and returns only the requested slice. The `/api/agents/stats` endpoint shares the same cache. When a new agent registers, the cache is invalidated immediately.

**3. Frontend** (`frontend/app/agents/page.tsx`, `frontend/app/registry/page.tsx`): `fetchAgents(page, pageSize, sort)` replaces the old `fetchAgents(100)`. Changing page, page size, or sort triggers a new API call — the browser never holds more than one page of agent data in memory. Both pages use [SWR](https://swr.vercel.app/) keyed by their local UI state (`page`, `pageSize`, `sort` on the agents page; `activeCategory` on the registry page) instead of a manual `setInterval`: SWR dedupes concurrent/identical requests, revalidates every 30s (`refreshInterval`), and only re-renders when the returned data actually changes — eliminating the redundant requests and re-renders the old fixed poll caused. `keepPreviousData` keeps the current page visible (dimmed via the `refreshing` state) during a refresh instead of re-showing the skeleton, keeping navigation feel fast.

### UI Features

- **Page size selector**: choose 6, 12, or 24 agents per page directly from the header
- **Prev / Next controls** with "Showing X–Y of Z" counter
- **Sort by** Highest Score, Most Active, or Newest — resets to page 1 automatically on change
- **Skeleton loading** on first load; opacity transition on page/sort changes
- **Live refresh** every 30 seconds without losing current page or sort

### Running the Tests

```sh
cd frontend
npm test
```

The test suite (`__tests__/AgentsPage.test.tsx`) mocks `fetchAgents` to behave like the real server-side implementation — returning only the requested page from a virtual list of N agents — and verifies first-page limits, Prev/Next state, sort-reset behavior, and "Showing X–Y of Z" accuracy across pages.

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
- **Deployments**: [contract/deployments.json](contract/deployments.json) — canonical source of truth for all live contract addresses and WASM hashes
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
| [2e6059ffd930106a6db29d0816f504d8afba36f513836f97df68fca71c3e191b](https://stellar.expert/explorer/testnet/tx/2e6059ffd930106a6db29d0816f504d8afba36f513836f97df68fca71c3e191b) | x402 weather payment via Live Agent Demo |
| [775e5fb93cdd2ece1cef955d34f28c64fe93eaea0bbaaa8607c5ecd937be88e0](https://stellar.expert/explorer/testnet/tx/775e5fb93cdd2ece1cef955d34f28c64fe93eaea0bbaaa8607c5ecd937be88e0) | x402 search payment via Live Agent Demo |
| [cd95b935fa85ca938b0a3660a7255f17901a25f9c176a60fa94692fb64492beb](https://stellar.expert/explorer/testnet/tx/cd95b935fa85ca938b0a3660a7255f17901a25f9c176a60fa94692fb64492beb) | x402 weather payment — WeatherBot-Alpha agent |

Full payment history: [GAY42L…KGU3 on Stellar Explorer](https://stellar.expert/explorer/testnet/account/GAY42LBQWN7LSFV3F6AFNEET2NVLY2JJ7KAEN4E5SNNT4RIEJLAQKGU3) — 176+ transactions

---

## Demo Video

- [Short walkthrough of the agent run](docs/assets/demo-recording.svg) — a lightweight recording-style preview of the registry, agent scoring, and payment flow.
- Live deployment: https://lodestar-ruddy.vercel.app

---

## License

This repository is licensed under the Apache License, Version 2.0. See the [LICENSE](LICENSE) file for the full license text.

### Choice of License and Reasoning

We have chosen the **Apache License, Version 2.0** to align with standard licensing practices in the Stellar ecosystem. The Apache-2.0 license provides an explicit patent grant from contributors to users, providing robust legal protection for everyone building, forking, or contributing to Lodestar. This clarifies downstream use and removes legal ambiguity for open-source contributions.
