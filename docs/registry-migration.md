# Registry Migration Notes

## `pay_to` field type change (#293)

### What changed

`ServiceEntry.pay_to` was stored as an unvalidated `String`. It is now a Soroban `Address`, validated at registration by the host when the argument is decoded.

`register_service` accepts `pay_to: Address` instead of `pay_to: String`. The backend encodes payout targets as Stellar addresses in transaction preparation.

### Impact on already-registered services

Contracts deployed **before** this change store `pay_to` as a string in persistent storage. After upgrading the contract WASM:

- **Existing entries** retain their on-disk layout until re-registered. A contract upgrade that changes `ServiceEntry` layout requires a **storage migration** or redeploy with re-seeding — this is a breaking schema change for live deployments.
- **New registrations** after the upgrade store a typed `Address`.
- Providers with services registered under the old schema should **deactivate and re-register** (or wait for a maintainer-run migration) so agents read a valid payout address.

### Off-chain callers

- `GET /api/services` and `GET /api/services/:id` continue to expose `pay_to` as a base58 Stellar address string for x402 compatibility.
- `POST /api/registry/prepare-register` rejects invalid `payTo` values with `INVALID_BODY`.

### Accepted format

A valid Stellar public key (`G…` on testnet/mainnet) or contract address (`C…`). The default payout address comes from `PAYMENT_ADDRESS` / `SERVER_STELLAR_ADDRESS` in the backend environment when `payTo` is omitted.
