#!/usr/bin/env node
// Minimal stub of the read-heavy routes — used to produce a reproducible
// local baseline without needing a live Stellar RPC or Redis.
// Latency is ~5-15 ms per request, modelling the in-memory cache hit path
// (agents listing) and the fast simulateRead path.

import express from 'express';
const app = express();
const SAMPLE = 'GAMASX3TLJIDO42FO3GTX7IQAYN7RJ4U4CXJOROTB7RSV3NGPUEIEQH3';

function makeService(i) {
  return {
    id: i,
    name: `Service ${i}`,
    description: `Description for service ${i}`,
    endpoint: `https://example.com/${i}`,
    price_usdc: '0.001',
    category: ['search', 'weather', 'finance', 'ai'][i % 4],
    provider: SAMPLE,
    reputation: 100 + i,
    active: true,
    registered_at: 1000 + i,
    ttl_warning: false,
  };
}

const services = Array.from({ length: 40 }, (_, i) => makeService(i + 1));
const agents = Array.from({ length: 100 }, (_, i) => ({
  address: SAMPLE,
  name: `Agent ${i}`,
  description: 'test',
  owner: SAMPLE,
  score: 500 + i,
  total_payments: '10',
  successful_payments: '9',
  failed_payments: '1',
  total_volume_stroops: '1000000',
  registered_at: String(1000 + i),
  last_active: String(2000 + i),
  active: true,
  flagged: false,
  flag_reason: '',
}));

// Small jitter to simulate real variance
function jitter(ms = 5) {
  return Math.random() * ms;
}

app.get('/api/services', async (req, res) => {
  await new Promise((r) => setTimeout(r, jitter(8)));
  const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10) || 20));
  let filtered = services;
  if (req.query.category) filtered = filtered.filter((s) => s.category === req.query.category);
  if (req.query.q) {
    const q = req.query.q.toLowerCase();
    filtered = filtered.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
  }
  const page = filtered.slice(offset, offset + limit);
  res.json({ services: page, count: page.length });
});

app.get('/api/services/:id', async (req, res) => {
  await new Promise((r) => setTimeout(r, jitter(10)));
  const id = parseInt(req.params.id, 10);
  const svc = services.find((s) => s.id === id);
  if (!svc) return res.status(404).json({ error: 'Service not found', code: 'NOT_FOUND' });
  res.json(svc);
});

app.get('/api/services/:id/history', async (req, res) => {
  await new Promise((r) => setTimeout(r, jitter(5)));
  res.json({ history: [] });
});

app.get('/api/stats', async (req, res) => {
  // Sequential page fetch simulation — slightly slower to surface the N+1 risk noted in #834
  await new Promise((r) => setTimeout(r, jitter(15) + 10));
  res.json({ totalServices: services.length, categories: [...new Set(services.map((s) => s.category))], latestService: services[services.length - 1] });
});

app.get('/api/registry/by-provider/:address', async (req, res) => {
  await new Promise((r) => setTimeout(r, jitter(10)));
  const filtered = services.filter((s) => s.provider === req.params.address);
  res.json({ services: filtered, count: filtered.length });
});

app.get('/api/agents', async (req, res) => {
  await new Promise((r) => setTimeout(r, jitter(6)));
  const page = parseInt(req.query.page ?? '0', 10) || 0;
  const pageSize = Math.min(20, Math.max(1, parseInt(req.query.pageSize ?? '12', 10) || 12));
  const sort = req.query.sort || 'score';
  const sorted = [...agents].sort((a, b) => b.score - a.score);
  if (sort === 'payments') sorted.sort((a, b) => Number(b.total_payments) - Number(a.total_payments));
  if (sort === 'newest') sorted.sort((a, b) => Number(b.registered_at) - Number(a.registered_at));
  const slice = sorted.slice(page * pageSize, (page + 1) * pageSize);
  res.json({ agents: slice, total: sorted.length, page, pageSize });
});

app.get('/api/agents/count', async (req, res) => {
  await new Promise((r) => setTimeout(r, jitter(3)));
  res.json({ count: agents.length });
});

app.get('/api/agents/stats', async (req, res) => {
  await new Promise((r) => setTimeout(r, jitter(6)));
  const avgScore = Math.round(agents.reduce((s, a) => s + a.score, 0) / agents.length);
  const topAgent = agents.reduce((best, a) => (a.score > best.score ? a : best), agents[0]);
  res.json({ totalAgents: agents.length, avgScore, topAgent, totalVolume: '100.0', totalVolumeStroops: '1000000000' });
});

app.get('/api/agents/:address', async (req, res) => {
  await new Promise((r) => setTimeout(r, jitter(5)));
  res.json({ agent: agents[0], policy: { agent_address: req.params.address, max_per_tx_stroops: '1000000', max_per_day_stroops: '10000000', allowed_categories: [], min_score_to_earn: 0, daily_spent_stroops: '0', last_reset_ledger: '0' } });
});

app.get('/api/agents/:address/policy', async (req, res) => {
  await new Promise((r) => setTimeout(r, jitter(5)));
  res.json({ agent_address: req.params.address, max_per_tx_stroops: '1000000', max_per_day_stroops: '10000000', allowed_categories: [], min_score_to_earn: 0, daily_spent_stroops: '0', last_reset_ledger: '0' });
});

app.get('/api/agents/:address/score', async (req, res) => {
  await new Promise((r) => setTimeout(r, jitter(3)));
  res.json({ score: 550 });
});

app.get('/api/agents/:address/eligible', async (req, res) => {
  await new Promise((r) => setTimeout(r, jitter(4)));
  res.json({ eligible: true, score: 550, required: parseInt(req.query.min_score ?? '0', 10) });
});

app.get('/api/agents/:address/can-spend', async (req, res) => {
  await new Promise((r) => setTimeout(r, jitter(4)));
  res.json({ allowed: true, reason: 'OK' });
});

app.get('/api/agents/:address/payment-history', async (req, res) => {
  await new Promise((r) => setTimeout(r, jitter(5)));
  res.json({ payments: [], pagination: { total: 0, limit: 20, offset: 0, hasMore: false } });
});

app.get('/healthz', (req, res) => res.json({ status: 'ok', uptimeSeconds: 123, queueDepth: 0, pendingTransactions: 0, timestamp: new Date().toISOString() }));
app.get('/readyz', async (req, res) => {
  await new Promise((r) => setTimeout(r, jitter(2)));
  res.json({ ready: true, status: 'ready', timestamp: new Date().toISOString() });
});
app.get('/api/health', (req, res) => res.json({ status: 'ok', network: 'testnet', contractId: 'TEST', uptimeSeconds: 123, timestamp: new Date().toISOString() }));
app.get('/api/ready', async (req, res) => {
  await new Promise((r) => setTimeout(r, jitter(2)));
  res.json({ ready: true, status: 'ready', timestamp: new Date().toISOString() });
});

const port = process.env.PORT || 3456;
const server = app.listen(port, () => console.log(`stub-server listening on http://localhost:${port}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
