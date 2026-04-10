export type Category = 'search' | 'weather' | 'finance' | 'ai' | 'data' | 'compute';

export interface ServiceEntry {
  id: number;
  name: string;
  description: string;
  endpoint: string;
  price_usdc: string;
  category: Category;
  provider: string;
  reputation: number;
  active: boolean;
  registered_at: number;
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  code?: string;
}

export interface StatsResponse {
  totalServices: number;
  categories: Category[];
  latestService: ServiceEntry | null;
}

export interface ServicesResponse {
  services: ServiceEntry[];
  count: number;
}

export interface ReputationResponse {
  success: boolean;
  newReputation: number;
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

export interface AgentEntry {
  address: string;
  name: string;
  description: string;
  owner: string;
  score: number;
  total_payments: number;
  successful_payments: number;
  failed_payments: number;
  total_volume_stroops: string;
  registered_at: number;
  last_active: number;
  active: boolean;
  flagged: boolean;
  flag_reason: string;
}

export interface SpendingPolicy {
  agent_address: string;
  max_per_tx_stroops: string;
  max_per_day_stroops: string;
  allowed_categories: string[];
  min_score_to_earn: number;
  daily_spent_stroops: string;
  last_reset_ledger: number;
}

export interface AgentsResponse {
  agents: AgentEntry[];
  count: number;
}

export interface AgentRegisterRequest {
  agentAddress: string;
  name: string;
  description: string;
}

export interface AgentStats {
  totalAgents: number;
  avgScore: number;
  topAgent: AgentEntry | null;
  totalVolume: string;
}

export interface AgentEligibilityResponse {
  eligible: boolean;
  score: number;
  required: number;
}

export interface AgentSpendCheckResponse {
  allowed: boolean;
  reason: string;
}
