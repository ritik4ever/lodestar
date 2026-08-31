# Lodestar Agent

Autonomous x402 agent that discovers services, pays on Stellar testnet, and updates its on-chain credit score.

## Prerequisites

- Node.js ≥ 22
- A funded Stellar testnet account (secret key)
- Lodestar backend running with the registry contract deployed

## Setup

```sh
cp .env.example .env
# Edit .env and set AGENT_STELLAR_SECRET, STELLAR_RPC_URL, LODESTAR_API_URL
npm install
```

## Run

```sh
cd agent && node agent.js
```

Expected output when healthy:

```text
[2026-01-01 00:00:00.000 +0000] INFO  (index): Agent starting {"event":"agent_start","agentAddress":"G...","agentName":"LodestarAgent"}
[2026-01-01 00:00:00.150 +0000] INFO  (index): Already registered {"event":"agent_registered","agentAddress":"G...","score":100,"scoringEnabled":true}
[2026-01-01 00:00:00.160 +0000] INFO  (index): Task started {"event":"task_start","category":"weather","agentAddress":"G..."}
[2026-01-01 00:00:02.800 +0000] INFO  (index): Payment successful {"event":"payment_success","category":"weather","serviceId":1,"serviceName":"WeatherService","priceUsdc":"0.001","txHash":"abc123...","scoreBefore":100,"taskDurationMs":2640}
[2026-01-01 00:00:02.850 +0000] INFO  (index): Score updated {"event":"score_updated","agentAddress":"G...","scoreBefore":100,"scoreAfter":110}
[2026-01-01 00:00:02.900 +0000] INFO  (index): Agent run complete {"event":"agent_complete","agentAddress":"G...","totalTasks":1,"successCount":1,"failCount":0,"totalUsdcSpent":"0.001","finalScore":110,"scoreDelta":10,"runDurationMs":3800}
```

Common failures:

```text
Missing required env var: AGENT_STELLAR_SECRET
Invalid AGENT_STELLAR_SECRET: unable to parse secret key
Not registered — registering now
No services found for category {"event":"task_start","category":"weather","servicesFound":0}
No services meet minimum reputation threshold {"event":"task_start","category":"weather","servicesFound":0,"minReputation":50}
Payment failed — network error {"event":"payment_failed","category":"weather","serviceId":1,"serviceName":"WeatherService","priceUsdc":"0.001","err":{}}
Payment failed — endpoint error {"event":"payment_failed","category":"weather","serviceId":1,"serviceName":"WeatherService","priceUsdc":"0.001","httpStatus":500}
All candidate services exhausted {"event":"payment_failed","category":"weather","servicesAttempted":2}
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AGENT_STELLAR_SECRET` | Yes | — | Stellar secret key for the agent |
| `STELLAR_RPC_URL` | Yes | — | Horizon RPC URL |
| `LODESTAR_API_URL` | Yes | — | Base URL of the Lodestar backend |
| `LODESTAR_HMAC_SECRET` | No | `""` | HMAC secret for signing payment-record requests |
| `AGENT_NAME` | No | `LodestarAgent` | Display name |
| `AGENT_DESC` | No | `""` | Agent description |
| `AGENT_MAX_PER_TX` | No | `0.001` | Max USDC per transaction |
| `AGENT_MAX_PER_DAY` | No | `1.00` | Max USDC per day |
| `AGENT_ALLOWED_CATEGORIES` | No | `weather,search` | Comma-separated allowed categories |
| `AGENT_MIN_SERVICE_REPUTATION` | No | `0` | Minimum reputation to consider a service |
| `AGENT_MAX_SERVICE_RETRIES` | No | `3` | Max weighted retry attempts per task |
| `LOG_LEVEL` | No | `info` | pino log level |