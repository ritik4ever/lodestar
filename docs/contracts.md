# Lodestar — Contract Reference

This document is the authoritative reference for every public function exposed by the two Lodestar Soroban smart contracts.

- **LodestarRegistry** — service discovery and reputation
- **LodestarAgents** — agent identity, credit scoring, and spending policy

For deployment instructions see [`contract/DEPLOY.md`](../contract/DEPLOY.md).  
For known gaps between documentation and implementation see [`README.md#known-gaps`](../README.md#known-gaps).

---

## Testnet addresses

| Contract | Address |
|---|---|
| LodestarRegistry | `CAKZALA72JTR6BV6N44E7L52C7QU5BAYYKVKYR2DFSV2YD2A2OI6WJMP` |
| LodestarAgents | `CCT4FUTW54K7BYZFOCBEM5MVLS42ZE25WJ3ONW7RLYXAF3HQS7ZQYA2N` |

Set shell variables used in all examples below:

```sh
REGISTRY=CAKZALA72JTR6BV6N44E7L52C7QU5BAYYKVKYR2DFSV2YD2A2OI6WJMP
AGENTS=CCT4FUTW54K7BYZFOCBEM5MVLS42ZE25WJ3ONW7RLYXAF3HQS7ZQYA2N
```

---

## Conventions

### Authorization notation

| Symbol | Meaning |
|---|---|
| 🔓 | No authorization required (read-only or permissionless write) |
| 🔑 `provider` | The `provider` address must sign the transaction |
| 🔑 `caller` (owner) | The `caller` argument must equal the agent's `owner` and must sign |
| 🔑 `caller` (admin) | The `caller` argument must equal the stored admin address and must sign |
| 🔑 `caller` (service provider) | The `caller` argument must equal the service's `provider` and must sign |

### Units

All USDC amounts in the contract are expressed in **stroops** (`i128`), where `1 USDC = 10 000 000 stroops`.

### Error handling

Soroban contracts panic on error rather than returning error codes. The panic message is surfaced as a simulation error by the RPC node. All panic strings used by the contracts are listed in the error tables below.

---

## LodestarRegistry

**Source:** [`contract/src/lib.rs`](../contract/src/lib.rs)

### Data types

#### `ServiceEntry`

```rust
pub struct ServiceEntry {
    pub id: u64,
    pub name: String,
    pub description: String,
    pub endpoint: String,
    pub price_usdc: String,   // human-readable USDC string, e.g. "0.001"
    pub pay_to: String,       // Stellar address that receives payment
    pub category: String,
    pub provider: Address,
    pub reputation: i32,      // range: -10 000 to +10 000
    pub active: bool,
    pub registered_at: u64,   // ledger sequence number
}
```

---

### `__constructor`

> Deploy-time only. Called once as part of contract deployment. Cannot be invoked after deployment.

**Signature**
```rust
pub fn __constructor(env: Env, agents_contract: Address)
```

**Parameters**

| Name | Type | Description |
|---|---|---|
| `agents_contract` | `Address` | Address of the deployed LodestarAgents contract. Fixed for the contract's lifetime — guards against trust-anchor swaps. |

**Authorization:** 🔓 (constructor — called by the deployer's transaction, not invokable afterward)

**Errors:** none

---

### `get_agents_contract`

> Returns the address of the LodestarAgents contract this registry was paired with at deployment.

**Signature**
```rust
pub fn get_agents_contract(env: Env) -> Option<Address>
```

**Returns:** `Option<Address>` — `Some(address)` always after a correct deployment; `None` only if called on a mis-deployed instance with no constructor.

**Authorization:** 🔓

**Example**
```sh
stellar contract invoke \
  --id $REGISTRY \
  --network testnet \
  -- get_agents_contract
```

---

### `register_service`

> Register a new x402-capable service endpoint. Each `(provider, endpoint)` pair may only have one active entry at a time.

**Signature**
```rust
pub fn register_service(
    env: Env,
    provider: Address,
    name: String,
    description: String,
    endpoint: String,
    price_usdc: String,
    pay_to: String,
    category: String,
) -> u64
```

**Parameters**

| Name | Type | Description |
|---|---|---|
| `provider` | `Address` | Stellar address of the service owner. Must sign the transaction. |
| `name` | `String` | Display name of the service. |
| `description` | `String` | Short description. |
| `endpoint` | `String` | Base URL of the x402-protected service. |
| `price_usdc` | `String` | Human-readable price string, e.g. `"0.001"`. Informational only — actual payment is enforced by the x402 middleware. |
| `pay_to` | `String` | Stellar address that receives x402 payments. |
| `category` | `String` | Arbitrary category tag, e.g. `"weather"`, `"search"`. Used to filter results. |

**Returns:** `u64` — the new service ID (monotonically incrementing from 1).

**Authorization:** 🔑 `provider`

**Errors**

| Panic message | Cause |
|---|---|
| `"Active service with same provider and endpoint already exists"` | A non-deactivated entry exists for this `(provider, endpoint)` pair. Deactivate it first. |

**Example**
```sh
stellar contract invoke \
  --id $REGISTRY \
  --source my-key \
  --network testnet \
  -- register_service \
  --provider GABCD...1234 \
  --name '"Weather API"' \
  --description '"Real-time weather data"' \
  --endpoint '"https://api.example.com/weather"' \
  --price_usdc '"0.001"' \
  --pay_to GABCD...1234 \
  --category '"weather"'
```

---

### `get_service`

> Fetch a single service entry by its ID.

**Signature**
```rust
pub fn get_service(env: Env, id: u64) -> ServiceEntry
```

**Parameters**

| Name | Type | Description |
|---|---|---|
| `id` | `u64` | Service ID returned by `register_service`. |

**Returns:** `ServiceEntry`

**Authorization:** 🔓

**Errors**

| Panic message | Cause |
|---|---|
| `"Service not found"` | No entry exists for the given ID. |

**Example**
```sh
stellar contract invoke \
  --id $REGISTRY \
  --network testnet \
  -- get_service \
  --id 1
```

---

### `list_services_page`

> Return a page of active services, sorted by reputation descending **within the page**. Page size is clamped to `[1, 20]`.

> ⚠️ **Known gap #1:** Sorting is per-page, not global. A high-reputation service on page 2 will not appear before a lower-reputation service on page 1. See [Known Gaps](../README.md#known-gaps).

**Signature**
```rust
pub fn list_services_page(
    env: Env,
    page: u32,
    page_size: u32,
    category: Option<String>,
) -> Vec<ServiceEntry>
```

**Parameters**

| Name | Type | Description |
|---|---|---|
| `page` | `u32` | Zero-based page index. |
| `page_size` | `u32` | Number of entries to return. Clamped to `[1, 20]`. |
| `category` | `Option<String>` | If `Some`, only services in that category are returned. Pass `null` / omit for all categories. |

**Returns:** `Vec<ServiceEntry>` — active services only, sorted by reputation descending within the window. May be shorter than `page_size` on the last page or when inactive entries are skipped.

**Authorization:** 🔓

**Example — first page, weather category**
```sh
stellar contract invoke \
  --id $REGISTRY \
  --network testnet \
  -- list_services_page \
  --page 0 \
  --page_size 10 \
  --category '"weather"'
```

**Example — all categories, page 2**
```sh
stellar contract invoke \
  --id $REGISTRY \
  --network testnet \
  -- list_services_page \
  --page 2 \
  --page_size 20 \
  --category null
```

---

### `update_reputation`

> Cast a signed reputation vote (+1 or −1) on a service. Three guards apply:
> 1. `caller` must sign the transaction.
> 2. `caller` must be a registered agent (verified by cross-contract call to LodestarAgents).
> 3. A per-`(service_id, agent)` cooldown of 720 ledgers (~1 hour) prevents rapid repeat votes.

**Signature**
```rust
pub fn update_reputation(env: Env, id: u64, positive: bool, caller: Address)
```

**Parameters**

| Name | Type | Description |
|---|---|---|
| `id` | `u64` | ID of the service to vote on. |
| `positive` | `bool` | `true` to upvote (+1), `false` to downvote (−1). |
| `caller` | `Address` | Address of the voting agent. Must sign the transaction and be registered in LodestarAgents. |

**Authorization:** 🔑 `caller` (registered agent)

**Reputation bounds:** `−10 000` to `+10 000`. Votes beyond the bounds are clamped silently.

**Errors**

| Panic message | Cause |
|---|---|
| `"agents contract not configured at deployment"` | Registry was deployed without an agents contract address (misconfigured). |
| `"unauthorized: caller is not a registered agent"` | `caller` has no entry in LodestarAgents. |
| `"cooldown: this agent has voted on this service too recently"` | Fewer than 720 ledgers have elapsed since the last vote by this agent on this service. |
| `"Service not found"` | No entry exists for `id`. |

**Example**
```sh
stellar contract invoke \
  --id $REGISTRY \
  --source my-agent-key \
  --network testnet \
  -- update_reputation \
  --id 1 \
  --positive true \
  --caller GABCD...AGENT
```

---

### `deactivate_service`

> Mark a service as inactive. Only the service's registered `provider` may deactivate it. Deactivation removes the service from the category index so it no longer appears in `list_services_page`. The service entry is preserved in storage and its ID is never reused.

**Signature**
```rust
pub fn deactivate_service(env: Env, provider: Address, id: u64)
```

**Parameters**

| Name | Type | Description |
|---|---|---|
| `provider` | `Address` | Must match the `provider` field of the service entry and must sign the transaction. |
| `id` | `u64` | ID of the service to deactivate. |

**Authorization:** 🔑 `provider`

**Errors**

| Panic message | Cause |
|---|---|
| `"Service not found"` | No entry exists for `id`. |
| `"Only the provider can deactivate this service"` | `provider` does not match the stored provider address. |
| `"Category index not found"` | Internal inconsistency — should not occur in a correctly deployed contract. |

**Example**
```sh
stellar contract invoke \
  --id $REGISTRY \
  --source my-provider-key \
  --network testnet \
  -- deactivate_service \
  --provider GABCD...1234 \
  --id 3
```

---

### `get_service_count`

> Return the total number of services ever registered (including deactivated ones).

**Signature**
```rust
pub fn get_service_count(env: Env) -> u64
```

**Returns:** `u64`

**Authorization:** 🔓

**Example**
```sh
stellar contract invoke \
  --id $REGISTRY \
  --network testnet \
  -- get_service_count
```

---

### `get_reputation_bounds`

> Return the minimum and maximum reputation values the contract will allow.

**Signature**
```rust
pub fn get_reputation_bounds(_env: Env) -> (i32, i32)
```

**Returns:** `(i32, i32)` — `(-10_000, 10_000)`

**Authorization:** 🔓

**Example**
```sh
stellar contract invoke \
  --id $REGISTRY \
  --network testnet \
  -- get_reputation_bounds
```

---

---

## LodestarAgents

**Source:** [`contract/agents/src/lib.rs`](../contract/agents/src/lib.rs)

### Data types

#### `AgentEntry`

```rust
pub struct AgentEntry {
    pub address: Address,
    pub name: String,
    pub description: String,
    pub owner: Address,
    pub score: i32,                     // 0 – 1000
    pub total_payments: u64,
    pub successful_payments: u64,
    pub failed_payments: u64,
    pub total_volume_stroops: i128,
    pub registered_at: u64,             // ledger sequence
    pub last_active: u64,               // ledger sequence
    pub active: bool,
    pub flagged: bool,
    pub flag_reason: String,
}
```

#### `SpendingPolicy`

```rust
pub struct SpendingPolicy {
    pub agent_address: Address,
    pub max_per_tx_stroops: i128,
    pub max_per_day_stroops: i128,
    pub allowed_categories: Vec<String>, // empty = all categories allowed
    pub min_score_to_earn: i32,         // agents below this score cannot gain score
    pub daily_spent_stroops: i128,      // auto-resets after DAY_LEDGERS (17 280)
    pub last_reset_ledger: u64,
}
```

#### `ScoringConfig`

```rust
pub struct ScoringConfig {
    pub initial_score: i32,   // 100
    pub score_success: i32,   // +10
    pub score_failure: i32,   // -25
    pub flag_penalty: i32,    // -200
}
```

#### Score tiers

| Score | Tier |
|---|---|
| 0–299 | New |
| 300–599 | Building |
| 600–899 | Established |
| 900–999 | Trusted |
| 1000 | Elite |

---

### `__constructor`

> Deploy-time only. Stores the admin address. Cannot be invoked after deployment.

**Signature**
```rust
pub fn __constructor(env: Env, admin: Address)
```

**Parameters**

| Name | Type | Description |
|---|---|---|
| `admin` | `Address` | Stellar address with admin privileges (`flag_agent`, `admin_deactivate_agent`, `transfer_admin`). |

**Authorization:** 🔓 (constructor)

**Errors:** none

---

### `init`

> One-time post-deploy setup. Stores the address of the LodestarRegistry contract. May only be called once — panics if called again.

**Signature**
```rust
pub fn init(env: Env, registry_contract: Address)
```

**Parameters**

| Name | Type | Description |
|---|---|---|
| `registry_contract` | `Address` | Address of the deployed LodestarRegistry. Used by `record_payment` to verify that the caller is the service's registered provider. |

**Authorization:** 🔓 (no auth check; idempotency guard prevents re-initialization)

**Errors**

| Panic message | Cause |
|---|---|
| `"already initialized"` | `init` was called more than once. |

**Example**
```sh
stellar contract invoke \
  --id $AGENTS \
  --source deployer-key \
  --network testnet \
  -- init \
  --registry_contract $REGISTRY
```

---

### `register_agent`

> Register a new agent identity. The agent starts with score 100 and a permissive default spending policy. No authorization is required — the backend server calls this on behalf of any wallet address.

**Signature**
```rust
pub fn register_agent(
    env: Env,
    agent_address: Address,
    name: String,
    description: String,
    owner: Address,
) -> u64
```

**Parameters**

| Name | Type | Description |
|---|---|---|
| `agent_address` | `Address` | The agent's Stellar address. |
| `name` | `String` | Display name. |
| `description` | `String` | Description. |
| `owner` | `Address` | Address that may call owner-restricted functions (`deactivate_agent`, `update_policy`). Typically equals `agent_address`. |

**Returns:** `u64` — total agent count after registration.

**Default spending policy created at registration**

| Field | Default value |
|---|---|
| `max_per_tx_stroops` | `10 000 000 000` (1 000 USDC) |
| `max_per_day_stroops` | `100 000 000 000` (10 000 USDC) |
| `allowed_categories` | `[]` (all categories permitted) |
| `min_score_to_earn` | `0` (all agents may earn score) |

**Authorization:** 🔓

**Errors**

| Panic message | Cause |
|---|---|
| `"agent already registered"` | An entry for `agent_address` already exists. |

**Example**
```sh
stellar contract invoke \
  --id $AGENTS \
  --network testnet \
  -- register_agent \
  --agent_address GXYZ...AGENT \
  --name '"MyBot-Alpha"' \
  --description '"Autonomous weather agent"' \
  --owner GXYZ...AGENT
```

---

### `get_agent`

> Retrieve a full agent entry.

**Signature**
```rust
pub fn get_agent(env: Env, agent_address: Address) -> Option<AgentEntry>
```

**Returns:** `Option<AgentEntry>` — `None` if the address is not registered.

**Authorization:** 🔓

**Example**
```sh
stellar contract invoke \
  --id $AGENTS \
  --network testnet \
  -- get_agent \
  --agent_address GXYZ...AGENT
```

---

### `get_policy`

> Retrieve a spending policy. The daily-spend counter is auto-reset to zero in the returned value if a new day has elapsed, even though the stored value is only written on the next `record_payment` or `update_policy` call.

**Signature**
```rust
pub fn get_policy(env: Env, agent_address: Address) -> Option<SpendingPolicy>
```

**Returns:** `Option<SpendingPolicy>` — `None` if the agent is not registered.

**Authorization:** 🔓

**Example**
```sh
stellar contract invoke \
  --id $AGENTS \
  --network testnet \
  -- get_policy \
  --agent_address GXYZ...AGENT
```

---

### `get_score`

> Return an agent's current credit score.

**Signature**
```rust
pub fn get_score(env: Env, agent_address: Address) -> i32
```

**Returns:** `i32` — current score (0–1000), or `−1` if the address is not registered.

**Authorization:** 🔓

**Example**
```sh
stellar contract invoke \
  --id $AGENTS \
  --network testnet \
  -- get_score \
  --agent_address GXYZ...AGENT
```

---

### `is_registered`

> Return whether an address has a registered agent entry.

**Signature**
```rust
pub fn is_registered(env: Env, agent_address: Address) -> bool
```

**Returns:** `bool`

**Authorization:** 🔓

**Example**
```sh
stellar contract invoke \
  --id $AGENTS \
  --network testnet \
  -- is_registered \
  --agent_address GXYZ...AGENT
```

---

### `is_eligible`

> Return whether an agent is active, not flagged, and meets a minimum score requirement.

**Signature**
```rust
pub fn is_eligible(env: Env, agent_address: Address, min_score: i32) -> bool
```

**Parameters**

| Name | Type | Description |
|---|---|---|
| `agent_address` | `Address` | Agent to check. |
| `min_score` | `i32` | Minimum score the agent must meet or exceed. |

**Returns:** `bool` — `true` only when `active && !flagged && score >= min_score`. Returns `false` for unregistered agents.

**Authorization:** 🔓

**Example — check if agent meets 600-point threshold**
```sh
stellar contract invoke \
  --id $AGENTS \
  --network testnet \
  -- is_eligible \
  --agent_address GXYZ...AGENT \
  --min_score 600
```

---

### `check_spending_allowed`

> Return whether a proposed payment amount is within the agent's spending policy for the current day.

> ⚠️ **Known gap #2:** This is a read-only query. `record_payment` does not call this internally — the pre-payment guard runs in the backend. Direct contract callers must call `check_spending_allowed` themselves before calling `record_payment`. See [Known Gaps](../README.md#known-gaps).

**Signature**
```rust
pub fn check_spending_allowed(
    env: Env,
    agent_address: Address,
    amount_stroops: i128,
) -> bool
```

**Parameters**

| Name | Type | Description |
|---|---|---|
| `agent_address` | `Address` | Agent whose policy to check. |
| `amount_stroops` | `i128` | Proposed payment amount in stroops. |

**Returns:** `bool` — `false` when:
- Agent is not registered
- Agent is inactive or flagged
- `amount_stroops > max_per_tx_stroops`
- `daily_spent_stroops + amount_stroops > max_per_day_stroops`

**Note:** `allowed_categories` is **not** checked by this function. Category enforcement is handled at the backend level only.

**Authorization:** 🔓

**Example — check if 0.001 USDC (10 000 stroops) is allowed**
```sh
stellar contract invoke \
  --id $AGENTS \
  --network testnet \
  -- check_spending_allowed \
  --agent_address GXYZ...AGENT \
  --amount_stroops 10000
```

---

### `record_payment`

> Record the outcome of an x402 payment. Updates the agent's score, payment stats, and daily spend counter. Only the service's registered provider may call this.

> **Calling sequence for direct callers:** call `check_spending_allowed` first, then initiate the x402 payment, then call `record_payment` with the result.

**Signature**
```rust
pub fn record_payment(
    env: Env,
    agent_address: Address,
    service_id: u64,
    amount_stroops: i128,
    success: bool,
    caller: Address,
)
```

**Parameters**

| Name | Type | Description |
|---|---|---|
| `agent_address` | `Address` | Agent whose record to update. |
| `service_id` | `u64` | ID of the service in LodestarRegistry. Used to verify `caller` is the service's provider. |
| `amount_stroops` | `i128` | Payment amount in stroops. Added to `daily_spent_stroops` on success only. |
| `success` | `bool` | `true` → score +10, `successful_payments++`, daily spend updated. `false` → score −25, `failed_payments++`, daily spend unchanged. |
| `caller` | `Address` | Must equal the `provider` of `service_id` and must sign the transaction. |

**Score effects**

| Outcome | Score delta | Constraint |
|---|---|---|
| Success | `+10` | Applied only if `agent.score >= policy.min_score_to_earn`; capped at 1000 |
| Failure | `−25` | Clamped to minimum 0 |

**Authorization:** 🔑 `caller` (service provider)

**Errors**

| Panic message | Cause |
|---|---|
| `"registry contract not set — call init() first"` | `init()` was never called after deployment. |
| `"unauthorized: caller is not the service provider"` | `caller` does not match the `provider` field of `service_id` in the registry. |
| `"agent not found"` | `agent_address` is not registered. |
| `"policy not found"` | Agent has no spending policy (should not occur for correctly registered agents). |

**Example — record a successful 0.001 USDC payment**
```sh
# amount_stroops = 0.001 * 10_000_000 = 10_000
stellar contract invoke \
  --id $AGENTS \
  --source provider-key \
  --network testnet \
  -- record_payment \
  --agent_address GXYZ...AGENT \
  --service_id 1 \
  --amount_stroops 10000 \
  --success true \
  --caller GABCD...PROVIDER
```

---

### `update_policy`

> Replace an agent's spending policy. The daily-spend counter and reset ledger are preserved across the update.

**Signature**
```rust
pub fn update_policy(
    env: Env,
    agent_address: Address,
    max_per_tx_stroops: i128,
    max_per_day_stroops: i128,
    allowed_categories: Vec<String>,
    min_score_to_earn: i32,
    caller: Address,
)
```

**Parameters**

| Name | Type | Description |
|---|---|---|
| `agent_address` | `Address` | Agent whose policy to update. |
| `max_per_tx_stroops` | `i128` | New per-transaction cap in stroops. |
| `max_per_day_stroops` | `i128` | New daily cap in stroops. |
| `allowed_categories` | `Vec<String>` | Whitelist of permitted category strings. Empty list = all categories allowed. |
| `min_score_to_earn` | `i32` | Agents below this score cannot gain points from successful payments. |
| `caller` | `Address` | Must equal the agent's `owner` and must sign the transaction. |

**Authorization:** 🔑 `caller` (owner)

**Errors**

| Panic message | Cause |
|---|---|
| `"agent not found"` | `agent_address` is not registered. |
| `"unauthorized"` | `caller` does not match the agent's `owner`. |

**Example — restrict to 0.01 USDC/tx, 1 USDC/day, weather only**
```sh
stellar contract invoke \
  --id $AGENTS \
  --source owner-key \
  --network testnet \
  -- update_policy \
  --agent_address GXYZ...AGENT \
  --max_per_tx_stroops 100000 \
  --max_per_day_stroops 10000000 \
  --allowed_categories '["weather"]' \
  --min_score_to_earn 0 \
  --caller GXYZ...OWNER
```

---

### `deactivate_agent`

> Deactivate an agent (owner-initiated). A deactivated agent is blocked by `check_spending_allowed` and `is_eligible`. The entry is preserved in storage.

**Signature**
```rust
pub fn deactivate_agent(env: Env, agent_address: Address, caller: Address)
```

**Parameters**

| Name | Type | Description |
|---|---|---|
| `agent_address` | `Address` | Agent to deactivate. |
| `caller` | `Address` | Must equal the agent's `owner` and must sign. |

**Authorization:** 🔑 `caller` (owner)

**Errors**

| Panic message | Cause |
|---|---|
| `"agent not found"` | `agent_address` is not registered. |
| `"unauthorized"` | `caller` does not match the agent's `owner`. |

**Example**
```sh
stellar contract invoke \
  --id $AGENTS \
  --source owner-key \
  --network testnet \
  -- deactivate_agent \
  --agent_address GXYZ...AGENT \
  --caller GXYZ...OWNER
```

---

### `flag_agent`

> Flag an agent for a policy violation. Applies a score penalty of −200 (clamped to 0). Only the admin may call this.

**Signature**
```rust
pub fn flag_agent(env: Env, agent_address: Address, reason: String, caller: Address)
```

**Parameters**

| Name | Type | Description |
|---|---|---|
| `agent_address` | `Address` | Agent to flag. |
| `reason` | `String` | Human-readable reason stored on-chain. |
| `caller` | `Address` | Must equal the stored admin address and must sign. |

**Authorization:** 🔑 `caller` (admin)

**Score effect:** `score = max(0, score - 200)`

**Errors**

| Panic message | Cause |
|---|---|
| `"admin not set — call initialize() first"` | Constructor has not run (misconfigured contract). |
| `"unauthorized"` | `caller` does not match the stored admin address. |
| `"agent not found"` | `agent_address` is not registered. |

**Example**
```sh
stellar contract invoke \
  --id $AGENTS \
  --source admin-key \
  --network testnet \
  -- flag_agent \
  --agent_address GXYZ...AGENT \
  --reason '"Repeated payment failures detected"' \
  --caller GADMIN...1234
```

---

### `admin_deactivate_agent`

> Forcibly deactivate any agent regardless of ownership. Admin only.

**Signature**
```rust
pub fn admin_deactivate_agent(env: Env, agent_address: Address, caller: Address)
```

**Authorization:** 🔑 `caller` (admin)

**Errors**

| Panic message | Cause |
|---|---|
| `"admin not set — call initialize() first"` | Misconfigured contract. |
| `"unauthorized"` | `caller` is not the admin. |
| `"agent not found"` | `agent_address` is not registered. |

**Example**
```sh
stellar contract invoke \
  --id $AGENTS \
  --source admin-key \
  --network testnet \
  -- admin_deactivate_agent \
  --agent_address GXYZ...AGENT \
  --caller GADMIN...1234
```

---

### `get_admin`

> Return the current admin address.

**Signature**
```rust
pub fn get_admin(env: Env) -> Address
```

**Returns:** `Address`

**Authorization:** 🔓

**Errors**

| Panic message | Cause |
|---|---|
| `"admin not set — call initialize() first"` | Misconfigured contract. |

**Example**
```sh
stellar contract invoke \
  --id $AGENTS \
  --network testnet \
  -- get_admin
```

---

### `transfer_admin`

> Transfer the admin role to a new address. The current admin must sign. The change takes effect immediately.

**Signature**
```rust
pub fn transfer_admin(env: Env, new_admin: Address, caller: Address)
```

**Parameters**

| Name | Type | Description |
|---|---|---|
| `new_admin` | `Address` | Address that will become the new admin. |
| `caller` | `Address` | Current admin; must sign the transaction. |

**Authorization:** 🔑 `caller` (admin)

**Errors**

| Panic message | Cause |
|---|---|
| `"admin not set — call initialize() first"` | Misconfigured contract. |
| `"unauthorized"` | `caller` is not the current admin. |

**Example**
```sh
stellar contract invoke \
  --id $AGENTS \
  --source admin-key \
  --network testnet \
  -- transfer_admin \
  --new_admin GNEW...ADMIN \
  --caller GADMIN...1234
```

---

### `list_agents`

> Return up to `limit` agents in registration order.

> **Note:** This is a legacy endpoint. For large agent sets it may approach Soroban compute limits. Prefer `list_agents_page` for production use.

**Signature**
```rust
pub fn list_agents(env: Env, limit: u32) -> Vec<AgentEntry>
```

**Authorization:** 🔓

**Example**
```sh
stellar contract invoke \
  --id $AGENTS \
  --network testnet \
  -- list_agents \
  --limit 20
```

---

### `list_agents_page`

> Return a single page of agents in registration order.

**Signature**
```rust
pub fn list_agents_page(env: Env, page: u32, page_size: u32) -> Vec<AgentEntry>
```

**Parameters**

| Name | Type | Description |
|---|---|---|
| `page` | `u32` | Zero-based page index. |
| `page_size` | `u32` | Number of results per page. |

**Returns:** `Vec<AgentEntry>` — empty vec if `page * page_size >= total_agents`.

**Authorization:** 🔓

**Example**
```sh
stellar contract invoke \
  --id $AGENTS \
  --network testnet \
  -- list_agents_page \
  --page 0 \
  --page_size 50
```

---

### `get_agent_count`

> Return the total number of registered agents (including deactivated or flagged ones).

**Signature**
```rust
pub fn get_agent_count(env: Env) -> u64
```

**Returns:** `u64`

**Authorization:** 🔓

**Example**
```sh
stellar contract invoke \
  --id $AGENTS \
  --network testnet \
  -- get_agent_count
```

---

### `get_scoring_config`

> Return the current scoring constants compiled into the contract.

**Signature**
```rust
pub fn get_scoring_config(env: Env) -> ScoringConfig
```

**Returns:** `ScoringConfig` — `{ initial_score: 100, score_success: 10, score_failure: -25, flag_penalty: -200 }`

**Authorization:** 🔓

**Example**
```sh
stellar contract invoke \
  --id $AGENTS \
  --network testnet \
  -- get_scoring_config
```

---

## Quick-reference tables

### LodestarRegistry — all public functions

| Function | Auth | Mutating |
|---|---|---|
| `__constructor` | deployer | ✅ |
| `get_agents_contract` | 🔓 | ❌ |
| `register_service` | provider | ✅ |
| `get_service` | 🔓 | ❌ |
| `list_services_page` | 🔓 | ❌ |
| `update_reputation` | registered agent | ✅ |
| `deactivate_service` | provider | ✅ |
| `get_service_count` | 🔓 | ❌ |
| `get_reputation_bounds` | 🔓 | ❌ |

### LodestarAgents — all public functions

| Function | Auth | Mutating |
|---|---|---|
| `__constructor` | deployer | ✅ |
| `init` | 🔓 (one-time) | ✅ |
| `register_agent` | 🔓 | ✅ |
| `get_agent` | 🔓 | ❌ |
| `get_policy` | 🔓 | ❌ |
| `get_score` | 🔓 | ❌ |
| `is_registered` | 🔓 | ❌ |
| `is_eligible` | 🔓 | ❌ |
| `check_spending_allowed` | 🔓 | ❌ |
| `record_payment` | service provider | ✅ |
| `update_policy` | owner | ✅ |
| `deactivate_agent` | owner | ✅ |
| `flag_agent` | admin | ✅ |
| `admin_deactivate_agent` | admin | ✅ |
| `get_admin` | 🔓 | ❌ |
| `transfer_admin` | admin | ✅ |
| `list_agents` | 🔓 | ❌ |
| `list_agents_page` | 🔓 | ❌ |
| `get_agent_count` | 🔓 | ❌ |
| `get_scoring_config` | 🔓 | ❌ |
