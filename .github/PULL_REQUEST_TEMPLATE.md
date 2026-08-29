## Description

<!-- What does this PR do and why? -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / cleanup
- [ ] Documentation
- [ ] Test coverage
- [ ] Infrastructure / CI

---

## Capability-claim checklist

Every PR that touches **contracts, backend routes, or the agent script** must complete this section.
Skip it only for docs-only or CI-only changes.

### For each README capability claim affected by this PR:

- [ ] I have verified the claim against the code in this PR (or confirmed it was already correct)
- [ ] If I am **adding** a new capability, the README or docs reflect _exactly_ what the code enforces — not what it _intends_ to enforce eventually
- [ ] If I am **removing or relaxing** a guarantee, the README correction is included in this PR
- [ ] If a gap remains after this PR (i.e. the claim is still aspirational), a tracking issue exists and the README links to it

### Specific claims to re-verify if you touched the relevant code:

| Claim | Code location to check |
|---|---|
| `list_services_page` returns results sorted by reputation within a page | `contract/src/lib.rs` `list_services_page` |
| Pre-payment spend check runs before x402 call | `backend/src/routes/agents.js` `can-spend` handler + `agent/agent.js` `checkSpend` |
| `record_payment` updates daily-spend counter | `contract/agents/src/lib.rs` `record_payment` |
| Score changes: +10 success, −25 failure | `contract/agents/src/lib.rs` `SCORE_SUCCESS` / `SCORE_FAILURE` |
| `is_eligible` gates access by minimum score | `contract/agents/src/lib.rs` `is_eligible` |
| Duplicate registration is rejected | `contract/src/lib.rs` `active_service_exists` |

### Open known gaps (do not re-introduce misleading claims about these):

- **#1** Global reputation sort is per-page only, not globally guaranteed
- **#2** `record_payment` does not call `check_spending_allowed` on-chain; enforcement is backend-only

---

## Testing

- [ ] Existing tests pass (`npm test` / `cargo test`)
- [ ] New behaviour is covered by tests
- [ ] Any contract change has a corresponding Soroban unit test
