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

Pass the admin address as the contract's **constructor argument**. The registry
address can also be passed in the constructor if known at deploy time, or set
later by the admin.

```sh
stellar contract deploy \
  --wasm target/wasm32v1-none/release/lodestar_agents.wasm \
  --source deployer \
  --network testnet \
  -- --admin <ADMIN_ADDRESS> --registry_contract <ADMIN_ADDRESS>
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

## 3. Wire the registry address (if not set in constructor)

If the registry wasn't known at deploy time, the admin must call this after
the registry is deployed:

```sh
stellar contract invoke \
  --id <AGENTS_CONTRACT_ID> \
  --source deployer \
  --network testnet \
  -- set_registry_contract --registry_contract <REGISTRY_CONTRACT_ID> --caller <ADMIN_ADDRESS>
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
