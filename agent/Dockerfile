# ── Stage 1: install production dependencies ──────────────────────────────────
FROM node:22-alpine AS deps

WORKDIR /app

# Copy only the manifests first so this layer is cached until they change.
COPY package.json package-lock.json ./

# Install production dependencies only (no devDependencies needed at runtime).
RUN npm ci --omit=dev

# ── Stage 2: runtime image ─────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

# Create a non-root user and group (satisfies security requirement).
RUN addgroup -S agent && adduser -S agent -G agent

WORKDIR /app

# Copy installed modules from the deps stage.
COPY --from=deps /app/node_modules ./node_modules

# Copy application source.
COPY agent.js ./
COPY package.json ./

# Give ownership to the non-root user before switching to it.
RUN chown -R agent:agent /app

USER agent

# ── Environment variables ──────────────────────────────────────────────────────
# Required — the container will refuse to start if these are absent.
#
#   AGENT_STELLAR_SECRET          Stellar secret key for the agent wallet
#   STELLAR_RPC_URL               Soroban/Horizon RPC endpoint
#   LODESTAR_API_URL              Base URL of the Lodestar backend  (e.g. http://backend:3001)
#
# Optional — sensible defaults are built into agent.js.
#
#   STELLAR_NETWORK               testnet | mainnet  (default: testnet)
#   STELLAR_NETWORK_PASSPHRASE    Network passphrase (default: testnet value)
#   LODESTAR_HMAC_SECRET          HMAC secret for signing payment-record requests
#   AGENT_NAME                    Display name registered on-chain  (default: LodestarAgent)
#   AGENT_DESC                    Short description registered on-chain
#   AGENT_MAX_PER_TX              Max USDC per single transaction   (default: 0.001)
#   AGENT_MAX_PER_DAY             Max USDC per day                  (default: 1.00)
#   AGENT_ALLOWED_CATEGORIES      Comma-separated service categories (default: weather,search)
#   AGENT_MIN_SERVICE_REPUTATION  Minimum reputation a service must have (default: 0)
#   AGENT_MAX_SERVICE_RETRIES     Max retry attempts per task        (default: 3)
#   LOG_LEVEL                     Pino log level: trace|debug|info|warn|error (default: info)

CMD ["node", "agent.js"]
