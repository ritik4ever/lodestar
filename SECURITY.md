# Security Policy & Dependency Vulnerability Scanning

Lodestar maintains automated dependency security scanning across all Node.js and Rust workspaces to identify and mitigate transitive and direct dependency vulnerabilities.

## Automated CI Scanning

Dependency vulnerability scanning runs automatically in GitHub Actions (`.github/workflows/ci.yml`) under the `dependency-audit` job:
- **Triggers**: Every pull request targeting `main`, every commit pushed to `main`, and on a **weekly schedule** (Sundays at 00:00 UTC).
- **Threshold**: High and critical findings cause the build to fail.

### Monitored Workspaces

| Workspace | Technology | Audit Tool & Command | Threshold / Rules |
| --- | --- | --- | --- |
| `backend` | Node.js | `npm audit --audit-level=high` | Fails on High & Critical |
| `frontend` | Node.js | `npm audit --audit-level=high` | Fails on High & Critical |
| `agent` | Node.js | `npm audit --audit-level=high` | Fails on High & Critical |
| `contract` | Rust | `cargo audit` | Fails on High & Critical |
| `contract/agents` | Rust | `cargo audit` | Fails on High & Critical |

---

## Local Verification Instructions

Developers should run dependency audits locally before submitting pull requests:

### Node.js Workspaces (`backend`, `frontend`, `agent`)

```bash
# Run in the respective workspace directory:
cd backend && npm audit --audit-level=high
cd frontend && npm audit --audit-level=high
cd agent && npm audit --audit-level=high
```

### Rust Workspaces (`contract`, `contract/agents`)

```bash
# Ensure cargo-audit is installed:
cargo install cargo-audit --locked

# Run in the respective contract directory:
cd contract && cargo audit
cd contract/agents && cargo audit
```

---

## Remediation Workflow

When a vulnerability scan fails or reports high/critical vulnerabilities:

1. **Automatic Patching**: Attempt non-breaking automated fixes:
   - Node: `npm audit fix`
   - Rust: `cargo update`
2. **Manual Dependency Updates**: If an advisory requires updating a direct dependency version, update `package.json` or `Cargo.toml` and test thoroughly.
3. **Breaking Changes Verification**: Run local test suites (`npm test`, `cargo test`) after applying security updates to ensure no regressions.

---

## Process for Accepted Risks & Exceptions

In rare situations where a reported vulnerability cannot immediately be patched (e.g., no upstream fix is available yet, or the flaw affects a dev-only CLI tool that is not deployed or executed in production), an accepted risk exception may be granted through the following process:

### 1. Risk Evaluation & Criteria

A vulnerability may be considered for an accepted risk exception only if ALL of the following criteria are met:
- **Impact Assessment**: The vulnerable code path is demonstrably unreachable in the application's runtime environment or build output.
- **No Available Fix**: Upstream maintainers have not yet released a patch, or upgrading would cause an immediate breaking change to core smart contract / protocol logic.
- **Mitigation in Place**: Compensating controls (e.g., rate-limiting, input validation, execution isolation) restrict exploitation potential.

### 2. Documenting Accepted Risks

Accepted risks must be formally recorded below in the **Accepted Risk Registry** table with the following details:
- **CVE / Advisory ID**: The unique vulnerability identifier.
- **Package Name & Version**: The affected dependency.
- **Workspace**: The affected component (`backend`, `frontend`, `agent`, `contract`).
- **Severity**: Critical, High, etc.
- **Justification / Risk Assessment**: Concise explanation of why the risk is acceptable temporarily.
- **Review Date**: Target date for re-evaluating upstream patches (maximum 30 days).

### 3. Technical Suppression (Where Applicable)

- **Cargo Audit**: Exceptions can be ignored in CI using `cargo audit --ignore <RUSTSEC-ID>` or a local `audit.toml` configuration file referencing the documented risk ID.
- **NPM Audit**: Packages with unfixable transitive vulnerabilities can be temporarily overridden using `overrides` (in `package.json`) or documented risk justification if `--audit-level=high` continues to flag unpatchable dev-only packages.

### 4. Review & Governance

All accepted risk exceptions must be reviewed during weekly scheduled CI runs and cleared as soon as upstream security patches become available.

---

## Accepted Risk Registry

| Risk ID | Package | Workspace | CVE / Advisory | Justification | Review Date | Status |
| --- | --- | --- | --- | --- | --- | --- |
| *None currently registered* | - | - | - | - | - | Active |
