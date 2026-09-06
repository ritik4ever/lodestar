import {
  LodestarClient,
  type ServiceEntry,
  type StatsResponse,
  type ServicesResponse,
  type ReputationResponse,
  type Category,
  type AgentEntry,
  type SpendingPolicy,
  type AgentStats,
  type AgentsResponse,
  type AgentEligibilityResponse,
  type AgentSpendCheckResponse,
  type AgentSortOption,
} from '../../packages/client/index.js';
import { PAGE_SIZE } from './pagination';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const apiClient = new LodestarClient({
  baseUrl: API_URL,
  timeoutMs: 60000,
});

export async function fetchServices(category?: Category): Promise<ServiceEntry[]> {
  const data = await apiClient.getServices({ category });
  return data.services;
}

export async function fetchStats(): Promise<StatsResponse> {
  return apiClient.getStats();
}

export async function fetchServiceById(id: number): Promise<ServiceEntry> {
  return apiClient.getServiceById(id);
}

export async function fetchServicesByProvider(address: string): Promise<ServiceEntry[]> {
  const data = await apiClient.getServicesByProvider(address);
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
  return apiClient.submitReputation(id, { positive, agent });
}

export interface RegisterFormData {
  name: string;
  description: string;
  endpoint: string;
  price_usdc: string;
  category: Category;
}

export async function registerService(
  formData: RegisterFormData,
  walletAddress: string
): Promise<{ txHash: string; id: number }> {
  const { kitSignTransaction: signTx } = await import('./wallet');
  const prepared = await apiClient.prepareRegisterService({
    name: formData.name,
    description: formData.description,
    endpoint: formData.endpoint,
    priceUsdc: formData.price_usdc,
    category: formData.category,
    providerAddress: walletAddress,
  });

  const signedXdr = await signTx(prepared.xdr);
  const result = await apiClient.submitSignedRegistryTx({
    signedXdr,
    submitToken: prepared.submitToken,
  });

  if (!result.success || result.id == null) {
    throw new Error('Registration submitted but no service id was returned');
  }

  return { txHash: result.hash, id: result.id };
}

// ── Agent Credit Scoring ──────────────────────────────────────────────────────

// Contract ID for the LodestarAgents on-chain program.
// All current agent operations flow through the backend API (see apiClient above).
// Wire this into a direct contract call if/when the frontend needs to invoke
// agent operations without a backend intermediary.
export const AGENTS_CONTRACT_ID = process.env.NEXT_PUBLIC_AGENTS_CONTRACT_ID ?? '';

export async function fetchAgents(
  page = 0,
  pageSize = PAGE_SIZE,
  sort: AgentSortOption = 'score'
): Promise<AgentsResponse> {
  return apiClient.getAgents({ page, pageSize, sort });
}

export async function fetchAgent(
  address: string
): Promise<{ agent: AgentEntry; policy: SpendingPolicy | null }> {
  return apiClient.getAgent(address);
}

export async function fetchAgentStats(): Promise<AgentStats> {
  return apiClient.getAgentStats();
}

export async function fetchAgentEligibility(
  address: string,
  minScore: number
): Promise<AgentEligibilityResponse> {
  return apiClient.getAgentEligibility(address, minScore);
}

export async function fetchAgentSpendCheck(
  address: string,
  amount: string,
  category: string
): Promise<AgentSpendCheckResponse> {
  return apiClient.checkAgentCanSpend(address, { amount, category });
}
