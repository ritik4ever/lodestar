# Service Updates

Providers can update mutable fields on an active service they own via the on-chain `update_service` function.

## Mutable fields

| Field | Updatable | Notes |
|-------|-----------|-------|
| `price_usdc` | Yes | Minimum 0.0001 USDC enforced off-chain |
| `description` | Yes | 10–256 characters |
| `pay_to` | Yes | Payout address for x402 settlements |
| `reputation` | No | Changed only through agent votes |
| `endpoint` | **No** | See below |
| `name` | No | Fixed at registration |
| `category` | No | Fixed at registration |

## Endpoint policy

**Endpoint URLs cannot be updated in place.** Agents discover services by `(provider, endpoint)` and send x402 payments to the registered URL. Allowing silent endpoint rotation would let a provider redirect traffic (and payments) without going through reputation reset.

To change an endpoint:

1. Deactivate the existing service (preserves history but hides it from discovery).
2. Register a new service with the new HTTPS URL (starts with zero reputation).

## API flow

Wallet-signed update (same pattern as registration):

1. `POST /api/registry/prepare-update` — body: `{ id, providerAddress, description, priceUsdc, payTo? }`
2. Provider signs the returned XDR with their wallet.
3. `POST /api/registry/submit-signed-tx` — submit `{ signedXdr, submitToken }`

## On-chain event

Successful updates emit a `service_updated` event with topics `(service_updated, id)` and data `provider`.
