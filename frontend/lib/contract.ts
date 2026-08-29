import type {
  ServiceEntry,
  StatsResponse,
  ServicesResponse,
  ReputationResponse,
  Category,
  AgentEntry,
  SpendingPolicy,
  AgentStats,
  AgentsResponse,
  AgentEligibilityResponse,
  AgentSpendCheckResponse,
  AgentSortOption,
  ScoreTier,
} from './types';
import { PAGE_SIZE } from './pagination';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    // 60s timeout to handle Render cold start (~50s wake time)
    signal: AbortSignal.timeout(60000),
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchServices(category?: Category): Promise<ServiceEntry[]> {
  const query = category ? `?category=${category}` : '';
  const data = await apiFetch<ServicesResponse>(`/api/services${query}`);
  return data.services;
}

export async function fetchStats(): Promise<StatsResponse> {
  return apiFetch<StatsResponse>('/api/stats');
}

export async function fetchServiceById(id: number): Promise<ServiceEntry> {
  return apiFetch<ServiceEntry>(`/api/services/${id}`);
}

export async function fetchServicesByProvider(address: string): Promise<ServiceEntry[]> {
  const data = await apiFetch<ServicesResponse>(
    `/api/registry/by-provider/${encodeURIComponent(address)}`
  );
  return data.services;
}

// Reputation votes are cast on behalf of a registered demo agent; the backend
// only signs for agents it holds keys for. Configure the public demo agent
// address the UI votes as via NEXT_PUBLIC_DEMO_AGENT_ADDRESS.
export const DEMO_AGENT_ADDRESS = process.env.NEXT_PUBLIC_DEMO_AGENT_ADDRESS ?? '';

export async function submitReputation(
  id: number,
  positive: boolean,
  agent: string = DEMO_AGENT_ADDRESS
): Promise<ReputationResponse> {
  if (!agent) {
    throw new Error(
      'No voting agent configured. Set NEXT_PUBLIC_DEMO_AGENT_ADDRESS to a registered demo agent.'
    );
  }
  return apiFetch<ReputationResponse>(`/api/reputation/${id}`, {
    method: 'POST',
    body: JSON.stringify({ positive, agent }),
  });
}

export interface RegisterFormData {
  name: string;
  description: string;
  endpoint: string;
  price_usdc: string;
  category: Category;
}

interface PreparedRegistryTxResponse {
  xdr: string;
  submitToken: string;
}

interface SubmittedRegistryTxResponse {
  success: boolean;
  hash: string;
  id: number | null;
}

export async function registerService(
  formData: RegisterFormData,
  walletAddress: string
): Promise<{ txHash: string; id: number }> {
  const { kitSignTransaction: signTx } = await import('./wallet');
  const prepared = await apiFetch<PreparedRegistryTxResponse>('/api/registry/prepare-register', {
    method: 'POST',
    body: JSON.stringify({
      name: formData.name,
      description: formData.description,
      endpoint: formData.endpoint,
      priceUsdc: formData.price_usdc,
      category: formData.category,
      providerAddress: walletAddress,
    }),
  });

  const signedXdr = await signTx(prepared.xdr);
  const result = await apiFetch<SubmittedRegistryTxResponse>('/api/registry/submit-signed-tx', {
    method: 'POST',
    body: JSON.stringify({ signedXdr, submitToken: prepared.submitToken }),
  });

  if (!result.success || result.id == null) {
    throw new Error('Registration submitted but no service id was returned');
  }

  return { txHash: result.hash, id: result.id };
}

// ── Agent Credit Scoring ──────────────────────────────────────────────────────

// Contract ID for the LodestarAgents on-chain program.
// All current agent operations flow through the backend API (see apiFetch above).
// Wire this into a direct contract call if/when the frontend needs to invoke
// agent operations without a backend intermediary.
export const AGENTS_CONTRACT_ID = process.env.NEXT_PUBLIC_AGENTS_CONTRACT_ID ?? '';

export async function fetchAgents(
  page = 0,
  pageSize = PAGE_SIZE,
  sort: AgentSortOption = 'score',
  tier: ScoreTier | 'all' = 'all'
): Promise<AgentsResponse> {
  const tierQuery = tier === 'all' ? '' : `&tier=${tier}`;
  return apiFetch<AgentsResponse>(
    `/api/agents?page=${page}&pageSize=${pageSize}&sort=${sort}${tierQuery}`
  );
}

export async function fetchAgent(
  address: string
): Promise<{ agent: AgentEntry; policy: SpendingPolicy | null }> {
  return apiFetch<{ agent: AgentEntry; policy: SpendingPolicy | null }>(
    `/api/agents/${address}`
  );
}

export async function fetchAgentStats(): Promise<AgentStats> {
  return apiFetch<AgentStats>('/api/agents/stats');
}

export async function fetchAgentEligibility(
  address: string,
  minScore: number
): Promise<AgentEligibilityResponse> {
  return apiFetch<AgentEligibilityResponse>(
    `/api/agents/${address}/eligible?min_score=${minScore}`
  );
}

export async function fetchAgentSpendCheck(
  address: string,
  amount: string,
  category: string
): Promise<AgentSpendCheckResponse> {
  return apiFetch<AgentSpendCheckResponse>(
    `/api/agents/${address}/can-spend?amount=${encodeURIComponent(amount)}&category=${encodeURIComponent(category)}`
  );
}
