# Lodestar Agents — Contract Deployment

The agents contract manages agent registration, credit scoring, and spending policies.

## 1. Build the contract

```sh
cd contract/agents
stellar contract build
```

The compiled WASM file will be at:
`contract/agents/target/wasm32v1-none/release/lodestar_agents.wasm`

## 2. Deploy

Pass the admin address as the contract's **constructor argument**. This address
will have permission to flag agents or deactivate them administratively.

```sh
stellar contract deploy \
  --wasm target/wasm32v1-none/release/lodestar_agents.wasm \
  --source deployer \
  --network testnet \
  -- --admin <ADMIN_ADDRESS>
```

Copy the printed agent contract ID — referred to below as `<AGENTS_CONTRACT_ID>`.

**Record the deployment** in `contract/deployments.json` so the team has a
shared source of truth:

```sh
# Compute the WASM hash (also printed by `stellar contract install`)
sha256sum contract/agents/target/wasm32v1-none/release/lodestar_agents.wasm

# Update deployments.json with the new values:
#   - contractId: the printed contract ID
#   - wasmHash:  the sha256sum output
#   - deployer:  your deployer public key
#   - deploymentLedger: the ledger number printed during deploy
#   - deployedAt: ISO timestamp (date -u +"%Y-%m-%dT%H:%M:%SZ")
```

The file is checked into version control so every contributor points at the
same deployment and can independently verify the WASM hash on-chain.

## 3. Initialization

The agents contract needs to know the address of the service registry to verify
service providers during `record_payment`. This is a one-time setup:

```sh
stellar contract invoke \
  --id <AGENTS_CONTRACT_ID> \
  --source deployer \
  --network testnet \
  -- init --registry_contract <REGISTRY_CONTRACT_ID>
```

## 4. Post-Deployment Seed

To populate the network with demo agents and payment history, run the seed script:

```sh
cd backend
npm run seed-agents
```

This will register three demo agents with varying scores:
- **NewAgent**: ~110 score
- **EstablishedAgent**: ~600 score
- **TrustedAgent**: ~1000 score (max)

## Agent Events

The agents contract emits structured Soroban events for all state-mutating operations.
The first topic is the contract domain symbol `("agents")`, the second topic is the action
symbol, and the third topic is the affected address (e.g., `agent_address`, `new_admin`, or `registry_contract`).

| Action | Topics | Data |
| --- | --- | --- |
| Register agent | `("agents", "registered", agent_address)` | `(owner, name, description, initial_score)` |
| Record payment | `("agents", "payment", agent_address)` | `(service_id, amount_stroops, success, old_score, new_score, caller)` |
| Flag agent | `("agents", "flagged", agent_address)` | `(caller, reason, old_score, new_score)` |
| Deactivate agent | `("agents", "deactivated", agent_address)` | `(caller)` |
| Update policy | `("agents", "policy_updated", agent_address)` | `(caller, max_per_tx_stroops, max_per_day_stroops, allowed_categories, min_score_to_earn)` |
| Transfer admin | `("agents", "admin_transferred", new_admin)` | `(caller, new_admin)` |
| Initialize | `("agents", "initialized", registry_contract)` | `(registry_contract)` |

Indexers, activity feeds, and dashboards can reconstruct the complete score history of any agent
purely from chain events by filtering for topics matching `("agents", *, agent_address)`.
