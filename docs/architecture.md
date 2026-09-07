# Lodestar Architecture

This document covers the component responsibilities, data flow, trust boundaries, failure modes, and the reasoning behind the system split for Lodestar.

## Component Responsibilities

1. **LodestarRegistry (Soroban Contract)*
   - **Role:* Permanent, neutral on-chain registry for services.
   - **Responsibility:* Stores `ServiceEntry` structures containing provider address, endpoint URL, price, category, and reputation score. Category values are canonicalised on-chain using a fixed, lowercased enum exposed via `list_categories()`; unknown or mixed-case values are rejected. Handles reputation scoring and category filtering without gatekeeping.

2. **LodestarAgents (Soroban Contract)*
   - **Role:** Agent identity and trust layer.
   - **Responsibility:** Tracks AI agent identities and their on-chain credit scores (0-1000). Manages and enforces programmable spending policies per agent (e.g., maximum USDC per transaction, maximum per day). Records payments and determines service eligibility based on score.

3. **Backend (Express)**
   - **Role:* Off-chain facilitator and demo service provider.
   - **Responsibility:** Wraps the x402 facilitator to drive payment cycles. Handles transaction preparation (`/api/registry/prepare-register`) and submission. Implements real x402-protected demo endpoints (e.g., weather, search) that agents can consume.

4. **Frontend (Next.js)**
   - **Role:* User interface for providers and monitors.
   - **Responsibility:** Provides a UI for providers to register their services. `frontend/lib/categoryMeta.tsx` is generated from or verified against the on-chain category list returned by `list_categories()`, ensuring the UI and contract agree on valid values. Displays paginated leaderboards of agents and their scores. Allows users to monitor the state of the registry and their services.

5. **AI Agents (Standalone Script)*
   - **Role:** Autonomous consumers of services.
   - **Responsibility:* Query the registry to discover services without hardcoded URLs. Execute the x402 payment flow to access these services. Update their own credit scores on-chain by recording successful payments and adjusting service reputations.

## Why the System is Split This Way

- **Separation of Concerns:** The on-chain contracts (LodestarRegistry and LodestarAgents) handle only the absolute minimum required for trust, identity, and discovery. This keeps gas costs low and ensures neutrality.
- Off-chain Heavy Lifting: The Express backend handles complex x402 negotiation, API proxying, and caching (like the agent leaderboard cache). These operations are computationally expensive or require network access outside the blockchain.
- Client-Side Autonomy: The AI Agents are standalone scripts. This demonstrates true autonomy where the agent operates without hardcoded URLs, fetching all discovery and policy rules dynamically from the contracts.

## Category Canonicalization

- **On-chain canonicalisation:** The LodestarRegistry contract rejects categories that are not in the canonical enum. Valid categories are lowercase strings matching the set returned by `list_categories()`.
- **Discovery:** Clients call `list_categories()` to fetch the current valid set instead of relying on free-form strings.
- **Frontend sync:** `frontend/lib/categoryMeta.tsx` is generated from or verified against the on-chain set to prevent drift between the UI and the registry.
- **Migration path:** Existing mixed-case entries (e.g., `Weather`, `weather `) are normalized to lowercase canonical values in a one-time migration. Providers and agents should use `list_categories()` after this change to discover the valid set and avoid registering/querying with stale or non-canonical strings.

## Contract Storage

Both contracts key their state with `#[contracttype]` `DataKey` enums. Every key,
its value type, TTL class and growth characteristics are documented in
**[Storage Layout](./storage-layout.md)** — the reference for reasoning about
migration cost, TTL rent, and what a redeploy would have to preserve.

## Trust Boundaries

- **Providers vs. Registry:** Providers are untrusted. They can register any endpoint. The registry relies on the x402 payment success/failure feedback loop (reputation) from agents to bubble up good services and bury bad ones.
- **Agents vs. Services:** Agents do not trust services to be up or accurate initially, hence they use the registry's reputation system. Services do not trust agents, hence the `402 Payment Required` wall and the agent credit scoring system to gate premium endpoints.
- **Contracts vs. Off-chain:**The Soroban contracts are the ultimate source of truth. Spending policies and credit scores are enforced at the smart contract level, so a compromised backend or a malicious agent script cannot bypass spending limits or fabricate a 1000 credit score.

## Data Flow

1. **Service Registration:**
   `Provider (Frontend)` -> `Backend (prepare-register)` -> `Provider (signs XDR)` -> `Backend (submit-signed-tx)` -> `LodestarRegistry (stores ServiceEntry)`
2. **Discovery & Access:**
   `AI Agent` -> `LodestarRegistry (list_services)` -> Returns active endpoints sorted by reputation. Agents may call `LodestarRegistry (list_categories)` to discover valid category values before filtering.
3. **Payment & Consumption:**
   `AI Agent` -> `Service Endpoint (GET)` -> Returns `402 Payment Required`.
   `AI Agent` -> `Stellar Network` -> Pays via x402.
   `AI Agent` -> `Service Endpoint (GET + x402 receipt)` -> Returns requested data.
4. **Reputation Update:**
   `AI Agent` -> `LodestarAgents (record_payment)` -> Updates Agent Score.
   `AI Agent` -> `LodestarRegistry (update_reputation)` -> Updates Service Score.

## Failure Modes

1. **LodestarRegistry (Soroban Contract)**
   - **Failure:** Contract runs out of compute/storage budget if too many persistent storage entries are read at once.
   - **Mitigation:** Uses paginated endpoints (`list_services_page`).

2. **LodestarAgents (Soroban Contract)**
   - **Failure:** Agent fails to pay or service rejects payment.
   - **Mitigation:** The agent's credit score is penalized (-25 points), preventing malicious or faulty agents from maintaining a high tier or draining resources.

3. **Backend / API Services:**
   - **Failure:** The off-chain service endpoint goes down or returns 500s.
   - **Mitigation:** Agents receive a failed request, which lowers the service's reputation score on-chain. Future agents will pick a different service from the registry.

4. **AI Agents**
   - **Failure:** The agent exceeds its daily or per-transaction spending limit.
   - **Mitigation:** The LodestarAgents contract blocks further payments at the chain level until the 24-hour ledger period resets. The backend cannot bypass this.
