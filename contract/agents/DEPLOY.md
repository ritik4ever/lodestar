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

## 5. Default Spending Limits (Issue #323)

Every freshly registered agent starts with **conservative** spending caps,
defined as named constants in `contract/agents/src/lib.rs`:

| Constant | Value | Meaning |
|---|---|---|
| `DEFAULT_MAX_PER_TX_STROOPS` | `500_000_000` | 500 USDC per transaction |
| `DEFAULT_MAX_PER_DAY_STROOPS` | `5_000_000_000` | 5,000 USDC per day |

These defaults are intentionally restrictive — a freshly registered agent
cannot spend effectively unlimited amounts. The contract never widens a
policy on its own.

**Raising the limits is an explicit, owner-authorized call.** Only the
agent's registered owner may invoke `update_policy` (it enforces
`caller.require_auth()` and checks `agent.owner == caller`):

```sh
stellar contract invoke \
  --id <AGENTS_CONTRACT_ID> \
  --source <OWNER> \
  --network testnet \
  -- update_policy \
    --agent_address <AGENT_ADDRESS> \
    --max_per_tx_stroops <NEW_PER_TX> \
    --max_per_day_stroops <NEW_PER_DAY> \
    --allowed_categories '[]' \
    --min_score_to_earn 0 \
    --caller <OWNER_ADDRESS>
```
