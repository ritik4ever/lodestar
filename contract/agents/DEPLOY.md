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

## 5. Upgrading Existing Deployments (Indexed Registration)

Newer builds register agents against an **indexed layout** (`DataKey::AgentAt(i)`)
so `register_agent` is O(1) and listing reads only the requested pages. Older
deployments stored every agent in a monolithic `DataKey::AgentIds` vector that
was rewritten on every registration.

- **Fresh deployments:** Nothing to do. `register_agent` never writes the legacy
  vector, so there is never anything to migrate.
- **Existing deployments that already registered agents:** after installing the
  new WASM build, the admin **must** run the one-time backfill **before any new
  `register_agent` or listing call**:

```sh
stellar contract invoke \
  --id <AGENTS_CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- migrate_agent_index --caller <ADMIN_ADDRESS>
```

`migrate_agent_index`:
1. Reads the legacy `AgentIds` vector.
2. Backfills each address into `AgentAt(0)…AgentAt(n-1)`.
3. Sets `AgentCount` to the migrated count.
4. Deletes the legacy `AgentIds` key.

It is admin-only, idempotent by construction (a second call fails because the
legacy key is already gone), and returns the number of agents indexed. Skipping
it leaves the index empty and out of sync with `AgentCount`, which makes
`list_agents`/`list_agents_page` panic until migration is run.
