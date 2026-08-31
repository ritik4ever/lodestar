import pkg from '@stellar/stellar-sdk';
import pino from 'pino';
import config from '../config.js';
import logger, { requestContext } from './logger.js';

const { scValToNative, StrKey } = pkg;

// ── On-chain write audit trail ────────────────────────────────────────────────
//
// The backend signs Soroban transactions with a custodied key. This module
// emits exactly one structured record per signed transaction — actor, contract
// function, arguments, tx hash, result and request ID — on a stream that is
// deliberately separate from the free-form application log so it can be shipped
// to storage with its own (longer) retention.
//
// Records are JSON Lines. Query by actor:   jq 'select(.actor == "G...")'
//                          by tx hash: jq 'select(.txHash == "abc...")'
//
// Retention policy is documented in docs/audit-log.md.

// A Stellar secret seed: 'S' followed by 55 base32 chars. Any value matching
// this shape is redacted before a record is written, so a key that somehow
// reaches an argument or error string can never land in the audit trail.
const STELLAR_SECRET_RE = /\bS[A-Z2-7]{55}\b/g;

// Object keys whose values are never safe to record verbatim.
const SENSITIVE_KEY_RE = /secret|seed|passphrase|priv(ate)?[-_]?key|signer|mnemonic/i;

const REDACTED = '[REDACTED]';

function scrubSecrets(value) {
  if (typeof value === 'string') {
    return value.replace(STELLAR_SECRET_RE, REDACTED);
  }
  if (Array.isArray(value)) {
    return value.map(scrubSecrets);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY_RE.test(key) ? REDACTED : scrubSecrets(val);
    }
    return out;
  }
  return value;
}

// scValToNative can hand back BigInt (i128/u64), Buffer (bytes) and nested
// structures — none of which round-trip cleanly through JSON. Normalise them so
// every argument is a plain, serialisable value.
function toSerialisable(value) {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  if (Array.isArray(value)) return value.map(toSerialisable);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = toSerialisable(val);
    }
    return out;
  }
  return value;
}

function resolveHostFunction(operation) {
  if (!operation || typeof operation !== 'object') return null;
  // High-level Operation object (Transaction#operations): `.func` is the HostFunction.
  if (operation.func && typeof operation.func.switch === 'function') {
    return operation.func;
  }
  // Raw xdr.Operation returned by Contract#call.
  if (typeof operation.body === 'function') {
    const body = operation.body();
    if (body.switch().name === 'invokeHostFunction') {
      return body.invokeHostFunctionOp().hostFunction();
    }
  }
  return null;
}

/**
 * Pull the contract id, invoked function name and decoded arguments out of a
 * Soroban operation. Never throws — an unrecognised operation shape yields
 * `{ fn: 'unknown', contractId: null, args: [] }`.
 */
export function extractInvocation(operation) {
  try {
    const hostFn = resolveHostFunction(operation);
    if (!hostFn || hostFn.switch().name !== 'hostFunctionTypeInvokeContract') {
      return { fn: 'unknown', contractId: null, args: [] };
    }
    const invocation = hostFn.invokeContract();
    const fn = invocation.functionName().toString();
    const contractId = StrKey.encodeContract(
      invocation.contractAddress().contractId(),
    );
    const args = invocation.args().map((scVal) => {
      try {
        return toSerialisable(scValToNative(scVal));
      } catch {
        return '<unparseable>';
      }
    });
    return { fn, contractId, args };
  } catch {
    return { fn: 'unknown', contractId: null, args: [] };
  }
}

let auditPino = null;
function getAuditPino() {
  if (auditPino) return auditPino;
  const auditConfig = config.audit ?? {};
  const destination = auditConfig.file
    ? pino.destination({ dest: auditConfig.file, sync: false, mkdir: true })
    : pino.destination(1); // stdout fd — tag with { stream: 'audit' } for routing
  auditPino = pino(
    {
      level: auditConfig.level ?? 'info',
      base: { stream: 'audit' },
      timestamp: false,
    },
    destination,
  );
  return auditPino;
}

function defaultSink(record) {
  if ((config.audit ?? {}).enabled === false) return;
  getAuditPino().info(record);
}

let sink = defaultSink;

/** Test seam: replace the write sink with a spy. Pass nothing to restore. */
export function __setAuditSinkForTest(fn) {
  sink = fn ?? defaultSink;
}

/**
 * Write one audit record for a transaction signed with a custodied key.
 *
 * @param {object}  entry
 * @param {string}  entry.actor      - address the transaction was signed as / on behalf of
 * @param {string}  entry.fn         - contract function invoked
 * @param {string}  [entry.contractId]
 * @param {any[]}   [entry.args]     - decoded, secret-scrubbed invocation arguments
 * @param {string}  [entry.txHash]
 * @param {'SUCCESS'|'FAILED'|'ERROR'|'TIMEOUT'} entry.result
 * @param {string}  [entry.errorCode]
 * @param {number}  [entry.latencyMs]
 */
export function recordOnChainWrite({
  actor,
  fn,
  contractId,
  args,
  txHash,
  result,
  errorCode,
  latencyMs,
}) {
  const record = scrubSecrets({
    event: 'onchain_write',
    ts: new Date().toISOString(),
    requestId: requestContext.getStore()?.requestId ?? null,
    actor: actor ?? null,
    fn: fn ?? 'unknown',
    contractId: contractId ?? null,
    args: args ?? [],
    txHash: txHash ?? null,
    result: result ?? 'UNKNOWN',
    ...(errorCode ? { errorCode } : {}),
    ...(latencyMs != null ? { latencyMs } : {}),
  });

  try {
    sink(record);
  } catch (err) {
    // Audit logging must never break the transaction path.
    logger.warn({ err }, 'failed to emit on-chain audit record');
  }
}
