import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { getStellarServer } from './stellar.js';
import logger from './logger.js';

// ── Pending Transactions Registry ──────────────────────────────────────────────
//
// Tracks every submitted Soroban transaction from sendTransaction until
// getTransaction confirms it (SUCCESS or FAILED). On graceful shutdown the
// registry is dumped to pending-transactions.json so operators can manually
// verify on-chain status. On restart any still-unconfirmed hashes are
// re-polled before accepting new requests.

const pendingTransactions = new Map();
const PENDING_TRANSACTIONS_FILE = 'pending-transactions.json';

function getOperationName(operation) {
  if (typeof operation === 'string') return operation;
  try {
    if (operation && typeof operation === 'object') {
      if (operation.method) return operation.method;
      if (operation._method) return operation._method;
      if (operation.func) {
        try {
          return operation.func.invokeContract().functionName().toString();
        } catch {}
      }
    }
  } catch {}
  return 'unknown';
}

export function trackPendingTransaction(hash, operation) {
  pendingTransactions.set(hash, {
    hash,
    operation: getOperationName(operation),
    submittedAt: Date.now(),
  });
}

export function removePendingTransaction(hash) {
  pendingTransactions.delete(hash);
}

export function getPendingTransactionCount() {
  return pendingTransactions.size;
}

export function getPendingTransactions() {
  return Array.from(pendingTransactions.values());
}

/** @note Exported for tests — not part of the public API. */
export function __resetPendingTransactions() {
  pendingTransactions.clear();
}

/**
 * Dump all currently-pending transaction entries to
 * pending-transactions.json for operator inspection. Safe to call
 * multiple times — overwrites the file each time.
 */
export function dumpPendingTransactions() {
  const entries = Array.from(pendingTransactions.values());
  if (entries.length === 0) return;
  try {
    writeFileSync(PENDING_TRANSACTIONS_FILE, JSON.stringify(entries, null, 2), 'utf-8');
    logger.warn(
      { count: entries.length, file: PENDING_TRANSACTIONS_FILE },
      'Dumped pending transactions to file',
    );
  } catch (err) {
    logger.error({ err }, 'Failed to dump pending transactions');
  }
}

/**
 * On startup, check for pending-transactions.json from a previous run and
 * attempt to re-poll any unconfirmed hashes. Confirmed or failed entries
 * are logged; still-unconfirmed entries are re-added to the in-memory
 * registry so the next shutdown will preserve them again.
 */
export async function resumePendingTransactions() {
  let entries;
  try {
    if (!existsSync(PENDING_TRANSACTIONS_FILE)) return;
    const data = readFileSync(PENDING_TRANSACTIONS_FILE, 'utf-8');
    entries = JSON.parse(data);
  } catch {
    return;
  }

  if (!Array.isArray(entries) || entries.length === 0) return;

  logger.warn(
    { count: entries.length, file: PENDING_TRANSACTIONS_FILE },
    'Resuming polling for unconfirmed transactions from previous run',
  );

  const server = getStellarServer();
  for (const entry of entries) {
    try {
      const getResult = await server.getTransaction(entry.hash);
      if (getResult.status === 'SUCCESS') {
        logger.info({ hash: entry.hash, operation: entry.operation }, 'Pending transaction from previous run confirmed SUCCESS');
      } else if (getResult.status === 'FAILED') {
        logger.warn({ hash: entry.hash, operation: entry.operation }, 'Pending transaction from previous run FAILED on-chain');
      } else {
        trackPendingTransaction(entry.hash, { method: entry.operation });
        logger.warn({ hash: entry.hash, operation: entry.operation }, 'Pending transaction from previous run still unconfirmed, re-added to registry');
      }
    } catch (err) {
      logger.error({ err, hash: entry.hash, operation: entry.operation }, 'Failed to check pending transaction from previous run');
      trackPendingTransaction(entry.hash, { method: entry.operation });
    }
  }

  // Only delete the file once every entry has been processed and re-tracked.
  // If the process is killed mid-resume the file remains for the next restart.
  try {
    unlinkSync(PENDING_TRANSACTIONS_FILE);
  } catch {
    // best-effort — file may already be gone
  }

  if (pendingTransactions.size > 0) {
    logger.warn(
      { count: pendingTransactions.size },
      'Pending transactions remain after resume — will be re-dumped on next shutdown',
    );
  }
}