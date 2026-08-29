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
import requestIdMiddleware from "./lib/requestId.js";
import registryRouter from "./routes/registry.js";
import servicesRouter from "./routes/services.js";
import demoRouter from "./routes/demo.js";
import agentsRouter from "./routes/agents.js";

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

app.get("/livez", (_req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get(["/healthz", "/readyz"], async (_req, res) => {
  try {
    const health = await checkRpcHealth();
    const queueDepth = getSubmitQueueDepth();

    // Determine HTTP status code based on health status
    let statusCode = 200;
    if (health.status === "unhealthy") {
      statusCode = 503; // Service Unavailable
    } else if (health.status === "degraded") {
      statusCode = 200; // Still accept requests but indicate degradation
    }

    const pendingTxCount = getPendingTransactionCount();

    res.status(statusCode).json({
      status: health.status,
      rpc: health.rpc,
      contract: health.contract,
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
