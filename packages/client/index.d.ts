export type Category = 'search' | 'weather' | 'finance' | 'ai' | 'data' | 'compute';

export type AgentSortOption = 'score' | 'payments' | 'registered_at' | 'newest';

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
  registered_at?: number | null;
}

export interface ServicesResponse {
  services: ServiceEntry[];
  total?: number;
  count?: number;
}

export interface StatsResponse {
  total_services: number;
  total_categories: number;
  active_services: number;
  top_category: string;
  total_agents?: number;
  total_volume_stroops?: string;
  total_volume_usdc?: string;
  average_score?: number;
  totalServices?: number;
  categories?: Category[];
  latestService?: ServiceEntry | null;
}

export interface PrepareRegisterRequest {
  name: string;
  description: string;
  endpoint: string;
  priceUsdc: string;
  category: Category;
  providerAddress: string;
}

export interface PrepareRegisterResponse {
  xdr: string;
  submitToken: string;
}

export interface SubmitSignedRegistryTxRequest {
  signedXdr: string;
  submitToken: string;
}

export interface SubmitSignedRegistryTxResponse {
  success: boolean;
  hash: string;
  id: number | null;
}

export interface SubmitReputationRequest {
  positive: boolean;
  agent: string;
}

export interface ReputationResponse {
  newReputation: number;
  success?: boolean;
  txHash?: string | null;
}

export interface AgentEntry {
  address: string;
  name: string;
  description: string;
  endpoint?: string;
  score: number;
  total_payments: string;
  successful_payments: string;
  failed_payments: string;
  total_volume_stroops: string;
  active: boolean;
  flagged: boolean;
  registered_at?: number | string | null;
  last_active?: string | null;
  flag_reason?: string | null;
  owner?: string;
}

export interface SpendingPolicy {
  max_per_tx_stroops: string;
  max_per_day_stroops: string;
  spent_today_stroops?: string;
  last_spend_day?: number;
  allowed_categories: string[];
  min_score_to_earn: number;
  agent_address?: string;
  daily_spent_stroops?: string;
  last_reset_ledger?: string;
}

export interface AgentsResponse {
  agents: AgentEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages?: number;
}

export interface TierDistribution {
  unrated?: number;
  bronze?: number;
  silver?: number;
  gold?: number;
  platinum?: number;
}

export interface AgentStats {
  total_agents?: number;
  active_agents?: number;
  flagged_agents?: number;
  average_score?: number;
  total_volume_stroops?: string;
  tier_distribution?: TierDistribution;
  totalAgents?: number;
  avgScore?: number;
  topAgent?: AgentEntry | null;
  totalVolume?: string;
  totalVolumeStroops?: string;
}

export interface AgentProfileResponse {
  agent: AgentEntry;
  policy: SpendingPolicy | null;
}

export interface RegisterAgentRequest {
  name: string;
  description: string;
  address: string;
  endpoint?: string;
  agentAddress?: string;
  maxPerTxUsdc?: string;
  maxPerDayUsdc?: string;
  allowedCategories?: string[];
}

export interface RegisterAgentResponse {
  txHash?: string | null;
  agent: AgentEntry;
}

export interface AgentEligibilityResponse {
  eligible: boolean;
  score: number;
  minScore?: number;
  required?: number;
}

export interface AgentSpendCheckResponse {
  allowed: boolean;
  reason?: string | null;
  currentScore?: number | null;
  dailySpent?: string | null;
  dailyLimit?: string | null;
}

export interface RecordPaymentRequest {
  success: boolean;
  stroops: string;
  txHash?: string;
}

export interface RecordPaymentResponse {
  newScore: number;
  txHash?: string | null;
}

export interface BuildAgentTxRequest {
  action: string;
  [key: string]: unknown;
}

export interface BuildAgentTxResponse {
  xdr: string;
}

export interface SubmitSignedAgentTxRequest {
  signedXdr: string;
}

export interface SubmitSignedAgentTxResponse {
  txHash: string;
}

export interface ActivityEvent {
  id: string;
  type: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export interface ActivityResponse {
  events: ActivityEvent[];
  pagination?: Record<string, unknown>;
}

export interface DemoActivityEntry {
  id: string;
  type: string;
  timestamp: string;
  summary: string;
  agent?: string;
  service?: string;
  amount?: string;
  txHash?: string;
}

export interface DemoActivityResponse {
  activity: DemoActivityEntry[];
}

export interface HealthResponse {
  status: string;
  uptimeSeconds: number;
  queueDepth?: number;
  pendingTransactions?: number;
  timestamp: string;
}

export interface ReadinessResponse {
  ready: boolean;
  status: string;
  rpc?: Record<string, unknown>;
  redis?: Record<string, unknown>;
  timestamp: string;
}

export interface ErrorResponse {
  error: string;
  code?: string;
  requestId?: string;
}

export interface ClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}

export interface RequestOptions extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export class LodestarApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly body?: unknown;
  readonly requestId?: string;

  constructor(message: string, status: number, body?: unknown, code?: string, requestId?: string);
}

export class LodestarClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;

  constructor(options?: ClientOptions);

  // System
  getHealth(options?: RequestOptions): Promise<HealthResponse>;
  getReadiness(options?: RequestOptions): Promise<ReadinessResponse>;

  // Registry & Services
  getStats(options?: RequestOptions): Promise<StatsResponse>;
  getServices(params?: { category?: Category }, options?: RequestOptions): Promise<ServicesResponse>;
  getServiceById(id: number, options?: RequestOptions): Promise<ServiceEntry>;
  getServicesByProvider(address: string, options?: RequestOptions): Promise<ServicesResponse>;
  prepareRegisterService(data: PrepareRegisterRequest, options?: RequestOptions): Promise<PrepareRegisterResponse>;
  submitSignedRegistryTx(data: SubmitSignedRegistryTxRequest, options?: RequestOptions): Promise<SubmitSignedRegistryTxResponse>;
  submitReputation(id: number, data: SubmitReputationRequest, options?: RequestOptions): Promise<ReputationResponse>;

  // Agents
  getAgents(params?: { page?: number; pageSize?: number; sort?: AgentSortOption }, options?: RequestOptions): Promise<AgentsResponse>;
  getAgentStats(options?: RequestOptions): Promise<AgentStats>;
  getAgent(address: string, options?: RequestOptions): Promise<AgentProfileResponse>;
  registerAgent(data: RegisterAgentRequest, options?: RequestOptions): Promise<RegisterAgentResponse>;
  getAgentEligibility(address: string, minScore: number, options?: RequestOptions): Promise<AgentEligibilityResponse>;
  checkAgentCanSpend(address: string, params: { amount?: string; category?: string; amount_stroops?: string }, options?: RequestOptions): Promise<AgentSpendCheckResponse>;
  recordAgentPayment(address: string, data: RecordPaymentRequest, options?: RequestOptions): Promise<RecordPaymentResponse>;
  buildAgentTx(address: string, data: BuildAgentTxRequest, callerAddress: string, options?: RequestOptions): Promise<BuildAgentTxResponse>;
  submitSignedAgentTx(address: string, data: SubmitSignedAgentTxRequest, options?: RequestOptions): Promise<SubmitSignedAgentTxResponse>;

  // Activity
  getActivity(params?: { page?: number; limit?: number }, options?: RequestOptions): Promise<ActivityResponse>;
  getDemoActivity(options?: RequestOptions): Promise<DemoActivityResponse>;
}

export function createClient(options?: ClientOptions): LodestarClient;
