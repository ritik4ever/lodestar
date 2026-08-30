export type {
  Category,
  ServiceEntry,
  ServicesResponse,
  StatsResponse,
  ReputationResponse,
  AgentEntry,
  SpendingPolicy,
  AgentSortOption,
  AgentsResponse,
  AgentStats,
  AgentEligibilityResponse,
  AgentSpendCheckResponse,
} from '../../packages/client/index.js';

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  code?: string;
}

export interface ActivityEntry {
  timestamp: string;
  agent: string;
  service: string;
  amount: string;
  txHash: string;
}

export type FreighterStatus = 'not-installed' | 'not-connected' | 'connected';
export type WalletMode = 'freighter' | 'keypair';

export type SortOption = 'newest' | 'reputation' | 'price';

export interface AgentStep {
  label: string;
  status: 'pending' | 'active' | 'complete' | 'error';
  detail?: string;
}

// ── Agent Credit Scoring ──────────────────────────────────────────────────────

export type ScoreTier = 'new' | 'building' | 'established' | 'trusted' | 'elite';

export function scoreTier(score: number): ScoreTier {
  if (score >= 1000) return 'elite';
  if (score >= 900) return 'trusted';
  if (score >= 600) return 'established';
  if (score >= 300) return 'building';
  return 'new';
}

export const TIER_LABELS: Record<ScoreTier, string> = {
  new: 'New',
  building: 'Building',
  established: 'Established',
  trusted: 'Trusted',
  elite: 'Elite',
};

export const TIER_COLORS: Record<ScoreTier, string> = {
  new: 'text-gray-500 bg-gray-50',
  building: 'text-blue-600 bg-blue-50',
  established: 'text-violet-600 bg-violet-50',
  trusted: 'text-emerald-600 bg-emerald-50',
  elite: 'text-amber-600 bg-amber-50',
};

export interface AgentRegisterRequest {
  agentAddress: string;
  name: string;
  description: string;
}
