import express from "express";
import cors from "cors";
import config, { validateConfig } from "./config.js";
import logger from "./lib/logger.js";
import {
  requestLogger,
  requestContextMiddleware,
} from "./middleware/requestContext.js";
import { checkRpcHealth } from "./lib/stellar.js";
import {
  getSubmitQueueDepth,
  drainSubmitQueue,
  getPendingTransactionCount,
  getPendingTransactions,
  dumpPendingTransactions,
  resumePendingTransactions,
} from "./lib/contract.js";
import { getCircuitBreakerState } from "./lib/facilitatorCircuitBreaker.js";
import requestIdMiddleware from "./lib/requestId.js";
import registryRouter from "./routes/registry.js";
import servicesRouter from "./routes/services.js";
import demoRouter from "./routes/demo.js";
import agentsRouter from "./routes/agents.js";

/**
 * Attempt a lightweight ping to the facilitator service.
 * Returns facilitator status with latency measurement.
 */
async function checkFacilitatorHealth() {
  const result = {
    status: 'ok',
    latency_ms: 0,
    error: null,
  };

  try {
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s max for health check

    const response = await fetch(`${config.x402.facilitatorUrl}/health`, {
      method: 'HEAD',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    result.latency_ms = Date.now() - startTime;

    if (!response.ok) {
      result.status = 'degraded';
      result.error = `HTTP ${response.status}`;
    }

    logger.debug(
      { latency: result.latency_ms, status: response.status },
      'Facilitator health check passed',
    );
  } catch (err) {
    result.status = 'down';
    result.latency_ms = 0;
    result.error = err.message || 'Connection failed';

    logger.warn(
      { error: err.message },
      'Facilitator health check failed',
    );
  }

  // Also check circuit breaker state
  const circuitState = getCircuitBreakerState();
  if (circuitState.state === 'open') {
    result.status = 'degraded';
    result.circuit_breaker = 'open';
    result.circuit_breaker_failures = circuitState.consecutiveFailures;
  } else if (circuitState.state === 'half-open') {
    result.status = 'degraded';
    result.circuit_breaker = 'half-open';
  }

  return result;
}

if (process.argv.includes("--print-config")) {
  console.log(
    JSON.stringify(
      {
        nodeEnv: config.nodeEnv,
        port: config.port,
        logLevel: config.logLevel,
        stellar: config.stellar,
        contract: config.contract,
        x402: {
          facilitatorUrl: config.x402.facilitatorUrl,
          searchPrice: config.x402.searchPrice,
          weatherPrice: config.x402.weatherPrice,
          payTo: config.x402.payTo,
        },
        corsOrigin: config.corsOrigin,
        jsonBodyLimit: config.jsonBodyLimit,
        trustProxy: config.trustProxy,
        rateLimit: config.rateLimit,
        demoRun: config.demoRun,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

validateConfig(logger);

logger.info({ corsOrigin: config.corsOrigin }, "Resolved CORS origin allowlist");

const app = express();

// Trust the configured number of proxy hops so req.ip reflects the real client
// (via X-Forwarded-For) behind a reverse proxy — required for correct IP-based
// rate limiting. Defaults to false (no proxy) to avoid X-Forwarded-For spoofing.
app.set("trust proxy", config.trustProxy);

app.use(requestLogger);
app.use(requestContextMiddleware);

app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(requestIdMiddleware);
app.use(express.json({ limit: config.jsonBodyLimit }));

app.get("/healthz", async (req, res) => {
  try {
    const health = await checkRpcHealth();
    const facilitatorStatus = await checkFacilitatorHealth();
    const queueDepth = getSubmitQueueDepth();

    // Determine HTTP status code based on health status
    let statusCode = 200;
    if (health.status === "unhealthy") {
      statusCode = 503; // Service Unavailable
    } else if (health.status === "degraded") {
      statusCode = 200; // Still accept requests but indicate degradation
    }

    // Downgrade to 503 if facilitator is completely down and circuit is open
    if (facilitatorStatus.status === 'down') {
      statusCode = 503;
    }

    const pendingTxCount = getPendingTransactionCount();

    res.status(statusCode).json({
      status: health.status,
      rpc: health.rpc,
      contract: health.contract,
      facilitator_status: facilitatorStatus,
      timestamp: health.timestamp,
      queueDepth,
      pendingTransactions: pendingTxCount,
      ...(health.error && { error: health.error }),
    });
  } catch (err) {
    req.log.error({ err }, "Health check failed");
    res.status(503).json({
      status: "unhealthy",
      error: "Health check failed",
      timestamp: new Date().toISOString(),
    });
  }
});

app.use("/api", registryRouter);
app.use("/api", agentsRouter);

// Demo routes are backed by server-custodied keys and should not be reachable
// in production deployments. Gate them behind ENABLE_DEMO_ROUTES, defaulting to
// enabled only when NODE_ENV is not "production".
const enableDemoRoutes =
  process.env.ENABLE_DEMO_ROUTES === 'true' ||
  (process.env.ENABLE_DEMO_ROUTES === undefined && config.nodeEnv !== 'production');

if (enableDemoRoutes) {
  logger.info({ nodeEnv: config.nodeEnv }, 'Demo routes enabled');
  app.use("/api", demoRouter);
  app.use("/demo", servicesRouter);
} else {
  logger.info({ nodeEnv: config.nodeEnv }, 'Demo routes disabled (set ENABLE_DEMO_ROUTES=true to enable)');
}

app.use((err, req, res, _next) => {
  if (err.type === "entity.too.large") {
    req.log.warn({ expected: config.jsonBodyLimit }, "Request body too large");
    return res.status(413).json({
      error: `Request body too large. Maximum size is ${config.jsonBodyLimit}.`,
      code: "PAYLOAD_TOO_LARGE",
    });
  }


  res.status(500).json({
    error: "Internal server error",
    code: "INTERNAL_ERROR",
    requestId: _req.requestId,
  });
});
let server;
let shuttingDown = false;



async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info("Shutting down gracefully...");

  // Force-exit after the configured timeout so the process never hangs forever
  const forceExitTimer = setTimeout(() => {
    const pending = getPendingTransactions();
    if (pending.length > 0) {
      logger.warn(
        { count: pending.length, timeout: config.shutdownTimeoutMs },
        "Shutdown timeout reached — dumping pending transactions and force-exiting",
      );
      dumpPendingTransactions();
    }
    process.exit(1);
  }, config.shutdownTimeoutMs);
  forceExitTimer.unref();

  // If server hasn't been created yet (signal during startup resume) skip close
  if (!server) {
    logger.warn("Server was not yet listening — draining queue directly");
    await doDrainAndDump();
    clearTimeout(forceExitTimer);
    process.exit(0);
    return;
  }

  // Stop accepting new connections
  server.close(async (closeErr) => {
    if (closeErr) {
      logger.error({ err: closeErr }, "Error closing HTTP server");
    } else {
      logger.info("HTTP server closed — no longer accepting new connections");
    }

    await doDrainAndDump();
    clearTimeout(forceExitTimer);
    process.exit(0);
  });
}

async function doDrainAndDump() {
  try {
    await drainSubmitQueue();
    logger.info("Submit queue drained successfully");
  } catch (err) {
    logger.error({ err }, "Error draining submit queue");
  }

  const pending = getPendingTransactions();
  if (pending.length > 0) {
    logger.warn(
      { count: pending.length, hashes: pending.map((t) => t.hash) },
      "Pending transactions remain after queue drain — dumped to pending-transactions.json for manual verification",
    );
    dumpPendingTransactions();
  } else {
    logger.info("No pending transactions — clean shutdown");
  }
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

start();
