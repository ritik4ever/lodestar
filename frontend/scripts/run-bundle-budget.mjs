import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const configPath = path.join(projectRoot, 'bundle-budget.json');
const logPath = path.join(projectRoot, '.next', 'build.log');
const reportPath = path.join(projectRoot, 'bundle-size-report.md');

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const marginPercent = Number(config.marginPercent ?? 0.2);
const baseline = config.routes ?? {};

const nodeBinDir = 'C:\\Program Files\\nodejs';
const pathEnv = process.env.PATH ? `${process.env.PATH}${path.delimiter}${nodeBinDir}` : nodeBinDir;
const result = spawnSync('npx next build', {
  cwd: projectRoot,
  env: { ...process.env, FORCE_COLOR: '0', PATH: pathEnv },
  encoding: 'utf8',
  shell: true,
});

const buildOutput = `${result.stdout ?? ''}${result.stderr ?? ''}`;
fs.mkdirSync(path.dirname(logPath), { recursive: true });
fs.writeFileSync(logPath, buildOutput);

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  console.error(buildOutput || 'Frontend build failed.');
  process.exit(result.status ?? 1);
}

const routeSizes = parseRouteSizes(buildOutput);
const rows = [];
let overBudget = false;

for (const [route, sizeBytes] of Object.entries(routeSizes).sort(([left], [right]) => left.localeCompare(right))) {
  const budget = baseline[route];
  const budgetBytes = typeof budget === 'number' ? budget : null;
  const threshold = budgetBytes ? Math.round(budgetBytes * (1 + marginPercent)) : null;
  const status = budgetBytes ? (sizeBytes <= threshold ? 'OK' : 'OVER') : 'NO BASELINE';

  if (budgetBytes && sizeBytes > threshold) {
    overBudget = true;
  }

  rows.push({
    route,
    actual: `${(sizeBytes / 1024).toFixed(1)} kB`,
    budget: budgetBytes ? `${(budgetBytes / 1024).toFixed(1)} kB` : '—',
    delta: budgetBytes ? `${(((sizeBytes - budgetBytes) / budgetBytes) * 100).toFixed(1)}%` : '—',
    status,
    threshold: budgetBytes ? `${(threshold / 1024).toFixed(1)} kB` : '—',
  });
}

const report = [
  '# Frontend bundle budget',
  '',
  '| Route | Actual | Budget | Threshold | Delta | Status |',
  '| --- | ---: | ---: | ---: | ---: | --- |',
  ...rows.map(({ route, actual, budget, threshold, delta, status }) => `| ${route} | ${actual} | ${budget} | ${threshold} | ${delta} | ${status} |`),
  '',
  overBudget ? 'Bundle budget failed for one or more routes.' : 'Bundle budget passed for all tracked routes.',
].join('\n');

fs.writeFileSync(reportPath, `${report}\n`);

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${report}\n`);
}

console.log(report);

if (overBudget) {
  process.exit(1);
}

function parseRouteSizes(log) {
  const normalizedLog = log.replace(/\u001b\[[0-9;]*m/g, '');
  const routes = new Map();

  for (const route of Object.keys(baseline).sort((a, b) => b.length - a.length)) {
    const pattern = new RegExp(`${escapeForRegExp(route)}\\s+\\d+(?:\\.\\d+)?\\s*kB\\s+(\\d+(?:\\.\\d+)?)\\s*kB`, 'g');
    const match = normalizedLog.match(pattern);

    if (!match) {
      continue;
    }

    const lastSize = match[match.length - 1].match(/(\d+(?:\.\d+)?)\s*kB\s*$/);
    if (!lastSize) {
      continue;
    }

    routes.set(route, Math.round(Number(lastSize[1]) * 1024));
  }

  return Object.fromEntries(routes);
}

function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
