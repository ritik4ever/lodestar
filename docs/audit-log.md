# On-chain write audit log

The backend signs Soroban transactions with a custodied key (`SERVER_STELLAR_SECRET`),
both for server-initiated writes (reputation votes, seeding, payment recording) and
when it co-signs wallet-signed registry/agent transactions. This document describes
the dedicated audit trail that records **what the server signed, for whom, and why**,
so an incident can be reconstructed without grepping unstructured application logs.

## What is recorded

Every transaction signed with the custodied key produces **exactly one** audit
record, emitted after the outcome is known. Records are JSON Lines, one object per
line:

| Field       | Description |
|-------------|-------------|
| `event`     | Always `"onchain_write"` — the marker to filter on. |
| `stream`    | Always `"audit"` — set on every line so a log router can split this stream out when records go to stdout. |
| `ts`        | ISO-8601 timestamp of when the record was written. |
| `requestId` | Correlation ID of the HTTP request that triggered the write (from `X-Request-Id`), or `null` for background/seed writes. |
| `actor`     | The address the transaction was signed as. For co-signed wallet transactions this is the transaction source; the party the call acts for is in `args`. |
| `fn`        | Contract function invoked, e.g. `update_reputation`, `register_service`, `record_payment`. |
| `contractId`| Contract the function was invoked on. |
| `args`      | Decoded invocation arguments (Soroban `ScVal` → native), secret-scrubbed. `i128`/`u64` values are stringified. |
| `txHash`    | Transaction hash. `null` only if signing produced no hash (e.g. the RPC rejected the submission outright). |
| `result`    | `SUCCESS`, `FAILED` (rejected on-chain), `ERROR` (rejected at submission / network failure), or `TIMEOUT` (not confirmed within the polling window). |
| `errorCode` | Present when `result` is not `SUCCESS` — e.g. `txBadSeq`, `submit_failed`, `TRANSACTION_TIMEOUT`. |
| `latencyMs` | Milliseconds from signing to the record being written. |

### Example

```json
{"stream":"audit","level":30,"event":"onchain_write","ts":"2026-08-28T10:15:04.812Z","requestId":"1f6c…","actor":"GB…","fn":"update_reputation","contractId":"CA…","args":["12",true,"GA…"],"txHash":"9c1a…","result":"SUCCESS","latencyMs":6231}
```

## Querying

Records are plain JSON Lines, so `jq` is enough:

```sh
# Everything a given actor signed
jq 'select(.actor == "GB...")' audit-onchain.jsonl

# Look up a specific transaction
jq 'select(.txHash == "9c1a...")' audit-onchain.jsonl

# All failed / errored writes in the file
jq 'select(.result != "SUCCESS")' audit-onchain.jsonl
```

When the records are shipped to a log store (Loki, CloudWatch, Datadog, …) filter
on `event="onchain_write"` and index `actor` and `txHash`.

## Secrets

Audit records never contain secrets:

- Only the **decoded contract arguments** are recorded — the signing keypair is
  never passed to the audit layer.
- Before a record is written every string value is run through a Stellar
  secret-seed pattern (`S` + 55 base32 chars) and redacted to `[REDACTED]`, and
  any object key matching `secret|seed|passphrase|private_key|signer|mnemonic`
  is dropped. This is defence-in-depth for the case where a caller accidentally
  passes a secret as a contract argument.

## Separate stream & retention

The audit trail is written by its own `pino` logger, independent of the
application logger, so it can be routed and retained separately:

- **Destination** — controlled by `AUDIT_LOG_FILE` (default `audit-onchain.jsonl`
  in the backend working directory). Set it to an empty value to emit to stdout
  instead; every line carries `"stream":"audit"` so a collector can route it to a
  dedicated sink.
- **Toggle** — `AUDIT_LOG_ENABLED=false` disables emission (not recommended in
  production).
- **Level** — `AUDIT_LOG_LEVEL` (default `info`).

### Retention policy

| Environment | Store | Minimum retention |
|-------------|-------|-------------------|
| Production  | Append-only log store or object storage, separate from application logs, write-once where available | **400 days** (covers a full audit cycle plus incident-investigation lead time) |
| Staging     | Same pipeline as production | 90 days |
| Local / dev | `audit-onchain.jsonl` on disk | not rotated; developer housekeeping |

Rationale for 400 days: it exceeds the longest expected gap between a signing
incident and its discovery (annual review / external audit) with margin, while
staying short enough that the volume — one line per on-chain write — remains
cheap to store. The file destination is intended for local use and container
stdout capture; production deployments should ship the stream to a store that
enforces the retention above and restricts deletion.
