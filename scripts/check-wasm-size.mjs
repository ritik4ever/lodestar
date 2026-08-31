#!/usr/bin/env node

import {
  appendFileSync,
  statSync,
  writeFileSync,
} from "node:fs";

const DEFAULT_MAX_WASM_SIZE_BYTES = 128 * 1024;

function parseArguments(argv) {
  const supported = new Set([
    "--current-registry",
    "--current-agents",
    "--base-registry",
    "--base-agents",
    "--max-bytes",
    "--metrics",
    "--summary",
  ]);
  const options = {};

  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];

    if (!supported.has(option)) {
      throw new Error(`Unknown option: ${option ?? "<missing>"}`);
    }
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${option}`);
    }

    options[option.slice(2)] = value;
  }

  return options;
}

function readArtifactSize(path, label) {
  if (!path) {
    throw new Error(`Missing required ${label} artifact path`);
  }

  let stats;
  try {
    stats = statSync(path);
  } catch {
    throw new Error(`${label} artifact not found: ${path}`);
  }

  if (!stats.isFile()) {
    throw new Error(`${label} artifact is not a file: ${path}`);
  }

  return stats.size;
}

function parseMaximum(value) {
  const maximum = Number(value ?? DEFAULT_MAX_WASM_SIZE_BYTES);
  if (!Number.isSafeInteger(maximum) || maximum <= 0) {
    throw new Error(`WASM size ceiling must be a positive integer, received: ${value}`);
  }
  return maximum;
}

function formatBytes(bytes) {
  return `${bytes.toLocaleString("en-US")} B (${(bytes / 1024).toFixed(2)} KiB)`;
}

function formatDelta(delta) {
  if (delta === null) {
    return "n/a";
  }
  if (delta === 0) {
    return "0 B";
  }
  return `${delta > 0 ? "+" : ""}${delta.toLocaleString("en-US")} B`;
}

function buildReport(contracts, maximum) {
  const lines = [
    "## Contract WASM sizes",
    "",
    `Ceiling: **${formatBytes(maximum)}** per contract.`,
    "",
    "| Contract | Current | Base | Delta | Status |",
    "| --- | ---: | ---: | ---: | :---: |",
  ];

  for (const contract of contracts) {
    lines.push(
      `| ${contract.name} | ${formatBytes(contract.size_bytes)} | ${
        contract.base_size_bytes === null
          ? "n/a"
          : formatBytes(contract.base_size_bytes)
      } | ${formatDelta(contract.delta_bytes)} | ${
        contract.status === "pass" ? "✅ pass" : "❌ over limit"
      } |`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const maximum = parseMaximum(
    options["max-bytes"] ?? process.env.MAX_WASM_SIZE_BYTES,
  );
  const hasBaseRegistry = Boolean(options["base-registry"]);
  const hasBaseAgents = Boolean(options["base-agents"]);

  if (hasBaseRegistry !== hasBaseAgents) {
    throw new Error("Base registry and agents artifacts must be supplied together");
  }

  const definitions = [
    {
      name: "lodestar-registry",
      currentPath: options["current-registry"],
      basePath: options["base-registry"],
    },
    {
      name: "lodestar-agents",
      currentPath: options["current-agents"],
      basePath: options["base-agents"],
    },
  ];

  const contracts = definitions.map(({ name, currentPath, basePath }) => {
    const size = readArtifactSize(currentPath, `current ${name}`);
    const baseSize = basePath
      ? readArtifactSize(basePath, `base ${name}`)
      : null;

    return {
      name,
      size_bytes: size,
      base_size_bytes: baseSize,
      delta_bytes: baseSize === null ? null : size - baseSize,
      maximum_bytes: maximum,
      status: size <= maximum ? "pass" : "over-limit",
    };
  });

  const report = buildReport(contracts, maximum);
  const metricsPath = options.metrics ?? "wasm-size-metrics.json";
  const metrics = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    git_sha: process.env.GITHUB_SHA ?? null,
    event_name: process.env.GITHUB_EVENT_NAME ?? null,
    maximum_bytes: maximum,
    contracts,
  };

  writeFileSync(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`);
  process.stdout.write(report);

  const summaryPath = options.summary ?? process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    appendFileSync(summaryPath, `${report}\n`);
  }

  const oversized = contracts.filter((contract) => contract.status !== "pass");
  if (oversized.length > 0) {
    const names = oversized.map((contract) => contract.name).join(", ");
    throw new Error(`WASM size ceiling exceeded by: ${names}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`WASM size check failed: ${error.message}`);
  process.exitCode = 1;
}
