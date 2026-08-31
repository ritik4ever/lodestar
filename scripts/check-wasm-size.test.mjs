import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  "check-wasm-size.mjs",
);

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "lodestar-wasm-size-"));
  const paths = {
    directory,
    currentRegistry: join(directory, "lodestar_registry.wasm"),
    currentAgents: join(directory, "lodestar_agents.wasm"),
    baseRegistry: join(directory, "base_lodestar_registry.wasm"),
    baseAgents: join(directory, "base_lodestar_agents.wasm"),
    metrics: join(directory, "metrics.json"),
    summary: join(directory, "summary.md"),
  };

  return paths;
}

function run(paths, extraArguments = []) {
  return spawnSync(
    process.execPath,
    [
      script,
      "--current-registry",
      paths.currentRegistry,
      "--current-agents",
      paths.currentAgents,
      "--metrics",
      paths.metrics,
      "--summary",
      paths.summary,
      ...extraArguments,
    ],
    { encoding: "utf8" },
  );
}

test("reports both contract sizes and their base deltas", (t) => {
  const paths = fixture();
  t.after(() => rmSync(paths.directory, { recursive: true, force: true }));
  writeFileSync(paths.currentRegistry, Buffer.alloc(100));
  writeFileSync(paths.currentAgents, Buffer.alloc(200));
  writeFileSync(paths.baseRegistry, Buffer.alloc(90));
  writeFileSync(paths.baseAgents, Buffer.alloc(220));

  const result = run(paths, [
    "--base-registry",
    paths.baseRegistry,
    "--base-agents",
    paths.baseAgents,
    "--max-bytes",
    "1024",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\+10 B/);
  assert.match(result.stdout, /-20 B/);
  assert.match(readFileSync(paths.summary, "utf8"), /lodestar-registry/);

  const metrics = JSON.parse(readFileSync(paths.metrics, "utf8"));
  assert.equal(metrics.maximum_bytes, 1024);
  assert.deepEqual(
    metrics.contracts.map(({ delta_bytes, status }) => ({
      delta_bytes,
      status,
    })),
    [
      { delta_bytes: 10, status: "pass" },
      { delta_bytes: -20, status: "pass" },
    ],
  );
});

test("fails when an exact current artifact is missing", (t) => {
  const paths = fixture();
  t.after(() => rmSync(paths.directory, { recursive: true, force: true }));
  writeFileSync(paths.currentRegistry, Buffer.alloc(100));

  const result = run(paths, ["--max-bytes", "1024"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /current lodestar-agents artifact not found/);
});

test("fails over the ceiling but still writes trend metrics", (t) => {
  const paths = fixture();
  t.after(() => rmSync(paths.directory, { recursive: true, force: true }));
  writeFileSync(paths.currentRegistry, Buffer.alloc(100));
  writeFileSync(paths.currentAgents, Buffer.alloc(1_025));

  const result = run(paths, ["--max-bytes", "1024"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /ceiling exceeded by: lodestar-agents/);
  const metrics = JSON.parse(readFileSync(paths.metrics, "utf8"));
  assert.equal(metrics.contracts[1].status, "over-limit");
});

test("rejects an incomplete base comparison", (t) => {
  const paths = fixture();
  t.after(() => rmSync(paths.directory, { recursive: true, force: true }));
  writeFileSync(paths.currentRegistry, Buffer.alloc(100));
  writeFileSync(paths.currentAgents, Buffer.alloc(200));
  writeFileSync(paths.baseRegistry, Buffer.alloc(90));

  const result = run(paths, [
    "--base-registry",
    paths.baseRegistry,
    "--max-bytes",
    "1024",
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be supplied together/);
});
