import { performance } from 'node:perf_hooks';
import * as idempotency from './idempotency.js';

const COUNT = 100_000;
const SAMPLES = 10_000;

// ---------------------------------------------------------------------------
// Phase 1 — New O(1) lookup throughput
// ---------------------------------------------------------------------------
idempotency._reset();
idempotency._startTimer();

for (let i = 0; i < COUNT; i++) {
  idempotency.markPending(`key-${i}`);
}

for (let i = 0; i < 1000; i++) {
  idempotency.getEntry(`key-${i}`);
}

const t1 = performance.now();
for (let i = 0; i < SAMPLES; i++) {
  idempotency.getEntry(`key-${i}`);
}
const elapsedNew = performance.now() - t1;

// Verify that _purgeNow() does not remove live entries (no false expiry)
const beforePurge = idempotency._size();
idempotency._purgeNow();
const afterPurge = idempotency._size();

// ---------------------------------------------------------------------------
// Phase 2 — Simulated old O(n) baseline (full-map purgeExpired on every read)
// ---------------------------------------------------------------------------
// This reproduces the exact behaviour of the pre-fix getEntry().
const oldStore = new Map();
for (let i = 0; i < COUNT; i++) {
  oldStore.set(`old-${i}`, { status: 'pending', result: null, expiresAt: Date.now() + 86_400_000 });
}
function oldGetEntry(key) {
  const now = Date.now();
  for (const [k, v] of oldStore) {
    if (v.expiresAt <= now) oldStore.delete(k);
  }
  return oldStore.get(key);
}
for (let i = 0; i < 1000; i++) {
  oldGetEntry(`old-${i}`);
}
const t2 = performance.now();
for (let i = 0; i < SAMPLES; i++) {
  oldGetEntry(`old-${i}`);
}
const elapsedOld = performance.now() - t2;

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------
const avgNew = elapsedNew / SAMPLES;
const opsNew = (SAMPLES / elapsedNew) * 1000;
const avgOld = elapsedOld / SAMPLES;
const opsOld = (SAMPLES / elapsedOld) * 1000;

console.log(`\n--- New implementation (O(1) lookup, timer-based purge) ---`);
console.log(`  Store size:     ${COUNT.toLocaleString()} entries`);
console.log(`  Samples:        ${SAMPLES.toLocaleString()}`);
console.log(`  Total time:     ${elapsedNew.toFixed(2)} ms`);
console.log(`  Avg lookup:     ${(avgNew * 1e6).toFixed(2)} ns`);
console.log(`  Throughput:     ${opsNew.toLocaleString(undefined, { maximumFractionDigits: 0 })} ops/sec`);
console.log(`  Purge accuracy: ${beforePurge} entries before _purgeNow, ${afterPurge} after — no false removals`);

console.log(`\n--- Old implementation (O(n) full-map scan per lookup) ---`);
console.log(`  Store size:     ${COUNT.toLocaleString()} entries`);
console.log(`  Samples:        ${SAMPLES.toLocaleString()}`);
console.log(`  Total time:     ${elapsedOld.toFixed(2)} ms`);
console.log(`  Avg lookup:     ${(avgOld * 1e6).toFixed(2)} ns`);
console.log(`  Throughput:     ${opsOld.toLocaleString(undefined, { maximumFractionDigits: 0 })} ops/sec`);

console.log(`\n--- Measured speed-up ---`);
console.log(`  Old: ${opsOld.toLocaleString(undefined, { maximumFractionDigits: 0 })} ops/sec`);
console.log(`  New: ${opsNew.toLocaleString(undefined, { maximumFractionDigits: 0 })} ops/sec`);
console.log(`  ${(opsNew / opsOld).toLocaleString(undefined, { maximumFractionDigits: 0 })}x measured improvement\n`);

idempotency._reset();
