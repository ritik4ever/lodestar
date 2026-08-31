# ADR-0001: Bind `record_payment` volume to a real on-chain USDC transfer

- **Status:** Proposed
- **Date:** 2026-08-28
- **Issue:** [Stellar-Ecosystem/lodestar#325](https://github.com/Stellar-Ecosystem/lodestar/issues/325)
- **Area:** `contract/agents` — `LodestarAgents::record_payment`

## Context

`LodestarAgents::record_payment` (`contract/agents/src/lib.rs:315`) updates an agent's
stats — `total_payments`, `successful_payments`, `failed_payments` and
`total_volume_stroops` — from an `amount_stroops` argument supplied by the
**calling provider**. The only verifications performed today are:

1. `caller.require_auth()` — the caller is a real Stellar signer.
2. A cross-contract call to the registry's `get_service` proving that
   `service.provider == caller` for the given `service_id`.

There is no check that a matching USDC transfer ever happened. As a result
`total_volume_stroops` and the success/failure counts are **provider-attested**,
not chain-verified. A provider can inflate volume for favored agents or record
payments that never occurred. Because the provider is the party whose service
reputation benefits from busy-looking agents, the incentive points the wrong
way.

Additionally, the credit score mechanics are gated on the same
provider-reported `success` boolean, so scoring integrity is affected by the
same trust gap.

### Why the x402 payment is invisible to the contract

In the current x402 flow an agent pays a provider **directly** with a Stellar
payment (a Stellar Asset Contract transfer of USDC), and the agent's request is
then served. Neither `LodestarAgents` nor `LodestarRegistry` is a party to the
transfer, and Soroban contracts cannot read another contract's past event logs.
Reconciling a reported payment therefore requires changing *where* the transfer
happens (make the agents contract touch the token), or trusting an external
attestation.

## Goals / Non-goals

**Goals**

- Recorded `amount_stroops` must correspond to a real, verified USDC transfer.
- Keep the provider-facing and agent-facing surface as simple as possible.
- Preserve backward compatibility where feasible, or provide a clean migration.

**Non-goals**

- Verifying that a *service outcome* was satisfactory (reputation signal only).
- Enforcing all of the x402 protocol on-chain.
- This ADR does **not** implement the change; it produces the design for a
  follow-up implementation issue.

## Considered designs

### Design A — Token-contract-intermediary relay (contract performs the transfer)

The agent authorizes the `LodestarAgents` contract on the USDC Stellar Asset
Contract with an allowance, and `record_payment` performs the transfer itself
via the SAC `transfer_from` interface.

**Flow**

1. Agent registers on-chain and pre-authorizes the agents contract:
   `USDC.approve(spender = agents_contract, amount, expiration_ledger)`.
   The allowance is capped at the agent's spending policy envelope.
2. Provider invokes `record_payment(agent, service_id, amount_stroops, success, caller)`
   as today, but the contract now additionally calls
   `USDC.transfer_from(from = agent, to = provider, amount = amount_stroops)`.
3. The transfer either succeeds inside the same transaction or the whole call
   reverts — so recorded volume cannot drift from moved value.
4. On success the existing stats, score, and daily-spend updates are applied.

**Trust assumptions**

- The configured token address is the canonical USDC SAC instance (admin-set at
  `init`, one-time, auditable).
- Agents sign at least a one-time `approve`; balances and allowances are
  enforced by the Stellar network, so the provider cannot inflate
  `amount_stroops` (the transfer would fail).
- No new off-chain trust anchor; the binding is cryptographic and on-chain.

**Costs / risks**

- Extra cross-contract call to the SAC per payment (compute & fee increase).
- Agents must sign an `approve`; the existing server-signed flow used by the
  demo and seed scripts (`backend/src/lib/contract.js:949`) must switch to
  agent-authorized allowance + provider-signed `record_payment`.
- `init` gains a `token_address` parameter (or a new `set_token_contract`);
  `DEPLOY.md`, `deployments.json`, and snapshot tests must be updated.
- Allowance expiry (`expiration_ledger` ≤ MAX) must be audited per policy.

### Design B — Off-chain attestation of real x402 receipts (oracle / verifier)

A trusted verifier (the backend or a dedicated service) observes the Stellar
network (Horizon/Archive) for the agent→provider USDC transfer tied to the x402
challenge, and supplies a signed receipt or the contract verifies a submitted
transfer truth via an attestor signature.

**Flow**

1. Agent pays provider via x402 as today (no approve required).
2. Verifier observes the transaction and produces a signed attestation
   `(service_id, agent, provider, amount_stroops, tx_hash, ledger)`.
3. Provider (or verifier) submits the attestation to `record_payment`, which
   checks the signature against a stored verifier public key and the amount
   against the attested value before recording.

**Trust assumptions**

- The attestor is honest and its key is a single point of compromise.
- Fee/clock components (ledger sequence, hash uniqueness) are validated to
  prevent replay of the same receipt across agents/services.
- Eventual consistency: a receipt can only exist after the transfer is
  confirmed, so attestation must bound confirmation depth.

**Costs / risks**

- Keeps the existing agent UX (no `approve`), and record of payment can stay
  server-signed.
- Adds an off-chain trust anchor and key management, contradicting the
  "contracts are the ultimate source of truth" boundary the project states in
  `docs/architecture.md`.
- More moving parts (attestor, expiration, replay protection) than Design A.

### Design C — Contract-held escrow (two-phase pull payment)

The agent transfers USDC **into** `LodestarAgents` keyed by `service_id`, and the
contract later releases it to the provider via a `claim_payment` call, recording
volume and score at claim time.

**Flow**

1. Agent transfers USDC to the agents contract with a memo/payload tagging
   `(service_id, provider)`.
2. Provider calls `claim_payment(agent, service_id)`; the contract verifies the
   escrow entry, transfers the held amount to the provider, and updates stats.

**Trust assumptions**

- The strongest: funds genuinely flow through the contract, so volume is
  provably real, but…
- Funds are locked while pending; an unclaimed payment is a griefing vector
  (requires a refund/expiry path).
- Two-party, two-transaction flow has noticeably worse UX than A or B.

**Costs / risks**

- Capital lock, refund logic, and extra transaction for the provider.
- Most complex migration of the three.

## Evaluation

| Criterion | Design A (relay) | Design B (attestation) | Design C (escrow) |
|---|---|---|---|
| Amount bound to real transfer | Yes (network-enforced) | Yes (attestor-enforced) | Yes (network-enforced) |
| New off-chain trust anchor | None | Attestor key | None |
| Agent-side UX delta | One-time `approve` | None | Pay to escrow + refund path |
| Provider-side delta | None (same call shape) | Submit receipt | `claim_payment` second tx |
| Extra compute/fee | Moderate | Low | Moderate |
| Replay / stale-data risk | None | Needs careful guards | None |
| Migration complexity | Medium (token addr, approve, scripts) | High (attestor infra) | High (escrow + refunds) |

## Decision

**Adopt Design A (token-contract-intermediary relay) as the recommended path
for the follow-up implementation issue.**

It is the only no-new-trust-anchor option among the feasible designs and binds
`amount_stroops` directly to value the network moves: if the allowance or
balance is insufficient, the transfer (and therefore any recorded volume)
reverts. Design B remains a viable fallback if an agent-facing `approve` step
is judged unacceptable; Design C is recorded for completeness but rejected due
to capital lock and added transaction complexity.

**Deferred decision points to resolve during implementation:**

- Exact provisioning of the SAC allowance (per-payment vs. per-spending-policy
  cap, default `expiration_ledger`).
- Whether `success == false` should skip the transfer and record a failure
  without volume (recommended) or still enforce a (refund-like) transfer.
- Whether `init` gains `token_address` directly or a `set_token_contract`
  migration path is used for already-deployed instances.

While this ADR is under review (status `Proposed`), the design is **not yet
resolved** on-chain, so the README documents `total_volume_stroops` as
provider-attested (see the companion README note).

## Consequences

- `record_payment` becomes atomic with a real transfer; inflated or fake volume
  becomes impossible via the relay path.
- The demo/seed/demo-boost scripts and backend caller
  (`backend/src/lib/contract.js`) must be updated to the authorize+record flow,
  or keep a clearly-marked demo-only escape hatch guarded against mainnet (the
  seeding docs already carry this warning).
- Contract tests (`contract/agents/src/lib.rs` snapshot suite) must be extended
  for the SAC transfer path (mock token) and for the migration/setup path.
- `docs/architecture.md` trust-boundary section should be revised once the
  implementation lands to describe the new token-mediated binding.

## References

- Issue: [Stellar-Ecosystem/lodestar#325](https://github.com/Stellar-Ecosystem/lodestar/issues/325)
- Current implementation: `contract/agents/src/lib.rs:315` — `record_payment`
- Caller: `backend/src/lib/contract.js:949` — `recordPaymentOnChain`
- x402 flow: `docs/x402-primer.md`
- Trust boundaries: `docs/architecture.md`