# Bundle Size Baseline

Recorded: 2026-07-29  
Next.js: 14.2.5  
Tool: `@next/bundle-analyzer` 14.2.5 + custom gzip checker

---

## First-load JS per route (gzip)

Measured after `npm run build` on the commit that introduced this file.  
All sizes are **gzip-compressed first-load JS** (the bytes a cold browser downloads).

| Route | First-load JS | Notes |
|---|---|---|
| `/agents/[address]` | **161.6 kB** | Heaviest — wallet signing + agent detail |
| `/layout` (shared) | 157.7 kB | Baseline shared by all routes |
| `/register` | 152.5 kB | Service registration — wallet + form |
| `/agents/register` | 152.2 kB | Agent registration — wallet + form |
| `/agents` | 102.0 kB | Leaderboard — SWR + agents table |
| `/demo` | 98.2 kB | Live demo page |
| `/services/[id]` | 96.0 kB | Service detail |
| `/registry` | 95.7 kB | Registry browser |
| `/` | 94.0 kB | Homepage |
| `/_not-found` | 86.0 kB | 404 page |

Budget: **200 kB gzip** per route (enforced by CI).

---

## Largest bundle contributors

The shared baseline of ~88 kB (before any page-specific JS) breaks down as:

| Chunk | Approx. gzip | Package |
|---|---|---|
| `853-…js` | ~58 kB | `@creit-tech/stellar-wallets-kit` + `@stellar/freighter-api` |
| `fd9d1056-…js` | ~47 kB | React internals (scheduler, reconciler) |
| `23-…js` | ~33 kB | Next.js runtime + app router |
| `main-app-…js` | ~4 kB | App shell, layout bootstrap |
| `webpack-…js` | ~1 kB | webpack runtime |

The `853` chunk is the biggest single contributor outside React itself.  
It contains the wallet abstraction layer (`stellar-wallets-kit`) which is
intentionally client-side — it must talk to browser wallet extensions.

The extra ~70 kB on wallet-using routes (`/agents/[address]`, `/register`,
`/agents/register`) comes from the `853` chunk, which loads lazily only when
those routes are visited.

---

## @stellar/stellar-sdk status

**`@stellar/stellar-sdk` is NOT present in any client chunk.**

The SDK is listed in `dependencies` in `package.json` and it is imported in
`lib/freighter.ts` (`Keypair`, `TransactionBuilder`). However:

1. `lib/freighter.ts` is only imported from **server-side API routes and the
   agent script**, not from any `"use client"` component.
2. Next.js App Router treats files without `"use client"` as server components
   by default, so the import is resolved at build time on the server and the
   SDK bytes are **never shipped to the browser**.
3. The automated check in `scripts/check-bundle-size.mjs` scans every client
   chunk for the SDK's telltale identifiers (`StellarBase`, `stellar-base`,
   `xdr.Transaction`) and will fail CI if any of them appear.

If `lib/freighter.ts` is ever imported from a client component, the SDK would
be pulled in, adding roughly **280 kB gzip** to every route that uses it.
The CI check will catch this before it merges.

---

## Running the checks locally

```sh
# Standard build then budget check
cd frontend
npm run build
npm run bundle:check          # exits 1 if any route > 200 kB

# Interactive visual report (generates .next/analyze/client.html)
npm run bundle:analyze        # opens a treemap in your browser
open .next/analyze/client.html
```

Override the budget for local investigation:

```sh
BUDGET_KB=150 npm run bundle:check
```

---

## Changing the budget

The default of 200 kB is set in two places:

1. `scripts/check-bundle-size.mjs` — the `BUDGET_KB` default value (line ~25).
2. This document.

Update both together and include the new baseline table when you raise the
budget so the history stays readable.

---

## Improvement opportunities

If bundle size becomes a concern, the highest-value actions are:

1. **Move `signTxWithKeypair` to a Server Action** — `lib/freighter.ts` imports
   `Keypair` and `TransactionBuilder` from `@stellar/stellar-sdk`. Moving the
   keypair signing path to a Next.js Server Action (`app/actions/sign.ts`)
   would remove the SDK import from the client entry graph entirely.

2. **Dynamic-import the wallet kit** — `@creit-tech/stellar-wallets-kit`
   (~58 kB gzip) loads on every wallet page even if the user never opens the
   wallet picker. Wrapping it in `dynamic(() => import(...), { ssr: false })`
   would defer it until first interaction.

3. **Route-level code splitting** — the `/agents/[address]` page bundles the
   full signing flow even for read-only visitors. Splitting the signing UI into
   a lazily-loaded component would shed ~15 kB from the initial paint.
