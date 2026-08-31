# ADR-0001: Two-Contract Split (Registry + Agents)

- **Status:** Accepted
- **Date:** 2026-08-31
- **Authors:** Lodestar team
- **Relates to:** [architecture.md](../architecture.md), [storage-layout.md](../storage-layout.md)

## Context

Lodestar's on-chain layer is deployed as **two separate Soroban contracts**:

| Contract | Crate | Responsibility |
|---|---|---|
| **LodestarRegistry** | `lodestar-registry` (`contract/src/lib.rs`) | Service registration, discovery, reputation voting, category filtering |
| **LodestarAgents** | `lodestar-agents` (`contract/agents/src/lib.rs`) | Agent identity, credit scoring (0–1000), spending policies, admin controls |

The registry holds an **immutable reference** to the agents contract address,
set in its `__constructor` at deployment and never changeable afterward
([`lib.rs:85`](../../contract/src/lib.rs#L85)). The agents contract holds a
mutable (but write-once) reference back to the registry, set via a post-deploy
`init()` call ([`agents/lib.rs:132`](../../contract/agents/src/lib.rs#L132)).

The two contracts interact in production through cross-contract `env.invoke_contract` calls:

1. **Registry → Agents:** `update_reputation` calls `is_registered` on the
   agents contract to verify the voter is a registered agent before accepting a
   reputation vote.
2. **Agents → Registry:** `record_payment` calls `get_service` on the registry
   to verify the caller is the registered provider for the service being paid.

This split is a significant architectural decision with real consequences for
cost, deployment, upgradeability, and coupling. It was never formally documented,
making it difficult for new contributors to evaluate or safely change.

## Decision

Keep the two-contract split. The rationale and the conditions under which it
should be revisited are documented below.

## Alternatives Considered

### Alternative A: Single Monolithic Contract

Merge all service registry and agent identity logic into one contract.

**Pros:**
- Eliminates all cross-contract call overhead (CPU + memory budget per hop).
- Single deployment — no ordering dependency, no post-deploy `init` wiring.
- Simpler testing — no mocks or integration test harnesses for cross-contract calls.
- One storage namespace — no need to duplicate `ServiceEntry` as a `#[contracttype]`
  in the agents crate (currently agents defines its own `ServiceEntry` copy at
  [`agents/lib.rs:36–48`](../../contract/agents/src/lib.rs#L36)).

**Cons:**
- **WASM size:** The combined contract would be larger. Soroban enforces a 64 KiB
  WASM limit per contract. Both contracts are already non-trivial; a merge risks
  approaching or exceeding this limit, especially as features are added.
- **Blast radius:** A bug in agent scoring logic would require redeploying the
  entire system, including all service records. With the split, the registry's
  service data is unaffected by an agents-only redeploy.
- **Independent upgrade cadence:** Scoring constants (`SCORE_SUCCESS`,
  `SCORE_FAILURE`, `FLAG_PENALTY`, daily spend limits) change more frequently
  than the registry's discovery and voting logic. The split lets the agents
  contract be redeployed without touching the registry.
- **Admin separation:** The agents contract has an `Admin` role (flag agents,
  deactivate agents, transfer admin). The registry has no admin role — it is
  intentionally neutral. Merging would force the admin key into the same
  contract that controls service discovery, which is a trust-model change.

### Alternative B: Three or More Contracts

Further split: e.g., a dedicated reputation contract, a separate policy contract.

**Pros:**
- Even finer-grained upgradeability.
- Smaller individual WASM binaries.

**Cons:**
- Multiplies cross-contract call chains (and their costs).
- Multiplies deployment ordering complexity.
- Over-engineering for the current feature set.

**Verdict:** Rejected. The current two-contract split already isolates the two
natural trust boundaries. Further splitting adds cost without meaningful benefit.

### Alternative C: Shared Library Crate (No Cross-Contract Call)

Extract shared types into a common crate and import them as a Rust dependency
in both contracts, eliminating any cross-contract call.

**Pros:**
- Zero runtime overhead for shared types.

**Cons:**
- Does not solve the core problem: the registry needs to *query agent state at
  runtime* (is this address registered?), not just share types. Without a
  cross-contract call, the registry would have to either trust the caller's
  claim or maintain its own copy of agent registrations — both strictly worse.

**Verdict:** Already partially done (agents crate is a `dev-dependency` for
integration tests), but cannot replace the runtime cross-contract call.

## Cost of the Cross-Contract Call

The cross-contract invocation cost is measured by the existing integration test
[`records_the_cost_of_the_cross_contract_invocation`](../../contract/tests/cross_contract_integration.rs#L176)
and asserted to stay below **100,000,000 CPU instructions**.

Observed costs (from `cargo test -- --nocapture`):

| Call path | What it does | Approximate CPU | Approximate Memory |
|---|---|---|---|
| Registry → Agents `is_registered` | Single `persistent.has()` lookup | ~2–5M CPU | ~500 KB |
| Agents → Registry `get_service` | Single `persistent.get()` deserialization | ~3–8M CPU | ~700 KB |

These are small relative to the per-transaction CPU budget on Stellar
(currently 100M CPU instructions for a single invocation, 200M for the
transaction). A single `update_reputation` vote or `record_payment` call fits
comfortably within limits.

**Key risk:** If either callee grows to read many storage entries (e.g., the
agents contract starts doing pagination internally), the cost could spike. The
integration test's `< 100_000_000` assertion guards against silent regressions.

## Deployment Ordering Constraint

The two-contract architecture imposes a **strict deployment order**:

```
1. Deploy LodestarAgents  (constructor takes `admin` address)
2. Deploy LodestarRegistry (constructor takes agents contract address)
3. Call agents.init(registry_contract_address)
```

Step 2 cannot happen before step 1 because the registry's constructor requires
the agents address. Step 3 is a one-time post-deploy wiring call.

This ordering is documented in [`contract/DEPLOY.md`](../../contract/DEPLOY.md)
(steps 5–7) and enforced by the constructor signatures. The agents contract's
`init()` is guarded against double-initialization (`"already initialized"` panic).

> [!WARNING]
> The registry's agents address is **immutable** (set in `__constructor`, no
> setter). If the agents contract must be replaced with a new deployment, the
> registry must also be redeployed. This is deliberate — it prevents a
> trust-anchor swap attack — but it means a "hot swap" of the agents contract
> is impossible without a full system redeploy.

## Coupling and Type Duplication

The agents contract defines its own copy of `ServiceEntry`
([`agents/lib.rs:36–48`](../../contract/agents/src/lib.rs#L36)) to
deserialize the return value of `registry.get_service()`. This creates a
**structural coupling**: if the registry's `ServiceEntry` gains, removes, or
reorders fields, the agents' copy must be updated in lockstep or the
cross-contract call will fail to deserialize.

Notably, the agents' copy is already missing the `pay_to` field present in the
registry's `ServiceEntry`. This works today because Soroban's XDR
serialization is positional and the agents contract only reads `provider` and
`id` from the deserialized struct. **Adding fields to the end of the registry's
`ServiceEntry` is safe; inserting or removing fields is not.**

> [!IMPORTANT]
> Any PR that modifies `ServiceEntry` fields in either contract must update
> both definitions and run the cross-contract integration tests
> (`contract/tests/cross_contract_integration.rs`).

## What Would Have to Be True to Merge Them

The two contracts should be merged into one **only if all** of the following
hold:

1. **WASM size headroom.** The combined contract compiles to ≤ 56 KiB (leaving
   margin below the 64 KiB limit for future features).
2. **Admin trust model is acceptable.** The team is comfortable giving the
   admin key (flag/deactivate agents) implicit authority over the service
   registry, or a more granular access-control scheme is added.
3. **Upgrade cadence converges.** Scoring parameters and registry logic change
   at roughly the same rate, so independent deployment is no longer valuable.
4. **Migration plan exists.** All persistent storage entries from both contracts
   can be migrated into a single contract's storage namespace, with the
   priorities documented in [`storage-layout.md`](../storage-layout.md#what-a-migration-must-preserve).
5. **Cross-contract type duplication becomes untenable.** If `ServiceEntry` or
   `AgentEntry` drift frequently, the coupling cost of maintaining two copies
   may exceed the cost of merging.

## Consequences

### Positive
- Each contract has a clear, narrow responsibility and trust boundary.
- The agents contract can be upgraded (scoring parameters, admin logic) without
  touching service records.
- The registry remains admin-free and neutral.
- The immutable constructor reference eliminates trust-anchor hijack risk.

### Negative
- Cross-contract calls consume additional CPU and memory budget per invocation.
- `ServiceEntry` must be kept in sync across two crates.
- Deployment requires strict ordering and a post-deploy wiring step.
- Replacing the agents contract requires a full registry redeployment.

### Neutral
- Integration tests must deploy both real contracts to catch deserialization or
  behavioral drift (already implemented in `cross_contract_integration.rs`).
- The storage layout documentation must cover both contracts' key spaces.
