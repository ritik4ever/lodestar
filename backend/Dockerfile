# syntax=docker/dockerfile:1

FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

# The official Node image provides the unprivileged `node` account.
USER node

EXPOSE 3001

# Liveness only (#841): restarts the container when the process itself is
# wedged. Readiness (/readyz) gates traffic and is checked by the orchestrator,
# not here — a dependency outage must not trigger a restart loop.
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:3001/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "start"]
