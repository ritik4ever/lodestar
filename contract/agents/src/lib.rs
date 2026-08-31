#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, vec,
    Address, Env, IntoVal, String, Symbol, Vec,
};

// ── Constants ────────────────────────────────────────────────────────────────
const MAX_TTL: u32 = 100_000_000; // extended for tests/CI stability
#[cfg(not(test))]
const DAY_LEDGERS: u64 = 17_280; // 86400 / 5
#[cfg(test)]
const DAY_LEDGERS: u64 = 5;
#[cfg(test)]
const TEST_MAX_TTL: u32 = 100_000_000;
const MAX_SCORE: i32 = 1_000;
const INITIAL_SCORE: i32 = 100;
const SCORE_SUCCESS: i32 = 10;
const SCORE_FAILURE: i32 = -25;
const FLAG_PENALTY: i32 = -200;

// ── Storage keys ─────────────────────────────────────────────────────────────
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    AgentCount,
    AgentIds,
    Agent(Address),
    Policy(Address),
    RegistryContract,
    Admin,
}

// ServiceEntry shape (mirrors the registry contract) for cross-contract calls
#[contracttype]
#[derive(Clone)]
pub struct ServiceEntry {
    pub id: u64,
    pub name: String,
    pub description: String,
    pub endpoint: String,
    pub price_usdc: String,
    pub category: String,
    pub provider: Address,
    pub reputation: i32,
    pub active: bool,
    pub registered_at: u64,
}

// ── Data types ───────────────────────────────────────────────────────────────
#[contracttype]
#[derive(Clone)]
pub struct AgentEntry {
    pub address: Address,
    pub name: String,
    pub description: String,
    pub owner: Address,
    pub score: i32,
    pub total_payments: u64,
    pub successful_payments: u64,
    pub failed_payments: u64,
    pub total_volume_stroops: i128,
    pub registered_at: u64,
    pub last_active: u64,
    pub active: bool,
    pub flagged: bool,
    pub flag_reason: String,
}

#[contracttype]
#[derive(Clone)]
pub struct SpendingPolicy {
    pub agent_address: Address,
    pub max_per_tx_stroops: i128,
    pub max_per_day_stroops: i128,
    pub allowed_categories: Vec<String>,
    /// Minimum agent score required to earn score increments from successful
    /// payments. Agents below this threshold still have payment stats recorded
    /// (total_payments, successful_payments) but their score will not increase
    /// until they reach this score. Set to 0 to allow all agents to earn score.
    pub min_score_to_earn: i32,
    pub daily_spent_stroops: i128,
    pub last_reset_ledger: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ScoringConfig {
    pub initial_score: i32,
    pub score_success: i32,
    pub score_failure: i32,
    pub flag_penalty: i32,
}

// ── Contract ─────────────────────────────────────────────────────────────────
#[contract]
pub struct LodestarAgents;

// ── Private helpers ────────────────────────────────────────────────────────────
impl LodestarAgents {
    /// Get the current daily spent amount and reset it if a new day has started.
    /// Returns (daily_spent_stroops, last_reset_ledger) for the current day.
    fn get_daily_spend_with_reset(
        env: &Env,
        policy: &SpendingPolicy,
    ) -> (i128, u64) {
        let now = env.ledger().sequence() as u64;
        if now >= policy.last_reset_ledger + DAY_LEDGERS {
            (0i128, now)
        } else {
            (policy.daily_spent_stroops, policy.last_reset_ledger)
        }
    }

    /// Update the daily spent amount in a policy, resetting if a new day has started.
    /// Returns an updated policy with the new daily spent amount.
    fn update_daily_spend(
        env: &Env,
        mut policy: SpendingPolicy,
        amount_stroops: i128,
    ) -> SpendingPolicy {
        let (daily_spent, last_reset) = Self::get_daily_spend_with_reset(env, &policy);
        policy.daily_spent_stroops = daily_spent + amount_stroops;
        policy.last_reset_ledger = last_reset;
        policy
    }
}

#[contractimpl]
impl LodestarAgents {
    // Init — stores the registry contract address for cross-contract verification
    pub fn init(env: Env, registry_contract: Address) {
        if env.storage().persistent().has(&DataKey::RegistryContract) {
            panic!("already initialized");
        }
        env.storage()
            .persistent()
            .set(&DataKey::RegistryContract, &registry_contract);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::RegistryContract, MAX_TTL, MAX_TTL);
    }

    /// Deploy-time setup: store the admin address for privileged operations.
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Admin, MAX_TTL, MAX_TTL);
    }

    // Register a new agent.
    // owner = agent_address — self-owned by default. No require_auth here so
    // the backend server can register on behalf of any wallet address.
    pub fn register_agent(
        env: Env,
        agent_address: Address,
        name: String,
        description: String,
        owner: Address,
    ) -> u64 {

        let key = DataKey::Agent(agent_address.clone());
        if env.storage().persistent().has(&key) {
            panic!("agent already registered");
        }

        let now = env.ledger().sequence() as u64;

        let entry = AgentEntry {
            address: agent_address.clone(),
            name,
            description,
            owner: owner.clone(),
            score: INITIAL_SCORE,
            total_payments: 0,
            successful_payments: 0,
            failed_payments: 0,
            total_volume_stroops: 0,
            registered_at: now,
            last_active: now,
            active: true,
            flagged: false,
            flag_reason: String::from_str(&env, ""),
        };

        env.storage().persistent().set(&key, &entry);
        env.storage().persistent().extend_ttl(&key, MAX_TTL, MAX_TTL);

        // Update agent IDs list
        let ids_key = DataKey::AgentIds;
        let mut ids: Vec<Address> = env
            .storage()
            .persistent()
            .get(&ids_key)
            .unwrap_or_else(|| vec![&env]);
        ids.push_back(agent_address.clone());
        env.storage().persistent().set(&ids_key, &ids);
        env.storage()
            .persistent()
            .extend_ttl(&ids_key, MAX_TTL, MAX_TTL);

        // Update count
        let count_key = DataKey::AgentCount;
        let count: u64 = env
            .storage()
            .persistent()
            .get(&count_key)
            .unwrap_or(0u64);
        let new_count = count + 1;
        env.storage().persistent().set(&count_key, &new_count);
        env.storage()
            .persistent()
            .extend_ttl(&count_key, MAX_TTL, MAX_TTL);

        // Default spending policy
        let policy = SpendingPolicy {
            agent_address: agent_address.clone(),
            max_per_tx_stroops: 10_000_000_000i128,   // 1,000,000 USDC stroops
            max_per_day_stroops: 100_000_000_000i128,  // 10,000,000 USDC stroops
            allowed_categories: vec![&env],
            min_score_to_earn: 0,
            daily_spent_stroops: 0,
            last_reset_ledger: now,
        };
        let policy_key = DataKey::Policy(agent_address);
        env.storage().persistent().set(&policy_key, &policy);
        env.storage()
            .persistent()
            .extend_ttl(&policy_key, MAX_TTL, MAX_TTL);

        new_count
    }

    // Get agent entry
    pub fn get_agent(env: Env, agent_address: Address) -> Option<AgentEntry> {
        env.storage()
            .persistent()
            .get(&DataKey::Agent(agent_address))
    }

    // Get spending policy with automatic daily reset
    pub fn get_policy(env: Env, agent_address: Address) -> Option<SpendingPolicy> {
        let key = DataKey::Policy(agent_address.clone());
        if let Some(mut policy) = env.storage().persistent().get::<DataKey, SpendingPolicy>(&key) {
            let (daily_spent, last_reset) = Self::get_daily_spend_with_reset(&env, &policy);
            policy.daily_spent_stroops = daily_spent;
            policy.last_reset_ledger = last_reset;
            Some(policy)
        } else {
            None
        }
    }

    // Get score for an agent
    pub fn get_score(env: Env, agent_address: Address) -> i32 {
        env.storage()
            .persistent()
            .get::<DataKey, AgentEntry>(&DataKey::Agent(agent_address))
            .map(|a| a.score)
            .unwrap_or(-1)
    }

    // Check if agent is registered
    pub fn is_registered(env: Env, agent_address: Address) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Agent(agent_address))
    }

    // Check if agent is eligible (active, not flagged, score >= min)
    pub fn is_eligible(env: Env, agent_address: Address, min_score: i32) -> bool {
        env.storage()
            .persistent()
            .get::<DataKey, AgentEntry>(&DataKey::Agent(agent_address))
            .map(|a| a.active && !a.flagged && a.score >= min_score)
            .unwrap_or(false)
    }

    // Check if a transaction is allowed under the spending policy
    // Returns true if allowed, false otherwise
    pub fn check_spending_allowed(
        env: Env,
        agent_address: Address,
        amount_stroops: i128,
    ) -> bool {
        let key = DataKey::Policy(agent_address.clone());
        let policy = match env.storage().persistent().get::<DataKey, SpendingPolicy>(&key) {
            Some(p) => p,
            None => return false,
        };
        let agent = match env
            .storage()
            .persistent()
            .get::<DataKey, AgentEntry>(&DataKey::Agent(agent_address))
        {
            Some(a) => a,
            None => return false,
        };

        if !agent.active || agent.flagged {
            return false;
        }

        if amount_stroops > policy.max_per_tx_stroops {
            return false;
        }

        let (daily_spent, _) = Self::get_daily_spend_with_reset(&env, &policy);
        daily_spent + amount_stroops <= policy.max_per_day_stroops
    }

    // Record a payment outcome — updates score, stats, and daily spend
    // Only the service provider (caller) may record a payment for their service.
    pub fn record_payment(
        env: Env,
        agent_address: Address,
        service_id: u64,
        amount_stroops: i128,
        success: bool,
        caller: Address,
    ) {
        caller.require_auth();

        // Cross-contract check: caller must be the service's registered provider
        let registry_contract: Address = env
            .storage()
            .persistent()
            .get(&DataKey::RegistryContract)
            .expect("registry contract not set — call init() first");
        let service: ServiceEntry = env.invoke_contract(
            &registry_contract,
            &Symbol::new(&env, "get_service"),
            vec![&env, service_id.into_val(&env)],
        );
        if service.provider != caller {
            panic!("unauthorized: caller is not the service provider");
        }

        let agent_key = DataKey::Agent(agent_address.clone());
        let mut agent: AgentEntry = env
            .storage()
            .persistent()
            .get(&agent_key)
            .expect("agent not found");

        // Load policy for min_score_to_earn enforcement and daily spend update
        let policy_key = DataKey::Policy(agent_address.clone());
        let policy: SpendingPolicy = env
            .storage()
            .persistent()
            .get(&policy_key)
            .expect("policy not found");

        agent.total_payments += 1;
        agent.total_volume_stroops += amount_stroops;
        agent.last_active = env.ledger().sequence() as u64;

        if success {
            agent.successful_payments += 1;
            // Enforce min_score_to_earn: agents below the threshold do not gain
            // score from successful payments, though payment stats are still recorded.
            if agent.score >= policy.min_score_to_earn {
                agent.score = (agent.score + SCORE_SUCCESS).min(MAX_SCORE);
            }
        } else {
            agent.failed_payments += 1;
            agent.score = (agent.score + SCORE_FAILURE).max(0);
        }

        env.storage().persistent().set(&agent_key, &agent);
        env.storage()
            .persistent()
            .extend_ttl(&agent_key, MAX_TTL, MAX_TTL);

        // Update daily spend in policy using helper
        let updated_policy = if success {
            Self::update_daily_spend(&env, policy, amount_stroops)
        } else {
            // Only update if success, but still apply reset logic if needed
            let (daily_spent, last_reset) = Self::get_daily_spend_with_reset(&env, &policy);
            SpendingPolicy {
                daily_spent_stroops: daily_spent,
                last_reset_ledger: last_reset,
                ..policy
            }
        };

        env.storage().persistent().set(&policy_key, &updated_policy);
        env.storage()
            .persistent()
            .extend_ttl(&policy_key, MAX_TTL, MAX_TTL);
    }

    // Flag an agent (admin-only)
    pub fn flag_agent(env: Env, agent_address: Address, reason: String, caller: Address) {
        caller.require_auth();

        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("admin not set — call initialize() first");

        if caller != admin {
            panic!("unauthorized");
        }

        let key = DataKey::Agent(agent_address);
        let mut agent: AgentEntry = env
            .storage()
            .persistent()
            .get(&key)
            .expect("agent not found");

        agent.flagged = true;
        agent.flag_reason = reason;
        agent.score = (agent.score + FLAG_PENALTY).max(0);

        env.storage().persistent().set(&key, &agent);
        env.storage()
            .persistent()
            .extend_ttl(&key, MAX_TTL, MAX_TTL);
    }

    // Deactivate agent (owner only)
    pub fn deactivate_agent(env: Env, agent_address: Address, caller: Address) {
        caller.require_auth();

        let key = DataKey::Agent(agent_address);
        let mut agent: AgentEntry = env
            .storage()
            .persistent()
            .get(&key)
            .expect("agent not found");

        if agent.owner != caller {
            panic!("unauthorized");
        }

        agent.active = false;
        env.storage().persistent().set(&key, &agent);
        env.storage()
            .persistent()
            .extend_ttl(&key, MAX_TTL, MAX_TTL);
    }

    // Admin deactivate agent (can deactivate any agent regardless of ownership)
    pub fn admin_deactivate_agent(env: Env, agent_address: Address, caller: Address) {
        caller.require_auth();

        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("admin not set — call initialize() first");

        if caller != admin {
            panic!("unauthorized");
        }

        let key = DataKey::Agent(agent_address);
        let mut agent: AgentEntry = env
            .storage()
            .persistent()
            .get(&key)
            .expect("agent not found");

        agent.active = false;
        env.storage().persistent().set(&key, &agent);
        env.storage()
            .persistent()
            .extend_ttl(&key, MAX_TTL, MAX_TTL);
    }

    // Get the current admin address
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("admin not set — call initialize() first")
    }

    // Transfer admin role to a new address (caller must be current admin)
    pub fn transfer_admin(env: Env, new_admin: Address, caller: Address) {
        caller.require_auth();

        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("admin not set — call initialize() first");

        if caller != admin {
            panic!("unauthorized");
        }

        env.storage()
            .persistent()
            .set(&DataKey::Admin, &new_admin);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Admin, MAX_TTL, MAX_TTL);
    }

    // List agents (paginated by limit)
    pub fn list_agents(env: Env, limit: u32) -> Vec<AgentEntry> {
        let ids_key = DataKey::AgentIds;
        let ids: Vec<Address> = env
            .storage()
            .persistent()
            .get(&ids_key)
            .unwrap_or_else(|| vec![&env]);

        let mut result: Vec<AgentEntry> = vec![&env];
        let max = (limit as usize).min(ids.len() as usize);
        for i in 0..max {
            let addr = ids.get(i as u32).unwrap();
            if let Some(agent) = env
                .storage()
                .persistent()
                .get::<DataKey, AgentEntry>(&DataKey::Agent(addr))
            {
                result.push_back(agent);
            }
        }
        result
    }

    // List a single page of agents in registration order (avoids O(n) reads for large sets)
    pub fn list_agents_page(env: Env, page: u32, page_size: u32) -> Vec<AgentEntry> {
        let ids_key = DataKey::AgentIds;
        let ids: Vec<Address> = env
            .storage()
            .persistent()
            .get(&ids_key)
            .unwrap_or_else(|| vec![&env]);

        let mut result: Vec<AgentEntry> = vec![&env];
        let total = ids.len() as usize;
        let start = (page as usize).saturating_mul(page_size as usize);
        if start >= total {
            return result;
        }
        let end = (start + page_size as usize).min(total);
        for i in start..end {
            let addr = ids.get(i as u32).unwrap();
            if let Some(agent) = env
                .storage()
                .persistent()
                .get::<DataKey, AgentEntry>(&DataKey::Agent(addr))
            {
                result.push_back(agent);
            }
        }
        result
    }

    // Get total agent count
    pub fn get_agent_count(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::AgentCount)
            .unwrap_or(0u64)
    }

    // Update spending policy for an agent (owner only)
    pub fn update_policy(
        env: Env,
        agent_address: Address,
        max_per_tx_stroops: i128,
        max_per_day_stroops: i128,
        allowed_categories: Vec<String>,
        min_score_to_earn: i32,
        caller: Address,
    ) {
        caller.require_auth();

        let agent_key = DataKey::Agent(agent_address.clone());
        let agent: AgentEntry = env
            .storage()
            .persistent()
            .get(&agent_key)
            .expect("agent not found");

        if agent.owner != caller {
            panic!("unauthorized");
        }

        let policy_key = DataKey::Policy(agent_address.clone());
        let existing: Option<SpendingPolicy> = env.storage().persistent().get(&policy_key);

        let now = env.ledger().sequence() as u64;
        let (daily_spent, last_reset) = existing
            .map(|p| Self::get_daily_spend_with_reset(&env, &p))
            .unwrap_or((0i128, now));

        let policy = SpendingPolicy {
            agent_address,
            max_per_tx_stroops,
            max_per_day_stroops,
            allowed_categories,
            min_score_to_earn,
            daily_spent_stroops: daily_spent,
            last_reset_ledger: last_reset,
        };

        env.storage().persistent().set(&policy_key, &policy);
        env.storage()
            .persistent()
            .extend_ttl(&policy_key, MAX_TTL, MAX_TTL);
    }

    // Get the current scoring configuration constants
    pub fn get_scoring_config(env: Env) -> ScoringConfig {
        ScoringConfig {
            initial_score: INITIAL_SCORE,
            score_success: SCORE_SUCCESS,
            score_failure: SCORE_FAILURE,
            flag_penalty: FLAG_PENALTY,
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::testutils::Ledger as _;

    // Mock registry contract for testing
    #[contract]
    pub struct MockRegistry;

    #[contractimpl]
    impl MockRegistry {
        pub fn get_service(env: Env, id: u64) -> ServiceEntry {
            // Return a mock service with a generated provider
            ServiceEntry {
                id,
                name: String::from_str(&env, "Test Service"),
                description: String::from_str(&env, "Test Description"),
                endpoint: String::from_str(&env, "http://test.com"),
                price_usdc: String::from_str(&env, "100"),
                category: String::from_str(&env, "test"),
                provider: Address::generate(&env),
                reputation: 100,
                active: true,
                registered_at: env.ledger().sequence() as u64,
            }
        }
    }

    fn setup_agent(env: &Env, contract_id: &Address, agent_addr: &Address, owner: &Address) {
        let client = LodestarAgentsClient::new(env, contract_id);
        client.register_agent(
            agent_addr,
            &String::from_str(env, "Test Agent"),
            &String::from_str(env, "A test agent description"),
            owner,
        );
    }

    fn setup_with_registry(env: &Env) -> (Address, Address) {
        // Deploy mock registry
        let registry_id = env.register_contract(None, MockRegistry);
        
        // Deploy agents contract with admin
        let admin = Address::generate(env);
        let contract_id = env.register(LodestarAgents, (admin.clone(),));
        let client = LodestarAgentsClient::new(env, &contract_id);
        
        // Initialize with registry
        client.init(&registry_id);
        
        (contract_id, admin)
    }

    #[test]
    fn test_constructor_sets_admin() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let contract_id = env.register(LodestarAgents, (admin.clone(),));
        let client = LodestarAgentsClient::new(&env, &contract_id);

        assert_eq!(client.get_admin(), admin);
    }

    #[test]
    fn test_get_admin_returns_constructor_admin() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let contract_id = env.register(LodestarAgents, (admin.clone(),));
        let client = LodestarAgentsClient::new(&env, &contract_id);

        assert_eq!(client.get_admin(), admin);
    }

    #[test]
    fn test_flag_agent_owner_cannot_flag() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register(LodestarAgents, (admin.clone(),));
        let client = LodestarAgentsClient::new(&env, &contract_id);

        let agent_addr = Address::generate(&env);
        let owner = Address::generate(&env);
        setup_agent(&env, &contract_id, &agent_addr, &owner);

        assert!(client
            .try_flag_agent(
                &agent_addr,
                &String::from_str(&env, "bad behavior"),
                &owner,
            )
            .is_err());
    }

    #[test]
    fn test_flag_agent_succeeds_with_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register(LodestarAgents, (admin.clone(),));
        let client = LodestarAgentsClient::new(&env, &contract_id);

        let agent_addr = Address::generate(&env);
        let owner = Address::generate(&env);
        setup_agent(&env, &contract_id, &agent_addr, &owner);

        client.flag_agent(
            &agent_addr,
            &String::from_str(&env, "violation of terms"),
            &admin,
        );

        let agent = client.get_agent(&agent_addr).unwrap();
        assert!(agent.flagged);
        assert_eq!(
            agent.flag_reason,
            String::from_str(&env, "violation of terms")
        );
        assert!(agent.score < INITIAL_SCORE);
    }

    #[test]
    fn test_admin_deactivate_agent_succeeds() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register(LodestarAgents, (admin.clone(),));
        let client = LodestarAgentsClient::new(&env, &contract_id);

        let agent_addr = Address::generate(&env);
        let owner = Address::generate(&env);
        setup_agent(&env, &contract_id, &agent_addr, &owner);

        client.admin_deactivate_agent(&agent_addr, &admin);

        let agent = client.get_agent(&agent_addr).unwrap();
        assert!(!agent.active);
    }

    #[test]
    fn test_admin_deactivate_agent_requires_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register(LodestarAgents, (admin.clone(),));
        let client = LodestarAgentsClient::new(&env, &contract_id);

        let agent_addr = Address::generate(&env);
        let owner = Address::generate(&env);
        setup_agent(&env, &contract_id, &agent_addr, &owner);

        let non_admin = Address::generate(&env);
        assert!(client
            .try_admin_deactivate_agent(&agent_addr, &non_admin)
            .is_err());
    }

    #[test]
    fn test_deactivate_agent_still_works_for_owner() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register(LodestarAgents, (admin.clone(),));
        let client = LodestarAgentsClient::new(&env, &contract_id);

        let agent_addr = Address::generate(&env);
        let owner = Address::generate(&env);
        setup_agent(&env, &contract_id, &agent_addr, &owner);

        client.deactivate_agent(&agent_addr, &owner);

        let agent = client.get_agent(&agent_addr).unwrap();
        assert!(!agent.active);
    }

    #[test]
    fn test_transfer_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register(LodestarAgents, (admin.clone(),));
        let client = LodestarAgentsClient::new(&env, &contract_id);

        let new_admin = Address::generate(&env);
        client.transfer_admin(&new_admin, &admin);

        assert_eq!(client.get_admin(), new_admin);
    }

    #[test]
    fn test_transfer_admin_requires_current_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register(LodestarAgents, (admin.clone(),));
        let client = LodestarAgentsClient::new(&env, &contract_id);

        let new_admin = Address::generate(&env);
        let impostor = Address::generate(&env);

        assert!(client.try_transfer_admin(&new_admin, &impostor).is_err());
    }

    #[test]
    fn test_flag_agent_fails_for_non_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register(LodestarAgents, (admin.clone(),));
        let client = LodestarAgentsClient::new(&env, &contract_id);

        let agent_addr = Address::generate(&env);
        let owner = Address::generate(&env);
        setup_agent(&env, &contract_id, &agent_addr, &owner);

        let caller = Address::generate(&env);
        assert!(client
            .try_flag_agent(
                &agent_addr,
                &String::from_str(&env, "reason"),
                &caller,
            )
            .is_err());
    }

    #[test]
    fn test_flag_agent_requires_auth() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let contract_id = env.register(LodestarAgents, (admin.clone(),));
        let client = LodestarAgentsClient::new(&env, &contract_id);

        let agent_addr = Address::generate(&env);
        let owner = Address::generate(&env);
        // mock_all_auths during setup so register_agent succeeds
        env.mock_all_auths();
        setup_agent(&env, &contract_id, &agent_addr, &owner);

        // Clear auths so require_auth in flag_agent fails
        env.set_auths(&[]);
        assert!(client
            .try_flag_agent(
                &agent_addr,
                &String::from_str(&env, "reason"),
                &admin,
            )
            .is_err());
    }

    #[test]
    fn test_get_scoring_config() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let contract_id = env.register(LodestarAgents, (admin.clone(),));
        let client = LodestarAgentsClient::new(&env, &contract_id);

        let config = client.get_scoring_config();
        assert_eq!(config.initial_score, INITIAL_SCORE);
        assert_eq!(config.score_success, SCORE_SUCCESS);
        assert_eq!(config.score_failure, SCORE_FAILURE);
        assert_eq!(config.flag_penalty, FLAG_PENALTY);
    }

    /// Seed a non-zero `daily_spent_stroops` directly into contract storage.
    ///
    /// soroban-sdk 22 requires all `env.storage()` writes to happen inside a
    /// contract context.  We use `env.as_contract(contract_id, || { ... })` so
    /// the write is attributed to the agents contract and passes the SDK's
    /// context guard.
    fn seed_daily_spent(
        env: &Env,
        contract_id: &Address,
        agent_addr: &Address,
        _owner: &Address,
        spent: i128,
        _max_per_day: i128,
    ) {
        let key = DataKey::Policy(agent_addr.clone());
        env.as_contract(contract_id, || {
            let existing: SpendingPolicy = env
                .storage()
                .persistent()
                .get(&key)
                .expect("policy must exist before seeding spend");
            let seeded = SpendingPolicy {
                daily_spent_stroops: spent,
                ..existing
            };
            env.storage().persistent().set(&key, &seeded);
            env.storage()
                .persistent()
                .extend_ttl(&key, TEST_MAX_TTL, TEST_MAX_TTL);
        });
    }

    /// Exact-threshold: at ledger == last_reset + DAY_LEDGERS the counter clears.
    ///
    /// Sequence:
    ///   ledger 100  — set policy, seed 500 stroops of daily spend
    ///   ledger 100 + DAY_LEDGERS - 1  — one ledger BEFORE threshold: spend preserved
    ///   ledger 100 + DAY_LEDGERS      — AT threshold: spend cleared, last_reset updated
    #[test]
    fn test_daily_reset_boundary_exact_threshold() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _admin) = setup_with_registry(&env);
        let client = LodestarAgentsClient::new(&env, &contract_id);

        let agent_addr = Address::generate(&env);
        let owner = Address::generate(&env);
        setup_agent(&env, &contract_id, &agent_addr, &owner);

        let start_ledger: u32 = 100;
        env.ledger().with_mut(|li| {
            li.sequence_number = start_ledger;
            li.min_persistent_entry_ttl = TEST_MAX_TTL;
            li.min_temp_entry_ttl = TEST_MAX_TTL;
        });

        let max_per_day = 1000i128;
        client.update_policy(&agent_addr, &1000i128, &max_per_day, &vec![&env], &0, &owner);

        // Seed non-zero daily spend so a reset is detectable
        let seeded_spend = 500i128;
        seed_daily_spent(&env, &contract_id, &agent_addr, &owner, seeded_spend, max_per_day);

        // Confirm seed is in storage
        let p = client.get_policy(&agent_addr).unwrap();
        assert_eq!(p.daily_spent_stroops, seeded_spend, "seed should be in storage");
        assert_eq!(p.last_reset_ledger, start_ledger as u64);

        // ── One ledger BEFORE threshold — spend must be preserved ──────────
        let before_threshold = start_ledger + DAY_LEDGERS as u32 - 1;
        env.ledger().with_mut(|li| {
            li.sequence_number = before_threshold;
            li.min_persistent_entry_ttl = TEST_MAX_TTL;
            li.min_temp_entry_ttl = TEST_MAX_TTL;
        });

        let p_before = client.get_policy(&agent_addr).unwrap();
        assert_eq!(
            p_before.daily_spent_stroops, seeded_spend,
            "spend must NOT be cleared one ledger before threshold"
        );
        assert_eq!(p_before.last_reset_ledger, start_ledger as u64);

        // ── AT threshold — spend must be cleared, last_reset updated ───────
        let at_threshold = start_ledger + DAY_LEDGERS as u32;
        env.ledger().with_mut(|li| {
            li.sequence_number = at_threshold;
            li.min_persistent_entry_ttl = TEST_MAX_TTL;
            li.min_temp_entry_ttl = TEST_MAX_TTL;
        });

        let p_at = client.get_policy(&agent_addr).unwrap();
        assert_eq!(
            p_at.daily_spent_stroops, 0,
            "spend must be cleared at threshold"
        );
        assert_eq!(
            p_at.last_reset_ledger, at_threshold as u64,
            "last_reset_ledger must advance to current ledger on reset"
        );
    }

    /// One-before-and-after: explicitly verifies the off-by-one boundary with
    /// non-zero accumulated spend, using start_ledger = 100.
    #[test]
    fn test_daily_reset_boundary_one_before_and_after() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _admin) = setup_with_registry(&env);
        let client = LodestarAgentsClient::new(&env, &contract_id);

        let agent_addr = Address::generate(&env);
        let owner = Address::generate(&env);
        setup_agent(&env, &contract_id, &agent_addr, &owner);

        let start_ledger: u32 = 100;
        env.ledger().with_mut(|li| {
            li.sequence_number = start_ledger;
            li.min_persistent_entry_ttl = TEST_MAX_TTL;
            li.min_temp_entry_ttl = TEST_MAX_TTL;
        });

        let max_per_day = 1000i128;
        client.update_policy(&agent_addr, &1000i128, &max_per_day, &vec![&env], &0, &owner);

        // Seed non-zero daily spend
        let seeded_spend = 300i128;
        seed_daily_spent(&env, &contract_id, &agent_addr, &owner, seeded_spend, max_per_day);

        // ── One before threshold: no reset ──────────────────────────────────
        let one_before = start_ledger + DAY_LEDGERS as u32 - 1;
        env.ledger().with_mut(|li| {
            li.sequence_number = one_before;
            li.min_persistent_entry_ttl = TEST_MAX_TTL;
            li.min_temp_entry_ttl = TEST_MAX_TTL;
        });

        let p_before = client.get_policy(&agent_addr).unwrap();
        assert_eq!(
            p_before.daily_spent_stroops, seeded_spend,
            "spend must NOT be cleared one ledger before threshold"
        );
        assert_eq!(p_before.last_reset_ledger, start_ledger as u64);

        // ── At threshold: reset fires ───────────────────────────────────────
        let at_threshold = start_ledger + DAY_LEDGERS as u32;
        env.ledger().with_mut(|li| {
            li.sequence_number = at_threshold;
            li.min_persistent_entry_ttl = TEST_MAX_TTL;
            li.min_temp_entry_ttl = TEST_MAX_TTL;
        });

        let p_after = client.get_policy(&agent_addr).unwrap();
        assert_eq!(
            p_after.daily_spent_stroops, 0,
            "spend must be zero after reset"
        );
        assert_eq!(
            p_after.last_reset_ledger, at_threshold as u64,
            "last_reset_ledger must advance to current ledger on reset"
        );
    }

    /// update_policy preserves daily_spent within the window and resets it when
    /// called after the window has elapsed.
    #[test]
    fn test_update_policy_handles_reset_correctly() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _admin) = setup_with_registry(&env);
        let client = LodestarAgentsClient::new(&env, &contract_id);

        let agent_addr = Address::generate(&env);
        let owner = Address::generate(&env);
        setup_agent(&env, &contract_id, &agent_addr, &owner);

        let start_ledger: u32 = 1000;
        env.ledger().with_mut(|li| {
            li.sequence_number = start_ledger;
            li.min_persistent_entry_ttl = TEST_MAX_TTL;
            li.min_temp_entry_ttl = TEST_MAX_TTL;
        });

        let max_per_day = 1000i128;
        client.update_policy(&agent_addr, &1000i128, &max_per_day, &vec![&env], &0, &owner);

        // Seed non-zero spend
        let seeded_spend = 400i128;
        seed_daily_spent(&env, &contract_id, &agent_addr, &owner, seeded_spend, max_per_day);

        let p = client.get_policy(&agent_addr).unwrap();
        assert_eq!(p.daily_spent_stroops, seeded_spend);
        assert_eq!(p.last_reset_ledger, start_ledger as u64);

        // ── Calling update_policy within the window keeps daily_spent ───────
        let mid_window = start_ledger + DAY_LEDGERS as u32 - 1;
        env.ledger().with_mut(|li| {
            li.sequence_number = mid_window;
            li.min_persistent_entry_ttl = TEST_MAX_TTL;
            li.min_temp_entry_ttl = TEST_MAX_TTL;
        });
        client.update_policy(&agent_addr, &1000i128, &max_per_day, &vec![&env], &0, &owner);
        let p_mid = client.get_policy(&agent_addr).unwrap();
        assert_eq!(
            p_mid.daily_spent_stroops, seeded_spend,
            "update_policy within window must not clear daily_spent"
        );
        assert_eq!(p_mid.last_reset_ledger, start_ledger as u64);

        // ── Calling update_policy at/after threshold resets spend ───────────
        let after_threshold = start_ledger + DAY_LEDGERS as u32;
        env.ledger().with_mut(|li| {
            li.sequence_number = after_threshold;
            li.min_persistent_entry_ttl = TEST_MAX_TTL;
            li.min_temp_entry_ttl = TEST_MAX_TTL;
        });
        client.update_policy(&agent_addr, &1000i128, &max_per_day, &vec![&env], &0, &owner);

        let p_after = client.get_policy(&agent_addr).unwrap();
        assert_eq!(
            p_after.daily_spent_stroops, 0,
            "update_policy at/after threshold must clear daily_spent"
        );
        assert_eq!(
            p_after.last_reset_ledger, after_threshold as u64,
            "last_reset_ledger must advance to current ledger after reset"
        );
    }

    /// Consecutive days: each time the window elapses the counter resets to 0
    /// and last_reset_ledger advances to the current ledger.
    #[test]
    fn test_consecutive_days_reset_logic() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _admin) = setup_with_registry(&env);
        let client = LodestarAgentsClient::new(&env, &contract_id);

        let agent_addr = Address::generate(&env);
        let owner = Address::generate(&env);

        let start_ledger: u32 = 1;
        env.ledger().with_mut(|li| {
            li.sequence_number = start_ledger;
            li.min_persistent_entry_ttl = TEST_MAX_TTL;
            li.min_temp_entry_ttl = TEST_MAX_TTL;
        });

        setup_agent(&env, &contract_id, &agent_addr, &owner);

        let max_per_day = 1000i128;
        client.update_policy(&agent_addr, &1000i128, &max_per_day, &vec![&env], &0, &owner);

        // Confirm initial last_reset_ledger = start_ledger (register_agent and
        // update_policy both run at start_ledger = 1)
        let p0 = client.get_policy(&agent_addr).unwrap();
        assert_eq!(p0.last_reset_ledger, start_ledger as u64);

        // Seed spend for day 1
        let spend_day1 = 200i128;
        seed_daily_spent(&env, &contract_id, &agent_addr, &owner, spend_day1, max_per_day);

        // ── Day 2: first DAY_LEDGERS boundary ───────────────────────────────
        let day2_ledger = start_ledger + DAY_LEDGERS as u32;
        env.ledger().with_mut(|li| {
            li.sequence_number = day2_ledger;
            li.min_persistent_entry_ttl = TEST_MAX_TTL;
            li.min_temp_entry_ttl = TEST_MAX_TTL;
        });

        let p_day2 = client.get_policy(&agent_addr).unwrap();
        assert_eq!(p_day2.daily_spent_stroops, 0, "day 2: spend must reset");
        assert_eq!(
            p_day2.last_reset_ledger, day2_ledger as u64,
            "day 2: last_reset_ledger must advance"
        );

        // Note: get_policy only returns a view; the reset is not persisted until
        // the next write (update_policy / record_payment).  Seed spend via
        // direct storage write against the *new* last_reset value so day-3
        // reset is based on the correct anchor.
        let key = DataKey::Policy(agent_addr.clone());
        env.as_contract(&contract_id, || {
            let current: SpendingPolicy = env.storage().persistent().get(&key).unwrap();
            env.storage().persistent().set(&key, &SpendingPolicy {
                daily_spent_stroops: 150i128,
                last_reset_ledger: day2_ledger as u64,
                ..current
            });
            env.storage().persistent().extend_ttl(&key, TEST_MAX_TTL, TEST_MAX_TTL);
        });

        // ── Day 3: second DAY_LEDGERS boundary ──────────────────────────────
        let day3_ledger = day2_ledger + DAY_LEDGERS as u32;
        env.ledger().with_mut(|li| {
            li.sequence_number = day3_ledger;
            li.min_persistent_entry_ttl = TEST_MAX_TTL;
            li.min_temp_entry_ttl = TEST_MAX_TTL;
        });

        let p_day3 = client.get_policy(&agent_addr).unwrap();
        assert_eq!(p_day3.daily_spent_stroops, 0, "day 3: spend must reset");
        assert_eq!(
            p_day3.last_reset_ledger, day3_ledger as u64,
            "day 3: last_reset_ledger must advance"
        );
    }

    /// One-ledger-before-threshold: verifies the guard condition is strict (>=),
    /// so ledger == last_reset + DAY_LEDGERS - 1 does NOT trigger a reset.
    #[test]
    fn test_no_reset_one_ledger_before_threshold() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _admin) = setup_with_registry(&env);
        let client = LodestarAgentsClient::new(&env, &contract_id);

        let agent_addr = Address::generate(&env);
        let owner = Address::generate(&env);
        setup_agent(&env, &contract_id, &agent_addr, &owner);

        let start_ledger: u32 = 50;
        env.ledger().with_mut(|li| {
            li.sequence_number = start_ledger;
            li.min_persistent_entry_ttl = TEST_MAX_TTL;
            li.min_temp_entry_ttl = TEST_MAX_TTL;
        });

        let max_per_day = 1000i128;
        client.update_policy(&agent_addr, &1000i128, &max_per_day, &vec![&env], &0, &owner);

        // Seed non-zero spend
        let seeded_spend = 750i128;
        seed_daily_spent(&env, &contract_id, &agent_addr, &owner, seeded_spend, max_per_day);

        // Advance to exactly one ledger before the threshold — must NOT reset
        let one_before = start_ledger + DAY_LEDGERS as u32 - 1;
        env.ledger().with_mut(|li| {
            li.sequence_number = one_before;
            li.min_persistent_entry_ttl = TEST_MAX_TTL;
            li.min_temp_entry_ttl = TEST_MAX_TTL;
        });

        let p = client.get_policy(&agent_addr).unwrap();
        assert_eq!(
            p.daily_spent_stroops, seeded_spend,
            "daily_spent must NOT be cleared one ledger before the threshold"
        );
        assert_eq!(
            p.last_reset_ledger, start_ledger as u64,
            "last_reset_ledger must not change when no reset fires"
        );

        // Also verify check_spending_allowed sees the accumulated spend
        // (seeded_spend = 750, max = 1000, so 251 should be allowed, 251+750=1001 blocked)
        assert!(
            client.check_spending_allowed(&agent_addr, &250),
            "250 should still fit within the daily budget"
        );
        assert!(
            !client.check_spending_allowed(&agent_addr, &251),
            "251 should be rejected because 750+251 > 1000"
        );
    }

    #[test]
    fn test_spending_allowance_respects_reset() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _admin) = setup_with_registry(&env);
        let client = LodestarAgentsClient::new(&env, &contract_id);

        let agent_addr = Address::generate(&env);
        let owner = Address::generate(&env);
        setup_agent(&env, &contract_id, &agent_addr, &owner);

        let max_per_day = 1000i128;
        let max_per_tx = 1000i128; 
        
        env.ledger().with_mut(|li| {
            li.sequence_number = 1;
            li.min_persistent_entry_ttl = TEST_MAX_TTL;
            li.min_temp_entry_ttl = TEST_MAX_TTL;
        });

        client.update_policy(
            &agent_addr,
            &max_per_tx,
            &max_per_day,
            &vec![&env],
            &0,
            &owner,
        );

        // Initially should allow up to max_per_day
        assert!(client.check_spending_allowed(&agent_addr, &500));
        assert!(client.check_spending_allowed(&agent_addr, &1000));
        assert!(!client.check_spending_allowed(&agent_addr, &1001));

        // Advance to next day
        env.ledger().with_mut(|li| {
            li.sequence_number = (DAY_LEDGERS + 1) as u32;
            li.min_persistent_entry_ttl = TEST_MAX_TTL;
            li.min_temp_entry_ttl = TEST_MAX_TTL;
        });
        
        // Should allow full amount again after reset
        assert!(client.check_spending_allowed(&agent_addr, &1000));
    }
}
