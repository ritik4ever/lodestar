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
