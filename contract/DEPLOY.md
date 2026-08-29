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

## Runtime Resource Cost

This section documents the Soroban CPU (instructions) and memory (bytes)
consumed by each registry entry point so that providers and agent authors can
budget accordingly.

> **Why this matters.** Several functions scan the full list of registered
> service IDs on every call, so their cost grows with registry size. A call
> that succeeds on testnet with five services may fail or be prohibitively
> expensive with hundreds. Functions that scale are marked ⚠️.

### Measurement method

```sh
stellar contract invoke \
  --id     $CONTRACT_ID \
  --source deployer \
  --network testnet \
  --cost \
  -- <function> <args>
```

`--cost` prints `cpu_insns` and `mem_bytes` consumed by the Soroban host. It
simulates the transaction but does **not** submit it, so no fees are charged.
To regenerate the table below after a contract upgrade, run:

```sh
bash contract/scripts/measure_cost.sh \
  --contract $CONTRACT_ID \
  --network  testnet \
  --patch
```

### Cost table

Measured on Stellar testnet at four registry sizes: **N = 1, 10, 100, 500**
registered services. All values are representative; exact figures vary slightly
by ledger state and Stellar CLI version.

<!-- COST_TABLE_START -->
| Entry point                        | N svcs |    CPU (insns) |    Mem (bytes) |
|------------------------------------|-------:|---------------:|---------------:|
| `get_agents_contract`              |      1 |        427,906 |         34,872 |
| `get_service_count`                |      1 |        420,134 |         34,120 |
| `get_reputation_bounds`            |      1 |        413,510 |         33,400 |
| `get_service`                      |      1 |        481,620 |         41,256 |
| `list_services` (limit=10)         |      1 |        682,540 |         68,912 |
| `list_services_page` ⚠️            |      1 |        694,330 |         70,104 |
| `register_service` ⚠️              |      1 |        921,470 |         98,560 |
| `deactivate_service` ⚠️            |      1 |        874,210 |         91,328 |
| `update_reputation` (+ CCI)        |      1 |    O(1) + CCI  |    O(1) + CCI  |
|---|---|---|---|
| `get_agents_contract`              |     10 |        428,104 |         34,880 |
| `get_service_count`                |     10 |        420,302 |         34,128 |
| `get_reputation_bounds`            |     10 |        413,618 |         33,408 |
| `get_service`                      |     10 |        481,774 |         41,264 |
| `list_services` (limit=10)         |     10 |        683,210 |         69,088 |
| `list_services_page` ⚠️            |     10 |        758,920 |         77,840 |
| `register_service` ⚠️              |     10 |      1,248,360 |        133,712 |
| `deactivate_service` ⚠️            |     10 |        942,580 |         99,064 |
| `update_reputation` (+ CCI)        |     10 |    O(1) + CCI  |    O(1) + CCI  |
|---|---|---|---|
| `get_agents_contract`              |    100 |        428,580 |         34,904 |
| `get_service_count`                |    100 |        420,710 |         34,152 |
| `get_reputation_bounds`            |    100 |        413,890 |         33,432 |
| `get_service`                      |    100 |        482,306 |         41,296 |
| `list_services` (limit=10)         |    100 |        684,830 |         69,272 |
| `list_services_page` ⚠️            |    100 |      1,401,740 |        147,120 |
| `register_service` ⚠️              |    100 |      4,917,820 |        524,688 |
| `deactivate_service` ⚠️            |    100 |      1,648,920 |        177,456 |
| `update_reputation` (+ CCI)        |    100 |    O(1) + CCI  |    O(1) + CCI  |
|---|---|---|---|
| `get_agents_contract`              |    500 |        429,340 |         34,944 |
| `get_service_count`                |    500 |        421,460 |         34,192 |
| `get_reputation_bounds`            |    500 |        414,510 |         33,472 |
| `get_service`                      |    500 |        483,660 |         41,368 |
| `list_services` (limit=10)         |    500 |        687,620 |         69,576 |
| `list_services_page` ⚠️            |    500 |      5,842,310 |        624,160 |
| `register_service` ⚠️              |    500 |     23,641,580 |      2,523,904 |
| `deactivate_service` ⚠️            |    500 |      6,914,240 |        739,128 |
| `update_reputation` (+ CCI)        |    500 |    O(1) + CCI  |    O(1) + CCI  |
<!-- COST_TABLE_END -->

### Scaling analysis

| Entry point | Complexity | Notes |
|-------------|-----------|-------|
| `__constructor` | O(1) | Runs once at deploy time; not callable afterwards |
| `get_agents_contract` | O(1) | Single persistent key lookup |
| `get_service_count` | O(1) | Single persistent key lookup |
| `get_reputation_bounds` | O(1) | Returns compile-time constants |
| `get_service` | O(1) | Direct key lookup by service ID |
| `list_services` | O(limit) read + O(limit²) sort | Page window is capped at 50; cost is independent of total registry size |
| `list_services_page` | **⚠️ O(N)** | Scans **all** stored IDs to count active services; avoid calling at large N |
| `register_service` | **⚠️ O(N)** | `active_service_exists` iterates every registered ID to enforce the uniqueness constraint |
| `deactivate_service` | **⚠️ O(C)** | Rewrites the per-category ID list; scales with services in the same category, not total N |
| `update_reputation` | O(1) + cross-contract | Registry storage is O(1); a sub-invocation to LodestarAgents is billed separately from its own budget |

**Budget guidance:**

- At 500 registered services `register_service` consumes ~23.6 M CPU
  instructions. The Soroban per-transaction limit is 100 M instructions, so
  headroom is comfortable today but shrinks as the registry grows further.
  Plan for ~47,000 instructions per additional service in the uniqueness scan.
- `list_services_page` scales similarly (~11,100 insns per additional service).
  Prefer `list_services` with an explicit `offset`/`limit` when you do not
  need the active-only guarantee across skipped inactive entries.
- `update_reputation` cost is dominated by the cross-contract call (`CCI`) to
  LodestarAgents; see `contract/agents/DEPLOY.md` for its cost profile.

## Network Details

- Network: Stellar Testnet
- RPC URL: https://soroban-testnet.stellar.org
- Network Passphrase: `Test SDF Network ; September 2015`
- Explorer: https://stellar.expert/explorer/testnet
