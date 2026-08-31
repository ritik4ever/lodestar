# Lodestar demo: brings up the full stack in one command.
#
# Usage:
#   make demo
#
# Prerequisites: Docker (with Compose v2), Node.js >= 22, and curl.
# Environment variables can be overridden on the command line, e.g.:
#   make demo AGENT_STELLAR_SECRET=S... LODESTAR_HMAC_SECRET=...

# ---------------------------------------------------------------------------
# Defaults — override on the command line or by exporting env vars before
# running make. Real testnet contract IDs are sourced from contract/deployments.json.
# ---------------------------------------------------------------------------
CONTRACT_ID          ?= CAKZALA72JTR6BV6N44E7L52C7QU5BAYYKVKYR2DFSV2YD2A2OI6WJMP
AGENTS_CONTRACT_ID   ?= CCT4FUTW54K7BYZFOCBEM5MVLS42ZE25WJ3ONW7RLYXAF3HQS7ZQYA2N
STELLAR_RPC_URL      ?= https://soroban-testnet.stellar.org
STELLAR_NETWORK_PASSPHRASE ?= Test SDF Network ; September 2015
LODESTAR_API_URL     ?= http://127.0.0.1:3001
BACKEND_HEALTHZ      ?= http://127.0.0.1:3001/healthz

# Agent wallet — set AGENT_STELLAR_SECRET when calling make.
AGENT_STELLAR_SECRET  ?=
# HMAC secret shared between the backend and the agent.
LODESTAR_HMAC_SECRET  ?= demo-hmac-secret

.PHONY: demo demo-up demo-health demo-seed demo-agent help

## demo: Bring up compose, wait for health, seed services, run the agent.
demo: demo-up demo-health demo-seed demo-agent

## demo-up: Start backend + frontend services in the background.
demo-up:
	@echo "==> Starting services with Docker Compose..."
	docker compose up -d

## demo-health: Poll the backend /healthz until it reports healthy.
##   Uses docker compose --wait when available; falls back to a curl loop.
demo-health:
	@echo "==> Waiting for backend to be healthy..."
	docker compose up -d --wait || \
	  ( \
	    i=0; \
	    until curl -sf $(BACKEND_HEALTHZ) > /dev/null 2>&1; do \
	      i=$$((i+1)); \
	      if [ $$i -ge 60 ]; then \
	        echo "ERROR: backend did not become healthy within 60 s" >&2; exit 1; \
	      fi; \
	      sleep 1; \
	    done \
	  )
	@echo "==> Backend is healthy."

## demo-seed: Install backend deps and register demo services on-chain.
demo-seed:
	@echo "==> Installing backend dependencies..."
	cd backend && npm install --prefer-offline --no-audit --no-fund
	@echo "==> Seeding demo services on-chain..."
	cd backend && \
	  SEEDING_MODE=true \
	  CONTRACT_ID=$(CONTRACT_ID) \
	  AGENTS_CONTRACT_ID=$(AGENTS_CONTRACT_ID) \
	  STELLAR_RPC_URL="$(STELLAR_RPC_URL)" \
	  STELLAR_NETWORK_PASSPHRASE="$(STELLAR_NETWORK_PASSPHRASE)" \
	  LODESTAR_API_URL=$(LODESTAR_API_URL) \
	  node scripts/seed.js

## demo-agent: Install agent deps and run the agent, printing its output.
demo-agent:
	@echo "==> Installing agent dependencies..."
	cd agent && npm install --prefer-offline --no-audit --no-fund
	@echo "==> Running Lodestar agent..."
	cd agent && \
	  AGENT_STELLAR_SECRET="$(AGENT_STELLAR_SECRET)" \
	  LODESTAR_HMAC_SECRET="$(LODESTAR_HMAC_SECRET)" \
	  LODESTAR_API_URL=$(LODESTAR_API_URL) \
	  STELLAR_RPC_URL="$(STELLAR_RPC_URL)" \
	  STELLAR_NETWORK_PASSPHRASE="$(STELLAR_NETWORK_PASSPHRASE)" \
	  CONTRACT_ID=$(CONTRACT_ID) \
	  AGENTS_CONTRACT_ID=$(AGENTS_CONTRACT_ID) \
	  node agent.js

help:
	@echo ""
	@echo "Lodestar Makefile targets:"
	@echo "  make demo          - Full demo: compose up -> health check -> seed -> agent"
	@echo "  make demo-up       - Start Docker Compose services"
	@echo "  make demo-health   - Wait for backend /healthz to respond"
	@echo "  make demo-seed     - Seed demo services into the on-chain registry"
	@echo "  make demo-agent    - Run the autonomous agent"
	@echo ""
	@echo "Key variables (override on the command line):"
	@echo "  AGENT_STELLAR_SECRET   Agent Stellar secret key (required for agent step)"
	@echo "  LODESTAR_HMAC_SECRET   HMAC secret shared with backend (default: demo-hmac-secret)"
	@echo "  CONTRACT_ID            Registry contract ID"
	@echo "  AGENTS_CONTRACT_ID     Agents contract ID"
	@echo "  STELLAR_RPC_URL        Soroban RPC endpoint"
	@echo ""
