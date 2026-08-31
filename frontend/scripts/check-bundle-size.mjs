#!/usr/bin/env node
/**
 * Bundle size budget checker for Lodestar frontend.
 *
 * Reads .next/app-build-manifest.json, measures the gzip size of every JS
 * chunk referenced by each route, and fails if any route's first-load JS
 * exceeds the configured budget.
 *
 * Usage:
 *   node scripts/check-bundle-size.mjs          # uses defaults
 *   BUDGET_KB=200 node scripts/check-bundle-size.mjs
 *
 * Rationale for the 200 kB budget:
 *   - Current heaviest route (/agents/[address]) ships ~165 kB first-load JS
 *     (gzip) at the time this baseline was recorded (2026-07-29).
 *   - 200 kB gives ~21 % headroom before the check fires, which is enough to
 *     absorb minor dependency updates without constant false positives, while
 *     still catching an accidental pull of @stellar/stellar-sdk into the
 *     client bundle (~800 kB uncompressed, ~280 kB gzip).
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// ── Configuration ─────────────────────────────────────────────────────────────

const NEXT_DIR    = path.resolve('.next');
const BUDGET_KB   = Number(process.env.BUDGET_KB ?? 200);        // per-route limit
const BUDGET_BYTES = BUDGET_KB * 1024;

// ── Helpers ───────────────────────────────────────────────────────────────────

function gzipSize(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    return zlib.gzipSync(buf, { level: 9 }).length;
  } catch {
    return 0;
  }
}

function formatKB(bytes) {
  return (bytes / 1024).toFixed(1) + ' kB';
}

// ── Main ──────────────────────────────────────────────────────────────────────

const manifestPath = path.join(NEXT_DIR, 'app-build-manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(
    '✗  .next/app-build-manifest.json not found.\n' +
    '   Run `npm run build` before running this script.'
  );
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// Deduplicate chunk paths across routes so we measure each file once.
const chunkSizeCache = new Map();
function cachedGzipSize(relPath) {
  if (!chunkSizeCache.has(relPath)) {
    const absPath = path.join(NEXT_DIR, relPath);
    chunkSizeCache.set(relPath, gzipSize(absPath));
  }
  return chunkSizeCache.get(relPath);
}

// Build per-route totals (only .js files; skip .css)
const routes = [];
for (const [route, chunks] of Object.entries(manifest.pages)) {
  const jsChunks = chunks.filter(c => c.endsWith('.js'));
  const totalBytes = jsChunks.reduce((sum, c) => sum + cachedGzipSize(c), 0);
  routes.push({ route, totalBytes, jsChunks });
}

// Sort heaviest first for the report
routes.sort((a, b) => b.totalBytes - a.totalBytes);

// ── Report ────────────────────────────────────────────────────────────────────

const pad = (s, n) => s.padEnd(n);
const COL = 42;

console.log('\nBundle size report (gzip, first-load JS per route)');
console.log('─'.repeat(62));
console.log(pad('Route', COL) + pad('First-load JS', 16) + 'Status');
console.log('─'.repeat(62));

let failed = false;
const overBudget = [];

for (const { route, totalBytes } of routes) {
  const ok     = totalBytes <= BUDGET_BYTES;
  const icon   = ok ? '✓' : '✗';
  const label  = ok ? 'OK' : `OVER BUDGET (+${formatKB(totalBytes - BUDGET_BYTES)})`;
  console.log(pad(route, COL) + pad(formatKB(totalBytes), 16) + `${icon}  ${label}`);
  if (!ok) {
    failed = true;
    overBudget.push({ route, totalBytes });
  }
}

console.log('─'.repeat(62));
console.log(`Budget: ${BUDGET_KB} kB gzip per route\n`);

// ── Stellar SDK check ─────────────────────────────────────────────────────────
// Scan every chunk for the telltale identifier that @stellar/stellar-sdk
// exports if it is bundled in full.  These strings appear in the SDK's
// compiled output but not in freighter-api or stellar-wallets-kit.
const SDK_MARKERS = ['StellarBase', 'stellar-base', 'xdr.Transaction'];

const sdkChunks = [];
for (const [relPath] of chunkSizeCache) {
  const absPath = path.join(NEXT_DIR, relPath);
  try {
    const src = fs.readFileSync(absPath, 'utf8');
    const found = SDK_MARKERS.filter(m => src.includes(m));
    if (found.length > 0) {
      sdkChunks.push({ relPath, markers: found });
    }
  } catch {
    // ignore unreadable files
  }
}

if (sdkChunks.length === 0) {
  console.log('✓  @stellar/stellar-sdk is NOT present in any client chunk.');
} else {
  console.log('⚠️   @stellar/stellar-sdk markers found in client chunks:');
  for (const { relPath, markers } of sdkChunks) {
    console.log(`   ${relPath}  (${markers.join(', ')})`);
  }
  console.log(
    '\n   Investigate whether the SDK crept into a client component.\n' +
    '   Move any Keypair/TransactionBuilder logic to a Server Action or\n' +
    '   API route if you do not need it in the browser.\n'
  );
  // Treat SDK presence as a warning, not a hard failure — the SDK is a
  // declared dep and the freighter.ts keypair path intentionally uses it.
  // A future ticket can split that into a server-only module.
}

// ── Exit ──────────────────────────────────────────────────────────────────────

if (failed) {
  console.error(
    `✗  ${overBudget.length} route(s) exceed the ${BUDGET_KB} kB budget.\n` +
    '   Common causes:\n' +
    '   • @stellar/stellar-sdk pulled into a client component\n' +
    '   • A large library imported without dynamic import()\n' +
    '   • A "use client" annotation added to a file that was previously server-only\n'
  );
  process.exit(1);
}

console.log(`✓  All routes within the ${BUDGET_KB} kB budget.`);
