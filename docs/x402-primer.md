# x402 primer

x402 is a lightweight payment protocol for HTTP APIs. A client makes a normal request, receives a `402 Payment Required` response, and then proves it has paid by sending a signed payment transaction back in the request headers. The service can then retry the original request and return the protected content.

For newcomers, the easiest way to think about it is:

- the client asks for a resource;
- the server says “this costs money”;
- the client proves payment with a Stellar transaction;
- the server completes the request.

## How the 402 flow works

A concrete trace looks like this:

1. An agent calls a protected endpoint such as `GET /demo/weather`.
2. The service responds with `402 Payment Required` and a `PAYMENT-REQUIRED` response header that carries the payment challenge.
3. The agent uses a facilitator to build a signed payment transaction for the required amount and recipient.
4. The agent retries the same request with the payment proof in a `PAYMENT-SIGNATURE` request header.
5. The service validates the payment, settles it on-chain, and returns the data.

In short, the request/response pattern is:

```text
Client -> GET /demo/weather
Server -> 402 Payment Required + PAYMENT-REQUIRED challenge header
Client -> GET /demo/weather with PAYMENT-SIGNATURE header
Server -> 200 OK + PAYMENT-RESPONSE receipt + protected response
```

## What the facilitator does

The facilitator is the payment broker that helps the client complete the challenge. It does not replace the service provider, and it does not hold the funds permanently. Instead, it helps construct and, in many cases, submit the payment transaction so the client can satisfy the server's payment requirement.

In this project, the backend exposes a facilitator URL and uses it during the demo payment flow. That keeps the client-side logic simple: the agent asks for a payment challenge, the facilitator prepares the payment proof, and the service validates it.

## Where Stellar fits

The payment proof is a Stellar transaction. The service provider can choose where the funds should go, and the wire-up for the payment is encoded in the transaction details. Once the transaction is accepted on the network, the server can treat the payment as complete and serve the protected resource.

That is why x402 is a good fit for this project: it lets an agent pay for a resource over standard HTTP while using Stellar as the settlement layer.

## Why this matters in Lodestar

Lodestar uses x402 as the payment layer for discoverable services. A service provider publishes an endpoint and a price. An agent discovers that endpoint, hits it, satisfies the payment challenge, and receives the data. The result is a simple path from discovery to payment without hardcoded service URLs.

## A complete payment cycle, end to end

Everything below is the real wire format for the demo weather endpoint, `GET /demo/weather`, running on `http://localhost:3001` with the default `$0.001` price. The cycle is identical for `GET /demo/search`. Two things to know before reading the trace:

- x402 v2 encodes the challenge and the payment proof as **base64-encoded JSON in HTTP headers** (v1 used the response body instead). Every header value below decodes to the JSON shown next to it.
- HTTP header names are case-insensitive; the protocol writes them in upper case.

### Step 1 — the probe

The agent simply asks for the resource:

```http
GET /demo/weather?lat=40.7128&lon=-74.0060 HTTP/1.1
Host: localhost:3001
Accept: application/json
```

### Step 2 — the 402 challenge

The service does not serve the data yet. Instead it answers `402 Payment Required` and tells the agent exactly how to pay:

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json
PAYMENT-REQUIRED: eyJ4NDAyVmVyc2lvbiI6MiwiZXJyb3IiOm51bGwsInJlc291cmNlIjp7InVybCI6Imh0dHA6Ly9sb2NhbGhvc3Q6MzAwMS9kZW1vL3dlYXRoZXI/bGF0PTQwLjcxMjgmbG9uPS03NC4wMDYwIiwiZGVzY3JpcHRpb24iOiJSZWFsLXRpbWUgd2VhdGhlciBkYXRhIHZpYSBMb2Rlc3RhciJ9LCJhY2NlcHRzIjpbeyJzY2hlbWUiOiJleGFjdCIsIm5ldHdvcmsiOiJzdGVsbGFyOnRlc3RuZXQiLCJhbW91bnQiOiIxMDAwMCIsImFzc2V0IjoiQ0JJRUxUSzZZQlpKVTVVUDJXV1FFVUNZS0xQVTZBVU5aMkJRNFdXRkVJRTNVU0NJSE1YUURBTUEiLCJwYXlUbyI6IkdVSlpERUdYRE5DRjMyRVBGM0RIT0RaRE9DSVMySkhUTEdNWEdFRE43M1U1NVhUUExQRlQ3VjRTIiwibWF4VGltZW91dFNlY29uZHMiOjMwMCwiZXh0cmEiOnsiYXJlRmVlc1Nwb25zb3JlZCI6dHJ1ZX19XX0=
```

The `PAYMENT-REQUIRED` header is the challenge. Base64-decoded, it is:

```json
{
  "x402Version": 2,
  "error": null,
  "resource": {
    "url": "http://localhost:3001/demo/weather?lat=40.7128&lon=-74.0060",
    "description": "Real-time weather data via Lodestar"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "stellar:testnet",
      "amount": "10000",
      "asset": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      "payTo": "GUJZDEGXDNCF32EPF3DHODZDOCIS2JHTLGMXGEDN73U55XTPLPFT7V4S",
      "maxTimeoutSeconds": 300,
      "extra": {
        "areFeesSponsored": true
      }
    }
  ]
}
```

Annotated field by field:

- `x402Version` — the protocol version. `2` means the challenge travels in the `PAYMENT-REQUIRED` header and the proof in `PAYMENT-SIGNATURE`. (Version `1` put both in the request/response body and used an `X-PAYMENT` header.)
- `resource` — the resource being paid for. `url` echoes the request URL the caller hit; `description` is the human-readable label the provider configured.
- `accepts` — the list of payment options the provider will accept. The demo endpoints expose exactly one, so the choice is forced:
  - `scheme` — `exact` means the payment must be an exact amount (no bazaar-style negotiation).
  - `network` — the settlement network in CAIP-2 form, `stellar:testnet` for the Stellar testnet.
  - `amount` — the price in the asset's smallest unit. `10000` is **stroops**: 10 000 / 10⁷ = `$0.001` USDC (Stellar's USDC has 7 decimals).
  - `asset` — the USDC token contract address on testnet (`CBIELT…QDAMA`).
  - `payTo` — where the funds must go. This is the provider's configured recipient (`PAYMENT_ADDRESS` or `SERVER_STELLAR_ADDRESS` in the backend config); the value above is a placeholder for your deployment.
  - `maxTimeoutSeconds` — how long the facilitator has to settle the payment (default 300 s / 5 min).
  - `extra.areFeesSponsored` — the facilitator covers the transaction fee; the `exact` scheme requires this to be `true`.

### Step 3 — building the payment

The agent (or a facilitator acting on its behalf) reads the challenge, picks the accepted requirement, and signs a Stellar USDC transfer of `10000` stroops from its own address to `payTo`. The result is a payment payload:

```json
{
  "x402Version": 2,
  "resource": {
    "url": "http://localhost:3001/demo/weather?lat=40.7128&lon=-74.0060",
    "description": "Real-time weather data via Lodestar"
  },
  "accepted": {
    "scheme": "exact",
    "network": "stellar:testnet",
    "amount": "10000",
    "asset": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    "payTo": "GUJZDEGXDNCF32EPF3DHODZDOCIS2JHTLGMXGEDN73U55XTPLPFT7V4S",
    "maxTimeoutSeconds": 300,
    "extra": {
      "areFeesSponsored": true
    }
  },
  "payload": {
    "transaction": "AAAAAgAAAABkZW1vLXNpZ25lci1zZWNyZXQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAEAAAAAZGVtby1zaWduZXItc2VjcmV0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAA"
  },
  "extensions": {}
}
```

Annotated field by field:

- `x402Version` — mirrors the challenge's version.
- `resource` — copied verbatim from the challenge so the server can confirm the proof matches the resource that was requested.
- `accepted` — the exact `accepts` entry the agent chose; the server verifies the payment against this.
- `payload.transaction` — the signed Stellar transaction as base64 XDR. Concretely it is a `transfer` invoke against the USDC token contract, from the payer to `payTo`, for `amount` stroops. (This is a truncated placeholder — a real envelope is several hundred bytes.)
- `extensions` — protocol extensions in play; empty in the demo.

### Step 4 — the retry

The agent replays the **exact same request**, this time carrying the payment proof:

```http
GET /demo/weather?lat=40.7128&lon=-74.0060 HTTP/1.1
Host: localhost:3001
Accept: application/json
PAYMENT-SIGNATURE: eyJ4NDAyVmVyc2lvbiI6MiwicmVzb3VyY2UiOnsidXJsIjoiaHR0cDovL2xvY2FsaG9zdDozMDAxL2RlbW8vd2VhdGhlcj9sYXQ9NDAuNzEyOCZsb249LTc0LjAwNjAiLCJkZXNjcmlwdGlvbiI6IlJlYWwtdGltZSB3ZWF0aGVyIGRhdGEgdmlhIExvZGVzdGFyIn0sImFjY2VwdGVkIjp7InNjaGVtZSI6ImV4YWN0IiwibmV0d29yayI6InN0ZWxsYXI6dGVzdG5ldCIsImFtb3VudCI6IjEwMDAwIiwiYXNzZXQiOiJDQklFTFRLNllCWkpVNVVQMldXUUVVQ1lLTFBVNkFVTloyQlE0V1dGRUlFM1VTQ0lITVhRREFNQSIsInBheVRvIjoiR1VKWkRFR1hETkNGMzJFUEYzREhPRFpET0NJUzJKSFRMR01YR0VETjczVTU1WFRQTFBGVDdWNFMiLCJtYXhUaW1lb3V0U2Vjb25kcyI6MzAwLCJleHRyYSI6eyJhcmVGZWVzU3BvbnNvcmVkIjp0cnVlfX0sInBheWxvYWQiOnsidHJhbnNhY3Rpb24iOiJBQUFBQWdBQUFBQmtaVzF2TFhOcFoyNWxjaTF6WldOeVpYUUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQVFBQUFBRUFBQUFBWkdWdGJ5MXphV2R1WlhJdGMyVmpjbVYwQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBRUFBQUFBIn0sImV4dGVuc2lvbnMiOnt9fQ==
```

The `PAYMENT-SIGNATURE` header is the payment payload from Step 3, base64-encoded — exactly the JSON shown above. The server:

1. decodes and validates the signature against the challenge it issued;
2. hands the transaction to the facilitator, which submits it to Stellar testnet and waits for confirmation;
3. only then runs the actual route handler and returns the data.

### Step 5 — the paid response

```http
HTTP/1.1 200 OK
Content-Type: application/json
PAYMENT-RESPONSE: eyJzdWNjZXNzIjp0cnVlLCJuZXR3b3JrIjoic3RlbGxhcjp0ZXN0bmV0IiwidHJhbnNhY3Rpb24iOiJjOWY2ZjRlN2ExYjJjM2Q0ZTVmNmE3YjhjOWQwZTFmMmEzYjRjNWQ2ZTdmOGE5YjBjMWQyZTNmNGE1YjZjN2Q4IiwicGF5ZXIiOiJHVUpaREVHWEROQ0YzMkVQRjNESE9EWkRPQ0lTMkpIVExHTVhHRURONzNVNTVYVFBMUEZUN1Y0UyJ9

{
  "latitude": 40.7128,
  "longitude": -74.006,
  "temperature_c": 21.3,
  "wind_speed_kmh": 11.2,
  "weather_code": 0,
  "time": "2026-08-29T12:00"
}
```

The `PAYMENT-RESPONSE` header is the settlement receipt. Base64-decoded:

```json
{
  "success": true,
  "network": "stellar:testnet",
  "transaction": "c9f6f4e7a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8",
  "payer": "GUJZDEGXDNCF32EPF3DHODZDOCIS2JHTLGMXGEDN73U55XTPLPFT7V4S"
}
```

- `success` — whether the payment settled.
- `network` — the network the transaction was submitted to.
- `transaction` — the on-chain transaction hash, the proof of payment you can look up on a Stellar testnet explorer.
- `payer` — the Stellar address that paid.

The demo endpoints also echo an `x-payment-transaction` response header with the same transaction hash when the caller supplied one, which is how the in-repo demo client learns the hash without parsing the receipt.

## Reproducing the cycle with curl

The first half of the cycle is trivially reproducible with `curl`. Start the backend (`npm run dev` in `backend/`), then:

```bash
# 1. Probe the protected endpoint and see the 402 + PAYMENT-REQUIRED challenge
curl -i 'http://localhost:3001/demo/weather?lat=40.7128&lon=-74.0060'
```

```bash
# 2. Extract the challenge header and decode it (jq optional, base64 -d is enough)
CHALLENGE=$(curl -s -D - -o /dev/null \
  'http://localhost:3001/demo/weather?lat=40.7128&lon=-74.0060' \
  | awk -F': ' 'tolower($1)=="payment-required" {gsub(/\r/, "", $2); print $2}')

echo "$CHALLENGE" | base64 -d | jq .
```

You should see the decoded challenge from Step 2: the resource, the `$0.001` price as `"amount": "10000"`, the testnet USDC asset, and the `payTo` recipient.

```bash
# 3. Replay with the payment proof
# The PAYMENT-SIGNATURE value is the Step 3 payload base64-encoded, and it can
# only be produced by a client that actually signs the Stellar transfer. Rather
# than hand-crafting it, use the repo's demo client, which performs the whole
# probe -> sign -> retry cycle for you:
curl -i -X POST http://localhost:3001/api/demo-run \
  -H 'Content-Type: application/json' \
  -d '{"serviceId": 1, "category": "weather"}'
```

`POST /api/demo-run` runs the full x402 cycle against the registered weather service and returns `{ "data", "txHash", "dataValid" }`. To see the raw wire format instead, watch the agent: `npm start` in `agent/` logs every step of the probe, challenge, payment, and settlement.

## References

- Upstream x402 specification: https://github.com/coinbase/x402
- Stellar documentation: https://developers.stellar.org/
