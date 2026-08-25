# Lodestar — Contract Deployment

This guide covers the deployment of the Lodestar Service Registry. For detailed
instructions on the Agents credit scoring contract, see
[contract/agents/DEPLOY.md](./agents/DEPLOY.md).

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

## Registry Error Codes

The registry contract returns typed `RegistryError` values for application-level
failures. These discriminants are stable API surface and must not be reordered:

| Numeric code | Variant | Backend code | Meaning |
| --- | --- | --- | --- |
| 1 | `InvalidName` | `INVALID_NAME` | Service name is outside the 3-64 character range. |
| 2 | `InvalidDescription` | `INVALID_DESCRIPTION` | Service description is outside the 10-256 character range. |
| 3 | `DuplicateActiveService` | `DUPLICATE_SERVICE` | The provider already has an active service with the same endpoint. |
| 4 | `ServiceNotFound` | `SERVICE_NOT_FOUND` | The requested service id does not exist. |
| 5 | `AgentsContractNotConfigured` | `AGENTS_CONTRACT_NOT_CONFIGURED` | Registry storage is missing the configured agents contract address. |
| 6 | `CallerNotRegisteredAgent` | `CALLER_NOT_REGISTERED_AGENT` | The reputation voter is not registered in the agents contract. |
| 7 | `ReputationVoteCooldown` | `REPUTATION_VOTE_COOLDOWN` | The same agent voted on the same service too recently. |
| 8 | `ProviderMismatch` | `PROVIDER_MISMATCH` | A non-provider attempted to deactivate the service. |
| 9 | `CategoryIndexNotFound` | `CATEGORY_INDEX_NOT_FOUND` | Registry storage is missing the service category index. |

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

## Network Details

- Network: Stellar Testnet
- RPC URL: https://soroban-testnet.stellar.org
- Network Passphrase: `Test SDF Network ; September 2015`
- Explorer: https://stellar.expert/explorer/testnet
