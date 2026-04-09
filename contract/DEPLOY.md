# Lodestar Registry — Contract Deployment

## Prerequisites

- Rust toolchain (stable)
- Stellar CLI

## 1. Install Stellar CLI

```sh
curl -fsSL https://raw.githubusercontent.com/stellar/stellar-cli/main/install.sh | sh
```

Or via cargo (slower but also works):
```sh
cargo install --locked stellar-cli
```

## 2. Install Rust WASM target

```sh
rustup target add wasm32-unknown-unknown
```

## 3. Generate and fund deployer key

```sh
stellar keys generate deployer --network testnet
stellar keys fund deployer --network testnet
```

## 4. Build contract

```sh
cd contract
stellar contract build
```

The compiled WASM will be at:
`target/wasm32-unknown-unknown/release/lodestar_registry.wasm`

## 5. Deploy to testnet

```sh
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/lodestar_registry.wasm \
  --source deployer \
  --network testnet
```

Copy the contract ID printed to stdout.

## 6. Configure environment

Copy the contract ID into your `.env` files:

```sh
# backend/.env
CONTRACT_ID=<paste contract id here>

# frontend/.env.local
NEXT_PUBLIC_CONTRACT_ID=<paste contract id here>
```

## 7. Run seed script

```sh
cd backend
npm install
node scripts/seed.js
```

This pre-populates the registry with demo services.

## Network Details

- Network: Stellar Testnet
- RPC URL: https://soroban-testnet.stellar.org
- Network Passphrase: `Test SDF Network ; September 2015`
- Explorer: https://stellar.expert/explorer/testnet
