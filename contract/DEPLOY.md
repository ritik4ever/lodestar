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

## 8. Deploy agent contract

```sh
cd contract/agents
stellar contract build
stellar contract deploy \
  --wasm target/wasm32v1-none/release/lodestar_agents.wasm \
  --source deployer \
  --network testnet
```

Copy the printed contract ID.

## 9. Add agent contract ID to env files

```sh
# backend/.env
AGENTS_CONTRACT_ID=<paste agent contract id here>

# frontend/.env.local
NEXT_PUBLIC_AGENT_CONTRACT_ID=<paste agent contract id here>
```

## 10. (Optional) Set demo agent secrets

Generate three funded testnet keypairs for richer seed data:

```sh
stellar keys generate new-agent --network testnet
stellar keys fund new-agent --network testnet
stellar keys generate established-agent --network testnet
stellar keys fund established-agent --network testnet
stellar keys generate trusted-agent --network testnet
stellar keys fund trusted-agent --network testnet
```

Add their secrets to `backend/.env`:

```sh
DEMO_AGENT_1_SECRET=<new-agent secret>
DEMO_AGENT_2_SECRET=<established-agent secret>
DEMO_AGENT_3_SECRET=<trusted-agent secret>
```

If omitted, the seed script generates ephemeral random keypairs.

## 11. Run agent seed script

```sh
cd backend && npm run seed-agents
```

This registers three demo agents (NewAgent ~110, EstablishedAgent ~600, TrustedAgent ~1000) and builds their payment histories on-chain.

## Network Details

- Network: Stellar Testnet
- RPC URL: https://soroban-testnet.stellar.org
- Network Passphrase: `Test SDF Network ; September 2015`
- Explorer: https://stellar.expert/explorer/testnet
