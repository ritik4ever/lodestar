# ADR-0001: Contract Immutability & Upgrade Policy

- **Status:** Accepted
- **Date:** 2026-08-28
- **Scope:** `LodestarRegistry` (`contract/src/lib.rs`) and `LodestarAgents` (`contract/agents/src/lib.rs`)

## Context

The Lodestar Service Registry is advertised as **"permanent and permissionless: no owner,
no gatekeeping"** (see `README.md`). Service providers register an x402 endpoint once and
it is expected to "become discoverable forever". Neither the registry nor the agents
contract currently implements the Soroban upgrade entry point
(`update_current_contract_wasm`) or any admin-gated code-upgrade function.

That raises two possibilities, and the project had never recorded a choice:

1. **Immutability is the product** — permanence is the point, so the absence of an upgrade
   path is deliberate.
2. **The absence is an accident** — a future team could add an admin + timelock upgrade
   path without realizing what they were giving up.

Because every deployed contract is permanent and permissionless, any bug or spec change in
a deployed contract is likewise permanent. This ADR makes the design stance explicit so it
is a decision, not an omission, and so the *consequence* (the only way to revise a deployed
contract is a new deployment) is documented as a first-class operational procedure.

## Decision

**Both Lodestar contracts are immutable by design.**

- Neither contract exports `update_current_contract_wasm` nor any admin-gated upgrade
  entry point. No entity — including the original deployer — can replace the deployed
  WASM on-chain.
- The registry's trust anchor, the `LodestarAgents` address, is fixed at deploy time by
  the `__constructor` and can never be re-pointed.
- The agents contract's `admin` key is **operational, not architectural**: it may flag or
  deactivate agents and transfer the admin key itself, but it **cannot** change scoring
  rules, spending caps, or the contract code.
- Any product revision (bug fix, new field, rule change) ships as a new deployment (v2)
  by the documented migration procedure below.
- Regression tests enforce the invariant: both contracts assert the standard upgrade
  symbol is not callable (`test_contract_is_not_upgradeable`), and the registry separately
  asserts the agents anchor is set once and immutable
  (`test_constructor_sets_agents_contract_immutably`).

## Trade-offs

### Why immutability wins here

- **The registry's value proposition is permanence.** A neutral discovery layer that
  anyone can register on only stays neutral if no single party can change its rules or
  delete/rewrite entries after the fact. Every additional authority (admin, multisig,
  timelock) reintroduces the capture and censorship risk the product exists to remove.
- **Permissionless participation must not depend on trusting the deployer.** If a
  provider registers "once", they must be able to rely on that record for as long as they
  want — not until an authority decides otherwise.
- **Deterministic verification.** Immutable WASM means `deployments.json` (source of
  truth for live addresses + hashes) can prove a deployment matches audited source
  forever. Third parties can independently verify on-chain state against source without
  watching a changelog.
- **No upgrade authorities to secure or lose.** An upgradeable design needs key custody,
  a timelock, key rotation, and incident-response discipline. Immutability eliminates
  that entire attack surface.

### What is knowingly given up

- **Bugs are permanent in the deployed contract.** The correction path is a v2 deployment
  (see migration story); a bug cannot be patched in place.
- **No in-place feature evolution.** Adding a field or changing a scoring rule requires a
  new deployment and re-migration of records.
- **Migration is not automatic or free.** Because v2 is itself permissionless, records
  are re-registered by providers (or an operator scripts it on their behalf); on-chain
  reputation history is not silently carried over.
- **The agents contract has a bounded operator.** The admin key can moderate agents; a
  compromised admin key cannot rewrite scoring logic or code, but can flag/deactivate
  agents and transfer itself. Flywheel risk is therefore capped, not zero.

## Alternatives considered (and rejected for this iteration)

### 1. Admin-gated, timelocked upgrade (`env.deployer().update_current_contract_wasm`)

Add an `admin` constructor arg to both contracts plus an upgrade function that requires
admin auth after a timelock delay.

- **Pros:** bugs and features can be shipped in place; the contract address and all
  storage survive; a timelock gives users a window to react.
- **Cons:** directly contradicts the registry's "permanent / permissionless / no owner"
  promise. Even with a timelock it establishes a governance authority that must be
  secured, trusted, and rotated — the exact trust assumption the product removes. The
  contract would no longer be verifiable forever; a future authority change is a standing
  risk.
- **Rejected because** the product's core value ("discoverable forever", "as neutral and
  permanent as Stellar itself") is stronger than the convenience of in-place patching.
  If in-place upgrades are ever wanted, they should be a *separate* contract family with
  the timelock + trust package designed in from the start, not bolted onto the permanent
  registry.

### 2. Multisig / DAO-gated upgrade

Replace single-admin with an m-of-n multisig or a governance contract.

- **Pros:** removes single-key custody risk for upgrades; distributed authority.
- **Cons:** still an authority; adds key-management and governance-process operational
  burden; does not remove capture risk, it just distributes it. Does not fit a product
  whose pitch is "no owner".
- **Rejected** for the same product reason. (If a future team chooses upgradeability for
  a different contract, this is the recommended authorization mechanism: multisig +
  timelock, documented in the ADR that makes that decision.)

### 3. Proxy / delegatecall pattern

Rejected outright: **Soroban has no proxy or `delegatecall` pattern.** Contract upgrades
(where allowed) replace WASM at the same address in place; they do not route through an
indirection contract.

### 4. "Permanent" registry + upgradeable agents contract

Upgrade the agents contract in place while keeping the registry immutable.

- **Cons:** the agents contract holds the registry address (`init` is one-time). If agents
  were upgradeable but the registry were not, the two immutable-vs-upgradeable contracts
  would still be permanently coupled; the agents upgrade path adds a governance authority
  into the reputation layer, and a compromise there could alter scoring rules that the
  registry's reputation votes depend on. The migration story is identical (redeploy both)
  because the cross-contract binding cannot re-point.
- **Rejected** for consistency: pairs of contracts that hard-bind each other should share
  the same upgrade policy so the whole system degrades predictable.

## Consequences

- **Operational:** all revisions go through the v2 migration procedure in
  `contract/DEPLOY.md`. Deployment-time hashing + `deployments.json` is the mechanism for
  verifying that what is live is what was reviewed.
- **Security:** no upgrade authority exists to attack. The agents `admin` key remains a
  real, bounded power (moderation); it is held by the operators and can be transferred.
- **Testing:** immutability is a tested invariant, not an assumption. See the test names
  above; removing the upgrade guard without also removing the ADR's decision is a visible,
  reviewable change.
- **Documentation:** `README.md`, `docs/architecture.md`, `contract/DEPLOY.md`, and
  `contract/agents/DEPLOY.md` point at this ADR.

## v2 migration story

Because v1 is immutable, a revision ships as a **v2 contract deployment**. The procedure
(for the exact commands, see `contract/DEPLOY.md`):

1. **Build & pin.** Build the new WASM from the revised source, record the SHA-256 hash of
   both `lodestar_registry.wasm` and `lodestar_agents.wasm` in `deployments.json`, and
   retain the exact source commit so the deployment is reproducible.
2. **Deploy the v2 agents contract first** with the same `--admin`, then bind it to the
   v2 registry via its one-time `init`.
3. **Deploy the v2 registry** with
   `stellar contract deploy -- --agents_contract <V2_AGENTS_CONTRACT_ID>`, binding its
   trust anchor to the v2 agents contract.
4. **Migrate records.** The registry exports `list_services_page` for paged reads. A
   migration helper walks v1 pages and, for each provider whose key is available to the
   operator (demo/testnet operations), re-signs and re-submits `register_service` to v2.
   New service IDs are assigned by v2; endpoints/prices/categories are carried over
   as-is. On-chain reputation and vote-cooldown state are **not** auto-migrated — they
   start fresh on v2 (agents re-earn reputation) or are restored by the backend/seed layer
   for demo data.
5. **Cut over.** Update `deployments.json`, the backend/frontend `.env` contract IDs, and
   any hosted configuration. v1 remains live and immutable; consumers that still read it
   continue to work until they re-point at v2.

### Why not migrate in place

Soroban's upgrade mechanism (`update_current_contract_wasm`) replaces WASM **at the same
address and preserves storage** in place, but it is a hosted capability a contract only
gets if it exposes it. Exposing it is the very authority this ADR removes. The
redeploy-and-migrate path above preserves the "permanent and permissionless" promise: no
party can mutate the once-published registry; the *new* registry is a fresh, honest,
verifiable artifact.

## References

- `README.md` — "The Solution": the registry is *permanent and permissionless: no owner,
  no gatekeeping, no downtime*.
- `docs/architecture.md` — component responsibilities and trust boundaries.
- `contract/DEPLOY.md` — deployment guide with the immutability statement and v2
  migration runbook.
- `contract/agents/DEPLOY.md` — agents deployment guide with the admin-role note.
- `contract/src/lib.rs`, `contract/agents/src/lib.rs` — the contracts and their
  immutability regression tests (`test_contract_is_not_upgradeable`,
  `test_constructor_sets_agents_contract_immutably`).
- Stellar SEP-0049 / Soroban upgrade guidance — background on
  `update_current_contract_wasm` and why in-place upgrade is a capability a contract must
  explicitly expose.