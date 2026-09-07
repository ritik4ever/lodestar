## Summary

<!-- Please provide a brief summary of your changes. Link to the relevant issue(s) below. -->

Closes #(issue-number)

## Test Plan

<!-- How did you test your changes? -->

- [ ] Tests pass locally (`npm test` / `cargo test` as appropriate)
- [ ] Lint / type-check passes (`npm run lint` / `npx tsc --noEmit`)
- [ ] Changes have been tested in the relevant workspace (`frontend`, `backend`, `contract`, `agent`)

## Contract Changes

<!--
  Delete this whole section if your PR does not touch `contract/` or `contract/agents/`.
  These questions are asked up front because the answers are expensive to discover
  in review, and far more expensive to discover after a mainnet deploy.
-->

- [ ] **Not applicable** — this PR does not change contract code

### Storage layout

- [ ] No `DataKey` variant was added, removed, renamed, or had its payload type changed
- [ ] No `#[contracttype]` struct changed shape (fields added, removed, reordered, or retyped)
- [ ] Existing stored entries can still be read by this version

<!-- If any box above is unchecked, describe the migration for existing data: -->

Migration plan:

### ABI compatibility

- [ ] No public function signature changed (name, parameters, return type)
- [ ] No function was removed
- [ ] Backend, agent, and frontend callers still compile against this ABI

<!-- If the ABI changed, list every caller updated in this PR: -->

Callers updated:

### Deployment

- [ ] **No redeploy required** — off-chain only
- [ ] New WASM upload required, no state migration
- [ ] New WASM upload **and** state migration required
- [ ] New contract deployment (new contract ID — dependants must be reconfigured)

Target networks: <!-- testnet / futurenet / mainnet -->

### Test snapshots

Soroban writes `contract/test_snapshots/*.json` when tests run. A behavioural change
regenerates them, and stale snapshots hide real diffs.

- [ ] `cargo test` was run and any changed snapshots are committed
- [ ] Snapshot diffs were reviewed and are explained by this change
- [ ] New tests cover the changed behaviour, including the failure paths

## Checklist

- [ ] My code follows the project's coding style
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code where necessary, particularly in hard-to-understand areas
- [ ] My changes generate no new warnings or errors
- [ ] I have added tests that prove my fix is effective or that my feature works (if applicable)

## Environment

<!-- Please provide relevant environment details -->

- Workspace: (frontend / backend / contract / agent)
- OS:
- Node.js version (if applicable):
