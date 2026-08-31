# Lodestar — Contract Deployment

This guide covers the deployment of the Lodestar Service Registry. For detailed
instructions on the Agents credit scoring contract, see
[contract/agents/DEPLOY.md](./agents/DEPLOY.md).

## Immutability

**Both Lodestar contracts are immutable by design** — see
[`docs/adr/0001-contract-immutability.md`](../docs/adr/0001-contract-immutability.md)
(ADR-0001) for the decision, trade-offs, and the full v2 migration story.

- Neither contract exports `update_current_contract_wasm`. No entity — including
  the deployer — can replace a deployed WASM on-chain.
- The registry's agents-contract anchor is fixed by its constructor
  (`--agents_contract`) and can never be re-pointed.
- The agents contract's `admin` key is **operational, not architectural**: it
  can flag/deactivate agents and transfer itself, but it cannot change contract
  code or scoring rules.
- Any bug fix or feature revision ships as a **new deployment (v2)** — see the
  [Revision / v2 migration](#revision--v2-migration) section below.

## Prerequisites

- Rust toolchain (stable)
- Stellar CLI

## 1. Install Stellar CLI

```sh
curl -fsSL https://raw.githubusercontent.com/stellar/stellar-cli/main/install.sh | sh
```

Or via cargo (slower but also works):
```sh
cargo install --locked stellar-cli
```

## 2. Install Rust WASM target

```sh
rustup target add wasm32-unknown-unknown
```

## 3. Generate and fund deployer key

```sh
stellar keys generate deployer --network testnet
stellar keys fund deployer --network testnet
```

## 4. Build the contracts

```sh
# Service registry
cd contract
stellar contract build

# Agent credit scoring
cd agents
stellar contract build
```

The compiled WASM files will be at:
- `contract/target/wasm32-unknown-unknown/release/lodestar_registry.wasm`
- `contract/agents/target/wasm32v1-none/release/lodestar_agents.wasm`

## 5. Deploy the agents contract first

The registry is wired to the agents contract **at deploy time** (next step), so
the agents contract must exist first. See [contract/agents/DEPLOY.md](./agents/DEPLOY.md)
for full details on the agents contract.

```sh
stellar contract deploy \
  --wasm contract/agents/target/wasm32v1-none/release/lodestar_agents.wasm \
  --source deployer \
  --network testnet \
  -- --admin <ADMIN_ADDRESS>
```

Copy the printed agent contract ID — referred to below as `<AGENTS_CONTRACT_ID>`.

## 6. Deploy the registry contract

Pass the agents contract ID as the registry's **constructor argument**. This is
the only place reputation-voting authorization is configured: the agents address
is fixed at deployment and can never be changed or hijacked by a later caller, so
there is no separate (front-runnable) `init` step.

```sh
stellar contract deploy \
  --wasm contract/target/wasm32-unknown-unknown/release/lodestar_registry.wasm \
  --source deployer \
  --network testnet \
  -- --agents_contract <AGENTS_CONTRACT_ID>
```

Copy the printed registry contract ID — referred to below as `<CONTRACT_ID>`.

**Record the deployment** in `contract/deployments.json` so the team has a
shared source of truth:

```sh
# Compute the WASM hash (also printed by `stellar contract install`)
sha256sum contract/target/wasm32-unknown-unknown/release/lodestar_registry.wasm

# Update deployments.json with the new values:
#   - contractId: the printed contract ID
#   - wasmHash:  the sha256sum output
#   - deployer:  your deployer public key
#   - deploymentLedger: the ledger number printed during deploy
#   - deployedAt: ISO timestamp (date -u +"%Y-%m-%dT%H:%M:%SZ")
```

The file is checked into version control so every contributor points at the
same deployment and can independently verify the WASM hash on-chain.

## 7. Point the agents contract at the registry

The agents contract verifies service providers against the registry, so link it
back (one-time):

```sh
stellar contract invoke \
  --id <AGENTS_CONTRACT_ID> \
  --source deployer \
  --network testnet \
  -- init --registry_contract <CONTRACT_ID>
```

## 8. Configure environment

Copy both contract IDs into your `.env` files:

```sh
# backend/.env
CONTRACT_ID=<registry contract id>
AGENTS_CONTRACT_ID=<agent contract id>

# frontend/.env.local
NEXT_PUBLIC_CONTRACT_ID=<registry contract id>
NEXT_PUBLIC_AGENT_CONTRACT_ID=<agent contract id>
```

The hosted backend casts reputation votes as a registered demo agent — by
default its own server key (`SERVER_STELLAR_ADDRESS`), which `npm run seed-agents`
registers as an agent. Set `NEXT_PUBLIC_DEMO_AGENT_ADDRESS` (frontend) to that
address. To let other pre-funded demo agents vote, add their secrets to
`DEMO_VOTER_SECRETS` (backend).

## 9. Run seed script

```sh
cd backend
npm install
SEEDING_MODE=true node scripts/seed.js
```

This pre-populates the registry with demo services.

## 10. (Optional) Set demo agent secrets

Generate three funded testnet keypairs for richer seed data:

```sh
stellar keys generate new-agent --network testnet
stellar keys fund new-agent --network testnet
stellar keys generate established-agent --network testnet
stellar keys fund established-agent --network testnet
stellar keys generate trusted-agent --network testnet
stellar keys fund trusted-agent --network testnet
```

Add their secrets to `backend/.env`:

```sh
DEMO_AGENT_1_SECRET=<new-agent secret>
DEMO_AGENT_2_SECRET=<established-agent secret>
DEMO_AGENT_3_SECRET=<trusted-agent secret>
```

If omitted, the seed script generates ephemeral random keypairs.

## 11. Run agent seed script

```sh
cd backend && npm run seed-agents
```

This registers three demo agents (NewAgent ~110, EstablishedAgent ~600, TrustedAgent ~1000) and builds their payment histories on-chain.

## Registration Field Limits

The `register_service` function enforces the following field limits on-chain:

| Field | Min | Max | Notes |
|-------|-----|-----|-------|
| `name` | 3 | 64 | |
| `description` | 10 | 256 | |
| `endpoint` | — | 256 | |
| `category` | 1 | 32 | |

Submissions exceeding these limits are rejected with a typed assertion error.
The same limits are enforced client-side in the RegisterForm and server-side
by the `POST /api/registry/prepare-register` route.

## Revision / v2 migration

Because v1 is immutable, a bug fix or feature revision ships as a **v2
deployment**, never an in-place upgrade. The full rationale is in
[ADR-0001](../docs/adr/0001-contract-immutability.md).

1. **Build & pin.** Build the new WASM from the revised source, record the
   SHA-256 hashes of `lodestar_registry.wasm` and `lodestar_agents.wasm` in
   `contract/deployments.json`, and retain the exact source commit so the
   deployment is reproducible.
2. **Deploy v2 agents first**, then **deploy v2 registry** with
   `--agents_contract <V2_AGENTS_CONTRACT_ID>` (steps 5 and 6 above use the new
   hashes), then run the one-time `init` linking agents → registry (step 7).
3. **Migrate records.** Walk the v1 registry with `list_services_page` (paged
   reads) and re-register each provider's service against v2. New service IDs
   are assigned by v2; endpoints/prices/categories are carried over as-is.
   On-chain reputation and vote-cooldown state are **not** auto-migrated — they
   start fresh on v2.
4. **Cut over.** Update `contract/deployments.json`, the backend/frontend `.env`
   contract IDs, and any hosted configuration. v1 remains live and immutable;
   consumers still reading it keep working until they re-point at v2.

## Network Details

- Network: Stellar Testnet
- RPC URL: https://soroban-testnet.stellar.org
- Network Passphrase: `Test SDF Network ; September 2015`
- Explorer: https://stellar.expert/explorer/testnet
