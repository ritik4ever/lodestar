# Security Policy

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.** Lodestar handles on-chain
value; a public report discloses the weakness to everyone, including anyone able to
exploit it, before a fix exists.

Report privately through GitHub's private vulnerability reporting:

**https://github.com/Stellar-Ecosystem/lodestar/security/advisories/new**

The report is visible only to maintainers. You can collaborate on a fix in the advisory
and it is published once a patch ships.

## What to include

- Which component is affected — contract, backend, agent, or frontend
- The network and, for contract issues, the contract ID and WASM hash
- What an attacker can achieve: stolen funds, forged reputation, denial of service, data disclosure
- Steps to reproduce, ideally a minimal script or transaction
- Any suggested fix, if you have one

## Scope

**In scope**

- The Soroban contract in `contract/`: fund loss, unauthorised state changes, reputation forgery
- Backend (`backend/`): authentication and authorisation bypass, payment verification flaws, injection, secret disclosure
- Agent (`agent/`): payment handling, key handling
- Frontend (`frontend/`): XSS, wallet-interaction flaws, exposure of user secrets

**Out of scope**

- Vulnerabilities in third-party dependencies with no working exploit path through Lodestar — report those upstream
- Findings that require a compromised machine or a malicious browser extension already in place
- Missing hardening headers with no demonstrated impact
- Automated scanner output with no proof of exploitability
- Testnet-only issues arising from testnet's own properties (free lumens, resettable ledger)

## Response

- **Acknowledgement** within 3 business days
- **Initial assessment**, including whether we accept the report and its severity, within 7 business days
- **Fix timeline** communicated in the advisory; critical issues affecting mainnet funds are prioritised above all other work

Please give us a reasonable opportunity to ship a fix before disclosing publicly. We are
happy to credit you in the advisory — tell us how you would like to be named.

## Supported versions

Security fixes land on `main` and are released from there. There is no long-term support
branch; run the latest release.
