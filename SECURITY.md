# Security Policy

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Use [GitHub private vulnerability reporting](https://github.com/Ecosystemlodestar/lodestar/security/advisories/new) to submit a report. If you're unsure whether something is a security issue, report it privately anyway.

Include as much detail as you can: steps to reproduce, potential impact, and any proof-of-concept code.

## Response Timeline

| Milestone | Target |
|---|---|
| Acknowledgement | 48 hours |
| Initial triage | 5 business days |
| Fix or mitigation | 30 days (critical issues prioritised) |

## Supported Versions

Only the latest commit on `main` receives security fixes. We don't backport patches to older releases.

## Scope

**In scope**

- Private key exposure or leakage
- Authentication / authorisation bypass (HMAC, admin, owner middleware)
- Payment flow manipulation (x402 / Stellar transactions)
- Smart contract vulnerabilities (registry and agents Soroban contracts)
- Injection attacks against the backend API
- Rate-limiter bypass that enables abuse

**Out of scope**

- Issues that require physical access to a machine
- Social engineering
- Denial-of-service via resource exhaustion without a clear exploit path
- Vulnerabilities in third-party dependencies (report those upstream)
- Findings from automated scanners with no demonstrated impact
