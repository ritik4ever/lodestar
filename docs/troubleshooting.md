# Troubleshooting Guide

This guide covers common issues you may encounter while setting up or running Lodestar.

> **Still stuck?** Open a [GitHub Discussion](https://github.com/Stellar-Ecosystem/lodestar/discussions) or reach out on the project's Discord.

---

## Table of Contents

1. [Wrong WASM target](#1-wrong-wasm-target)
2. [Missing Stellar CLI](#2-missing-stellar-cli)
3. [Freighter on the wrong network](#3-freighter-on-the-wrong-network)
4. [Freighter not detected or unresponsive](#4-freighter-not-detected-or-unresponsive)
5. [RPC rate limits](#5-rpc-rate-limits)
6. [Insufficient testnet balance](#6-insufficient-testnet-balance)
7. [AGENTS_NOT_CONFIGURED 503 error](#7-agents_not_configured-503-error)
8. [Contract build fails](#8-contract-build-fails)
9. [Node.js version mismatch](#9-nodejs-version-mismatch)
10. [Missing or incorrect environment files](#10-missing-or-incorrect-environment-files)
11. [npm install or dependency errors](#11-npm-install-or-dependency-errors)
12. [Cargo test fails with no such command](#12-cargo-test-fails-with-no-such-command)

---

## 1. Wrong WASM target

**Symptom:** `cargo build` or `stellar contract build` fails with errors about `wasm32-unknown-unknown` not being found.

**Cause:** The Rust WASM target required to compile Soroban contracts is not installed.

**Fix:**

```bash
rustup target add wasm32-unknown-unknown
```

Verify the target is installed:

```bash
rustup target list --installed | grep wasm32
# Expected output: wasm32-unknown-unknown
```

If the error persists after installing, ensure you are using a **stable** Rust toolchain (not nightly):

```bash
rustup default stable
```

---

## 2. Missing Stellar CLI

**Symptom:** Running `stellar contract build` or any `stellar` command returns `command not found: stellar`.

**Cause:** The Stellar CLI is not installed on your system.

**Fix:**

Install via Cargo:

```bash
cargo install --locked stellar-cli --features opt
```

> **Note:** This compilation can take 5–15 minutes depending on your machine.

Verify the installation:

```bash
stellar --version
```

Ensure `~/.cargo/bin` is in your `PATH`. Add it if missing:

```bash
export PATH="$HOME/.cargo/bin:$PATH"
```

---

## 3. Freighter on the wrong network

**Symptom:** Transaction submission fails with network-related errors. The Freighter extension shows the wrong network indicator.

**Cause:** Freighter is connected to Stellar **Mainnet** or **Futurenet** instead of **Testnet**. Lodestar's smart contracts are deployed on Testnet, and all x402 payments must be made on the same network.

**Fix:**

1. Open the Freighter browser extension
2. Click the network dropdown in the top-left
3. Select **Testnet**
4. Confirm the network indicator changes color

If you still see errors, check the network passphrase matches:

| Network | Passphrase |
|---------|-----------|
| Testnet | `Test SDF Network ; September 2015` |
| Mainnet | `Public Global Stellar Network ; September 2015` |

---

## 4. Freighter not detected or unresponsive

**Symptom:** The frontend displays "Freighter not detected" or `window.freighter` is `undefined`. Clicking "Connect Wallet" does nothing.

**Cause:** The Freighter extension is not installed, is disabled, or the page needs to be reloaded after installation.

**Fix:**

1. Install [Freighter](https://freighter.app/) from the Chrome Web Store
2. Create or import a wallet and fund it with Testnet Lumens (see [issue 6](#6-insufficient-testnet-balance))
3. **Reload** the Lodestar page (a simple refresh is required after installing)
4. If it still fails, check browser console (`F12` → Console) for errors

**Browser compatibility:** Freighter supports Chrome, Brave, Edge, and Firefox. Safari support is limited.

---

## 5. RPC rate limits

**Symptom:** The backend or agent throws `HTTP 429 Too Many Requests` or errors containing "rate limit exceeded" when calling Stellar RPC endpoints.

**Cause:** The free Stellar Testnet RPC endpoint has a request quota. Rapid contract deployments, repeated transaction submissions, or running multiple agents concurrently can exhaust it.

**Fix:**

| Strategy | How |
|----------|-----|
| **Wait and retry** | Rate limits reset after 1 minute. Wait and try again. |
| **Use your own RPC** | Set `RPC_URL` in your `.env` to a dedicated RPC endpoint like [Nodestellar](https://nodestellar.xyz/) or a self-hosted QuickNode endpoint. |
| **Throttle requests** | Add `await new Promise(r => setTimeout(r, 1000))` delays between consecutive contract calls. |
| **Check usage** | Monitor your RPC usage through the provider dashboard if using a paid tier. |

---

## 6. Insufficient testnet balance

**Symptom:** Transaction submission fails with `op_underfunded` or `insufficient balance` errors. The agent cannot pay for services.

**Cause:** Your Stellar Testnet account has 0 XLM or 0 USDC balance.

**Fix:**

### Get Testnet XLM

Use the Stellar Lab Friendbot (max once per public key):

```bash
curl "https://friendbot.stellar.org?addr=YOUR_PUBLIC_KEY"
```

Or use the [Laboratory Friendbot](https://laboratory.stellar.org/#account-creator?network=test).

### Get Testnet USDC

1. Go to the [Stellar Testnet Token Faucet](https://testnet-assets.stellar.org/)
2. Enter your public key
3. Request USDC

Alternatively, navigate to the Lodestar frontend's **Faucet** page (if available) to request both XLM and USDC in one step.

> **Note:** Friendbot gives 10,000 XLM once per account. If you've already claimed and used it, create a new testnet account.

---

## 7. AGENTS_NOT_CONFIGURED 503 error

**Symptom:** Calling an agent-related endpoint returns `HTTP 503` with `AGENTS_NOT_CONFIGURED` in the response body.

**Cause:** The backend's Agents service was not initialized because `AGENT_SECRET_KEY` is missing from `backend/.env`.

**Fix:**

1. Open `backend/.env`
2. Ensure the following variable is set:

```env
AGENT_SECRET_KEY=your_agent_secret_key_here
```

3. If you do not have a secret key, generate one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

4. Restart the backend server

---

## 8. Contract build fails

**Symptom:** Running `stellar contract build` inside `contract/` or `contract/agents/` produces a compilation error with no clear Rust-level fix.

**Cause:** Common causes include:

- Outdated Rust toolchain
- Missing WASM target (see [issue 1](#1-wrong-wasm-target))
- Corrupted `Cargo.lock`
- Incompatible `soroban-sdk` version

**Fix:**

```bash
# 1. Update Rust
rustup update stable

# 2. Ensure WASM target is installed
rustup target add wasm32-unknown-unknown

# 3. Clean and rebuild
cd contract
cargo clean
stellar contract build

# 4. If still failing, delete Cargo.lock and retry
rm Cargo.lock
cargo generate-lockfile
stellar contract build
```

If the build still fails, check the `soroban-sdk` version in `contract/Cargo.toml` matches the version expected by your Stellar CLI:

```bash
stellar --version
# then check https://github.com/stellar/stellar-cli/releases
```

---

## 9. Node.js version mismatch

**Symptom:** `npm install` fails with engine errors, or the backend/frontend fails to start with cryptic syntax errors.

**Cause:** Lodestar requires **Node.js v22 or higher**. An older version (v18, v20, etc.) will not work.

**Fix:**

Check your current Node version:

```bash
node --version
# Expected: v22.x.x
```

Install or upgrade:

| Method | Command |
|--------|---------|
| **nvm** (recommended) | `nvm install 22 && nvm use 22` |
| **fnm** | `fnm install 22 && fnm use 22` |
| **Direct download** | [nodejs.org](https://nodejs.org/) → v22.x |

---

## 10. Missing or incorrect environment files

**Symptom:** The backend starts but returns cryptic 500 errors. The frontend cannot connect to the backend. x402 payment flows fail.

**Cause:** Lodestar uses **four** `.env` files. Any missing or incorrectly configured variable can break the system.

**Fix:**

Ensure all four `.env` files exist with the correct values:

### `backend/.env`

```env
PORT=3001
DATABASE_URL=postgresql://...
RPC_URL=https://soroban-testnet
