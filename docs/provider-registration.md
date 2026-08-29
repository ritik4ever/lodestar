# Provider Registration

This document describes the on-chain rules for registering a service on the Lodestar registry and how to develop locally against them.

## Endpoint URL requirements

The registry **requires every endpoint to begin with `https://`**. Registration rejects:

- `http://` URLs (payment headers would travel in plaintext)
- Non-URL strings (e.g. `not-a-url`, bare hostnames)
- Empty or whitespace-only values (caught by length checks)

The check is enforced in three places:

1. **On-chain** — `register_service` in the LodestarRegistry contract
2. **Backend** — `POST /api/registry/prepare-register`
3. **Frontend** — the Register form client-side validation

Providers should publish a publicly reachable HTTPS URL that agents can call for x402-protected data.

## Local development

The contract does **not** allow `http://localhost` even on testnet. Plain HTTP would expose x402 payment headers on the wire, so local-only URLs are rejected at registration.

For local development, use one of these approaches instead:

1. **HTTPS tunnel** — expose your local server with [ngrok](https://ngrok.com/), [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/), or similar, then register the `https://` tunnel URL.
2. **Deployed demo backend** — point agents at the hosted demo endpoints (`docker compose up` stack or the Render deployment) without registering a new service.
3. **Off-chain testing** — exercise your x402 handler directly against `http://localhost` in unit/integration tests; only the **registered** URL must be HTTPS.

Do not register `http://localhost` and expect agents to rewrite it — agents use the endpoint stored on-chain verbatim.

## Other field limits

See [Registration Field Limits](../contract/DEPLOY.md#registration-field-limits) in `contract/DEPLOY.md` for name, description, and category bounds.
