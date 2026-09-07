#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, vec, Address, Env, IntoVal, String, Symbol, Vec,
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
    pub pay_to: String,
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
    /// Cumulative value (in stroops) of successful payments only. Failed
    /// payments do not count toward volume since no value actually moved.
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
    fn get_daily_spend_with_reset(env: &Env, policy: &SpendingPolicy) -> (i128, u64) {
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

        env.events().publish(
            (
                Symbol::new(&env, "agents"),
                Symbol::new(&env, "initialized"),
                registry_contract.clone(),
            ),
            (registry_contract,),
        );
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
        env.storage()
            .persistent()
            .extend_ttl(&key, MAX_TTL, MAX_TTL);

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
        let count: u64 = env.storage().persistent().get(&count_key).unwrap_or(0u64);
        let new_count = count + 1;
        env.storage().persistent().set(&count_key, &new_count);
        env.storage()
            .persistent()
            .extend_ttl(&count_key, MAX_TTL, MAX_TTL);

        // Default spending policy
        let policy = SpendingPolicy {
            agent_address: agent_address.clone(),
            max_per_tx_stroops: 10_000_000_000i128, // 1,000,000 USDC stroops
            max_per_day_stroops: 100_000_000_000i128, // 10,000,000 USDC stroops
            allowed_categories: vec![&env],
            min_score_to_earn: 0,
            daily_spent_stroops: 0,
            last_reset_ledger: now,
        };
        let policy_key = DataKey::Policy(agent_address.clone());
        env.storage().persistent().set(&policy_key, &policy);
        env.storage()
            .persistent()
            .extend_ttl(&policy_key, MAX_TTL, MAX_TTL);

        env.events().publish(
            (
                Symbol::new(&env, "agents"),
                Symbol::new(&env, "registered"),
                agent_address,
            ),
            (
                entry.owner.clone(),
                entry.name.clone(),
                entry.description.clone(),
                entry.score,
            ),
        );

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
        if let Some(mut policy) = env
            .storage()
            .persistent()
            .get::<DataKey, SpendingPolicy>(&key)
        {
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
    pub fn check_spending_allowed(env: Env, agent_address: Address, amount_stroops: i128) -> bool {
        let key = DataKey::Policy(agent_address.clone());
        let policy = match env
            .storage()
            .persistent()
            .get::<DataKey, SpendingPolicy>(&key)
        {
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

        let old_score = agent.score;

        agent.total_payments += 1;
        agent.last_active = env.ledger().sequence() as u64;

        if success {
            agent.successful_payments += 1;
            agent.total_volume_stroops += amount_stroops;
            // Enforce min_score_to_earn: agents below the threshold do not gain
            // score from successful payments, though payment stats are still recorded.
            if agent.score >= policy.min_score_to_earn {
                agent.score = (agent.score + SCORE_SUCCESS).min(MAX_SCORE);
            }
        } else {
            agent.failed_payments += 1;
            agent.score = (agent.score + SCORE_FAILURE).max(0);
        }

        let new_score = agent.score;

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

        env.events().publish(
            (
                Symbol::new(&env, "agents"),
                Symbol::new(&env, "payment"),
                agent_address,
            ),
            (
                service_id,
                amount_stroops,
                success,
                old_score,
                new_score,
                caller,
            ),
        );
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

        let key = DataKey::Agent(agent_address.clone());
        let mut agent: AgentEntry = env
            .storage()
            .persistent()
            .get(&key)
            .expect("agent not found");

        let old_score = agent.score;

        agent.flagged = true;
        agent.flag_reason = reason.clone();
        agent.score = (agent.score + FLAG_PENALTY).max(0);

        let new_score = agent.score;

        env.storage().persistent().set(&key, &agent);
        env.storage()
            .persistent()
            .extend_ttl(&key, MAX_TTL, MAX_TTL);

        env.events().publish(
            (
                Symbol::new(&env, "agents"),
                Symbol::new(&env, "flagged"),
                agent_address,
            ),
            (caller, reason, old_score, new_score),
        );
    }

    // Deactivate agent (owner only)
    pub fn deactivate_agent(env: Env, agent_address: Address, caller: Address) {
        caller.require_auth();

        let key = DataKey::Agent(agent_address.clone());
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

        env.events().publish(
            (
                Symbol::new(&env, "agents"),
                Symbol::new(&env, "deactivated"),
                agent_address,
            ),
            (caller,),
        );
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

        let key = DataKey::Agent(agent_address.clone());
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

        env.events().publish(
            (
                Symbol::new(&env, "agents"),
                Symbol::new(&env, "deactivated"),
                agent_address,
            ),
            (caller,),
        );
    }

    // Reactivate agent (owner only)
    pub fn reactivate_agent(env: Env, agent_address: Address, caller: Address) {
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

        agent.active = true;
        env.storage().persistent().set(&key, &agent);
        env.storage()
            .persistent()
            .extend_ttl(&key, MAX_TTL, MAX_TTL);
    }

    // Admin reactivate agent (can reactivate any agent regardless of ownership)
    pub fn admin_reactivate_agent(env: Env, agent_address: Address, caller: Address) {
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

        agent.active = true;
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

        env.storage().persistent().set(&DataKey::Admin, &new_admin);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Admin, MAX_TTL, MAX_TTL);

        env.events().publish(
            (
                Symbol::new(&env, "agents"),
                Symbol::new(&env, "admin_transferred"),
                new_admin.clone(),
            ),
            (caller, new_admin),
        );
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
            agent_address: agent_address.clone(),
            max_per_tx_stroops,
            max_per_day_stroops,
            allowed_categories: allowed_categories.clone(),
            min_score_to_earn,
            daily_spent_stroops: daily_spent,
            last_reset_ledger: last_reset,
        };

        env.storage().persistent().set(&policy_key, &policy);
        env.storage()
            .persistent()
            .extend_ttl(&policy_key, MAX_TTL, MAX_TTL);

        env.events().publish(
            (
                Symbol::new(&env, "agents"),
                Symbol::new(&env, "policy_updated"),
                agent_address,
            ),
            (
                caller,
                max_per_tx_stroops,
                max_per_day_stroops,
                allowed_categories,
                min_score_to_earn,
            ),
        );
    }

    // Get the current scoring configuration constants
    pub fn get_scoring_config(_env: Env) -> ScoringConfig {
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
    use soroban_sdk::{
        testutils::{Address as _, Events, Ledger as _},
        vec, Address, FromVal, IntoVal, String, Symbol, Vec,
    };

    // Mock registry contract for testing
    #[contract]
    pub struct MockRegistry;

    #[contracttype]
    #[derive(Clone)]
    pub enum MockDataKey {
        Provider,
    }

    #[contractimpl]
    impl MockRegistry {
        pub fn set_provider(env: Env, provider: Address) {
            env.storage()
                .persistent()
                .set(&MockDataKey::Provider, &provider);
            env.storage().persistent().extend_ttl(
                &MockDataKey::Provider,
                TEST_MAX_TTL,
                TEST_MAX_TTL,
            );
        }

        pub fn set_service(env: Env, id: u64, provider: Address) {
            env.storage().persistent().set(&id, &provider);
            env.storage()
                .persistent()
                .extend_ttl(&id, TEST_MAX_TTL, TEST_MAX_TTL);
        }

        pub fn get_service(env: Env, id: u64) -> ServiceEntry {
            let provider: Address = env
                .storage()
                .persistent()
                .get::<u64, Address>(&id)
                .or_else(|| env.storage().persistent().get(&MockDataKey::Provider))
                .unwrap_or_else(|| Address::generate(&env));
            ServiceEntry {
                id,
                name: String::from_str(&env, "Test Service"),
                description: String::from_str(&env, "Test Description"),
                endpoint: String::from_str(&env, "http://test.com"),
                price_usdc: String::from_str(&env, "100"),
                pay_to: String::from_str(&env, "GPAY_TO_TEST"),
                category: String::from_str(&env, "test"),
                provider,
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
        let registry_id = env.register(MockRegistry, ());

        // Deploy agents contract with admin
        let admin = Address::generate(env);
        let contract_id = env.register(LodestarAgents, (admin.clone(),));
        let client = LodestarAgentsClient::new(env, &contract_id);

        // Initialize with registry
        client.init(&registry_id);

        (contract_id, admin)
    }

    fn setup_with_mock_registry(env: &Env) -> (Address, Address, Address) {
        let registry_id = env.register(MockRegistry, ());
        let admin = Address::generate(env);
        let contract_id = env.register(LodestarAgents, (admin.clone(),));
        let client = LodestarAgentsClient::new(env, &contract_id);
        client.init(&registry_id);
        (contract_id, admin, registry_id)
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
            .try_flag_agent(&agent_addr, &String::from_str(&env, "bad behavior"), &owner,)
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
            .try_flag_agent(&agent_addr, &String::from_str(&env, "reason"), &caller,)
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
            .try_flag_agent(&agent_addr, &String::from_str(&env, "reason"), &admin,)
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
        client.update_policy(
            &agent_addr,
            &1000i128,
            &max_per_day,
            &vec![&env],
            &0,
            &owner,
        );

        // Seed non-zero daily spend so a reset is detectable
        let seeded_spend = 500i128;
        seed_daily_spent(
            &env,
            &contract_id,
            &agent_addr,
            &owner,
            seeded_spend,
            max_per_day,
        );

        // Confirm seed is in storage
        let p = client.get_policy(&agent_addr).unwrap();
        assert_eq!(
            p.daily_spent_stroops, seeded_spend,
            "seed should be in storage"
        );
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
        client.update_policy(
            &agent_addr,
            &1000i128,
            &max_per_day,
            &vec![&env],
            &0,
            &owner,
        );

        // Seed non-zero daily spend
        let seeded_spend = 300i128;
        seed_daily_spent(
            &env,
            &contract_id,
            &agent_addr,
            &owner,
            seeded_spend,
            max_per_day,
        );

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
        client.update_policy(
            &agent_addr,
            &1000i128,
            &max_per_day,
            &vec![&env],
            &0,
            &owner,
        );

        // Seed non-zero spend
        let seeded_spend = 400i128;
        seed_daily_spent(
            &env,
            &contract_id,
            &agent_addr,
            &owner,
            seeded_spend,
            max_per_day,
        );

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
        client.update_policy(
            &agent_addr,
            &1000i128,
            &max_per_day,
            &vec![&env],
            &0,
            &owner,
        );
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
        client.update_policy(
            &agent_addr,
            &1000i128,
            &max_per_day,
            &vec![&env],
            &0,
            &owner,
        );

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
        client.update_policy(
            &agent_addr,
            &1000i128,
            &max_per_day,
            &vec![&env],
            &0,
            &owner,
        );

        // Confirm initial last_reset_ledger = start_ledger (register_agent and
        // update_policy both run at start_ledger = 1)
        let p0 = client.get_policy(&agent_addr).unwrap();
        assert_eq!(p0.last_reset_ledger, start_ledger as u64);

        // Seed spend for day 1
        let spend_day1 = 200i128;
        seed_daily_spent(
            &env,
            &contract_id,
            &agent_addr,
            &owner,
            spend_day1,
            max_per_day,
        );

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
            env.storage().persistent().set(
                &key,
                &SpendingPolicy {
                    daily_spent_stroops: 150i128,
                    last_reset_ledger: day2_ledger as u64,
                    ..current
                },
            );
            env.storage()
                .persistent()
                .extend_ttl(&key, TEST_MAX_TTL, TEST_MAX_TTL);
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
        client.update_policy(
            &agent_addr,
            &1000i128,
            &max_per_day,
            &vec![&env],
            &0,
            &owner,
        );

        // Seed non-zero spend
        let seeded_spend = 750i128;
        seed_daily_spent(
            &env,
            &contract_id,
            &agent_addr,
            &owner,
            seeded_spend,
            max_per_day,
        );

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

    /// A failed payment must not inflate `total_volume_stroops` — no value moved.
    #[test]
    fn test_failed_payment_does_not_count_toward_volume() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _admin) = setup_with_registry(&env);
        let client = LodestarAgentsClient::new(&env, &contract_id);

        let agent_addr = Address::generate(&env);
        let owner = Address::generate(&env);
        setup_agent(&env, &contract_id, &agent_addr, &owner);

        // Set a fixed provider on the mock registry so record_payment auth passes
        let provider = Address::generate(&env);
        let registry_id = env.as_contract(&contract_id, || {
            env.storage()
                .persistent()
                .get::<DataKey, Address>(&DataKey::RegistryContract)
                .expect("registry contract not set")
        });
        let mock_client = MockRegistryClient::new(&env, &registry_id);
        mock_client.set_provider(&provider);

        // Record a failed payment
        client.record_payment(&agent_addr, &1u64, &500i128, &false, &provider);

        let agent = client.get_agent(&agent_addr).unwrap();
        assert_eq!(
            agent.total_volume_stroops, 0,
            "failed payment must not count toward volume"
        );
        assert_eq!(agent.failed_payments, 1);
        assert_eq!(agent.total_payments, 1);
    }

    #[test]
    fn test_init_emits_event() {
        let env = Env::default();
        let registry_id = env.register(MockRegistry, ());
        let admin = Address::generate(&env);
        let contract_id = env.register(LodestarAgents, (admin,));
        let client = LodestarAgentsClient::new(&env, &contract_id);

        client.init(&registry_id);

        let events = env.events().all();
        assert_eq!(events.len(), 1);
        let event = events.get(0).unwrap();
        assert_eq!(
            event.1,
            (
                Symbol::new(&env, "agents"),
                Symbol::new(&env, "initialized"),
                registry_id.clone(),
            )
                .into_val(&env)
        );
        assert_eq!(<(Address,)>::from_val(&env, &event.2), (registry_id,));
    }

    #[test]
    fn test_register_agent_emits_event() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let contract_id = env.register(LodestarAgents, (admin,));
        let client = LodestarAgentsClient::new(&env, &contract_id);

        let agent_addr = Address::generate(&env);
        let owner = Address::generate(&env);
        let name = String::from_str(&env, "Agent Alpha");
        let description = String::from_str(&env, "Autonomous trading agent");

        client.register_agent(&agent_addr, &name, &description, &owner);

        let events = env.events().all();
        assert_eq!(events.len(), 1);
        let event = events.get(0).unwrap();
        assert_eq!(
            event.1,
            (
                Symbol::new(&env, "agents"),
                Symbol::new(&env, "registered"),
                agent_addr.clone(),
            )
                .into_val(&env)
        );
        assert_eq!(
            <(Address, String, String, i32)>::from_val(&env, &event.2),
            (owner, name, description, INITIAL_SCORE)
        );
    }

    #[test]
    fn test_record_payment_success_emits_event() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _admin, registry_id) = setup_with_mock_registry(&env);
        let client = LodestarAgentsClient::new(&env, &contract_id);

        let agent_addr = Address::generate(&env);
        let owner = Address::generate(&env);
        setup_agent(&env, &contract_id, &agent_addr, &owner);
        let service_id = 42u64;
        let provider = Address::generate(&env);
        let mock_client = MockRegistryClient::new(&env, &registry_id);
        mock_client.set_service(&service_id, &provider);

        let initial_events_count = env.events().all().len();

        let amount = 5_000_000i128;
        client.record_payment(&agent_addr, &service_id, &amount, &true, &provider);

        let events = env.events().all();
        assert_eq!(events.len(), initial_events_count + 1);
        let event = events.get(events.len() - 1).unwrap();
        assert_eq!(
            event.1,
            (
                Symbol::new(&env, "agents"),
                Symbol::new(&env, "payment"),
                agent_addr.clone(),
            )
                .into_val(&env)
        );
        assert_eq!(
            <(u64, i128, bool, i32, i32, Address)>::from_val(&env, &event.2),
            (
                service_id,
                amount,
                true,
                INITIAL_SCORE,
                INITIAL_SCORE + SCORE_SUCCESS,
                provider
            )
        );
    }

    #[test]
    fn test_record_payment_failure_emits_event() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _admin, registry_id) = setup_with_mock_registry(&env);
        let client = LodestarAgentsClient::new(&env, &contract_id);

        let agent_addr = Address::generate(&env);
        let owner = Address::generate(&env);
        setup_agent(&env, &contract_id, &agent_addr, &owner);

        let service_id = 1u64;
        let provider = Address::generate(&env);
        let mock_client = MockRegistryClient::new(&env, &registry_id);
        mock_client.set_service(&service_id, &provider);

        let amount = 1_000_000i128;
        client.record_payment(&agent_addr, &service_id, &amount, &false, &provider);

        let events = env.events().all();
        assert_eq!(events.len(), 1);
        let event = events.get(0).unwrap();
        assert_eq!(
            event.1,
            (
                Symbol::new(&env, "agents"),
                Symbol::new(&env, "payment"),
                agent_addr.clone(),
            )
                .into_val(&env)
        );
        assert_eq!(
            <(u64, i128, bool, i32, i32, Address)>::from_val(&env, &event.2),
            (
                service_id,
                amount,
                false,
                INITIAL_SCORE,
                INITIAL_SCORE + SCORE_FAILURE,
                provider
            )
        );
    }

    #[test]
    fn test_record_payment_min_score_to_earn_emits_event() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _admin, registry_id) = setup_with_mock_registry(&env);
        let client = LodestarAgentsClient::new(&env, &contract_id);

        let agent_addr = Address::generate(&env);
        let owner = Address::generate(&env);
        setup_agent(&env, &contract_id, &agent_addr, &owner);

        // Require score >= 500 to earn score increases (agent currently has 100)
        client.update_policy(
            &agent_addr,
            &10_000_000_000i128,
            &100_000_000_000i128,
            &vec![&env],
            &500,
            &owner,
        );

        let service_id = 7u64;
        let provider = Address::generate(&env);
        let mock_client = MockRegistryClient::new(&env, &registry_id);
        mock_client.set_service(&service_id, &provider);

        let amount = 2_000_000i128;
        client.record_payment(&agent_addr, &service_id, &amount, &true, &provider);

        let events = env.events().all();
        assert_eq!(events.len(), 1);
        let event = events.get(0).unwrap();
        assert_eq!(
            event.1,
            (
                Symbol::new(&env, "agents"),
                Symbol::new(&env, "payment"),
                agent_addr.clone(),
            )
                .into_val(&env)
        );
        // Score unchanged at 100 because min_score_to_earn (500) was not met
        assert_eq!(
            <(u64, i128, bool, i32, i32, Address)>::from_val(&env, &event.2),
            (service_id, amount, true, 100i32, 100i32, provider)
        );
    }

    #[test]
    fn test_flag_agent_emits_event() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register(LodestarAgents, (admin.clone(),));
        let client = LodestarAgentsClient::new(&env, &contract_id);

        let agent_addr = Address::generate(&env);
        let owner = Address::generate(&env);
        setup_agent(&env, &contract_id, &agent_addr, &owner);

        let reason = String::from_str(&env, "Fraudulent activity detected");
        client.flag_agent(&agent_addr, &reason, &admin);

        let events = env.events().all();
        assert_eq!(events.len(), 1);
        let event = events.get(0).unwrap();
        assert_eq!(
            event.1,
            (
                Symbol::new(&env, "agents"),
                Symbol::new(&env, "flagged"),
                agent_addr.clone(),
            )
                .into_val(&env)
        );
        // Initial score 100 + (-200) clamped to 0
        assert_eq!(
            <(Address, String, i32, i32)>::from_val(&env, &event.2),
            (admin, reason, 100i32, 0i32)
        );
    }

    #[test]
    fn test_deactivate_agent_emits_event() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register(LodestarAgents, (admin,));
        let client = LodestarAgentsClient::new(&env, &contract_id);

        let agent_addr = Address::generate(&env);
        let owner = Address::generate(&env);
        setup_agent(&env, &contract_id, &agent_addr, &owner);

        client.deactivate_agent(&agent_addr, &owner);

        let events = env.events().all();
        assert_eq!(events.len(), 1);
        let event = events.get(0).unwrap();
        assert_eq!(
            event.1,
            (
                Symbol::new(&env, "agents"),
                Symbol::new(&env, "deactivated"),
                agent_addr.clone(),
            )
                .into_val(&env)
        );
        assert_eq!(<(Address,)>::from_val(&env, &event.2), (owner,));
    }

    #[test]
    fn test_admin_deactivate_agent_emits_event() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register(LodestarAgents, (admin.clone(),));
        let client = LodestarAgentsClient::new(&env, &contract_id);

        let agent_addr = Address::generate(&env);
        let owner = Address::generate(&env);
        setup_agent(&env, &contract_id, &agent_addr, &owner);

        client.admin_deactivate_agent(&agent_addr, &admin);

        let events = env.events().all();
        assert_eq!(events.len(), 1);
        let event = events.get(0).unwrap();
        assert_eq!(
            event.1,
            (
                Symbol::new(&env, "agents"),
                Symbol::new(&env, "deactivated"),
                agent_addr.clone(),
            )
                .into_val(&env)
        );
        assert_eq!(<(Address,)>::from_val(&env, &event.2), (admin,));
    }

    #[test]
    fn test_transfer_admin_emits_event() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register(LodestarAgents, (admin.clone(),));
        let client = LodestarAgentsClient::new(&env, &contract_id);

        let new_admin = Address::generate(&env);
        client.transfer_admin(&new_admin, &admin);

        let events = env.events().all();
        assert_eq!(events.len(), 1);
        let event = events.get(0).unwrap();
        assert_eq!(
            event.1,
            (
                Symbol::new(&env, "agents"),
                Symbol::new(&env, "admin_transferred"),
                new_admin.clone(),
            )
                .into_val(&env)
        );
        assert_eq!(
            <(Address, Address)>::from_val(&env, &event.2),
            (admin, new_admin)
        );
    }

    #[test]
    fn test_update_policy_emits_event() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register(LodestarAgents, (admin,));
        let client = LodestarAgentsClient::new(&env, &contract_id);

        let agent_addr = Address::generate(&env);
        let owner = Address::generate(&env);
        setup_agent(&env, &contract_id, &agent_addr, &owner);

        let mut categories = Vec::new(&env);
        categories.push_back(String::from_str(&env, "finance"));
        categories.push_back(String::from_str(&env, "analytics"));

        let max_tx = 50_000_000i128;
        let max_day = 500_000_000i128;
        let min_score = 300i32;

        client.update_policy(
            &agent_addr,
            &max_tx,
            &max_day,
            &categories,
            &min_score,
            &owner,
        );

        let events = env.events().all();
        assert_eq!(events.len(), 1);
        let event = events.get(0).unwrap();
        assert_eq!(
            event.1,
            (
                Symbol::new(&env, "agents"),
                Symbol::new(&env, "policy_updated"),
                agent_addr.clone(),
            )
                .into_val(&env)
        );
        assert_eq!(
            <(Address, i128, i128, Vec<String>, i32)>::from_val(&env, &event.2),
            (owner, max_tx, max_day, categories, min_score)
        );
    }

    #[test]
    fn test_score_history_reconstruction_from_events() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, admin, registry_id) = setup_with_mock_registry(&env);
        let client = LodestarAgentsClient::new(&env, &contract_id);

        let agent_addr = Address::generate(&env);
        let owner = Address::generate(&env);
        let mock_client = MockRegistryClient::new(&env, &registry_id);

        let provider1 = Address::generate(&env);
        let provider2 = Address::generate(&env);
        mock_client.set_service(&101u64, &provider1);
        mock_client.set_service(&102u64, &provider2);

        let mut reconstructed_scores: Vec<i32> = vec![&env];

        // 1. Register agent -> initial score 100
        client.register_agent(
            &agent_addr,
            &String::from_str(&env, "Reconstruction Agent"),
            &String::from_str(&env, "Agent to test score reconstruction"),
            &owner,
        );
        let reg_events = env.events().all();
        assert_eq!(reg_events.len(), 1);
        let reg_event = reg_events.get(0).unwrap();
        assert_eq!(
            reg_event.1,
            (
                Symbol::new(&env, "agents"),
                Symbol::new(&env, "registered"),
                agent_addr.clone(),
            )
                .into_val(&env)
        );
        let reg_data = <(Address, String, String, i32)>::from_val(&env, &reg_event.2);
        reconstructed_scores.push_back(reg_data.3);
        assert_eq!(client.get_score(&agent_addr), 100);

        // 2. Successful payment 1 (+10) -> score 110
        client.record_payment(&agent_addr, &101u64, &1_000_000i128, &true, &provider1);
        let pay1_events = env.events().all();
        assert_eq!(pay1_events.len(), 1);
        let pay1_event = pay1_events.get(0).unwrap();
        assert_eq!(
            pay1_event.1,
            (
                Symbol::new(&env, "agents"),
                Symbol::new(&env, "payment"),
                agent_addr.clone(),
            )
                .into_val(&env)
        );
        let pay1_data = <(u64, i128, bool, i32, i32, Address)>::from_val(&env, &pay1_event.2);
        assert_eq!(pay1_data.3, 100); // old_score
        assert_eq!(pay1_data.4, 110); // new_score
        reconstructed_scores.push_back(pay1_data.4);
        assert_eq!(client.get_score(&agent_addr), 110);

        // 3. Successful payment 2 (+10) -> score 120
        client.record_payment(&agent_addr, &102u64, &2_000_000i128, &true, &provider2);
        let pay2_events = env.events().all();
        assert_eq!(pay2_events.len(), 1);
        let pay2_event = pay2_events.get(0).unwrap();
        assert_eq!(
            pay2_event.1,
            (
                Symbol::new(&env, "agents"),
                Symbol::new(&env, "payment"),
                agent_addr.clone(),
            )
                .into_val(&env)
        );
        let pay2_data = <(u64, i128, bool, i32, i32, Address)>::from_val(&env, &pay2_event.2);
        assert_eq!(pay2_data.3, 110); // old_score
        assert_eq!(pay2_data.4, 120); // new_score
        reconstructed_scores.push_back(pay2_data.4);
        assert_eq!(client.get_score(&agent_addr), 120);

        // 4. Failed payment 1 (-25) -> score 95
        client.record_payment(&agent_addr, &101u64, &500_000i128, &false, &provider1);
        let pay3_events = env.events().all();
        assert_eq!(pay3_events.len(), 1);
        let pay3_event = pay3_events.get(0).unwrap();
        assert_eq!(
            pay3_event.1,
            (
                Symbol::new(&env, "agents"),
                Symbol::new(&env, "payment"),
                agent_addr.clone(),
            )
                .into_val(&env)
        );
        let pay3_data = <(u64, i128, bool, i32, i32, Address)>::from_val(&env, &pay3_event.2);
        assert_eq!(pay3_data.3, 120); // old_score
        assert_eq!(pay3_data.4, 95); // new_score
        reconstructed_scores.push_back(pay3_data.4);
        assert_eq!(client.get_score(&agent_addr), 95);

        // 5. Admin flag agent (-200, clamped to 0) -> score 0
        client.flag_agent(
            &agent_addr,
            &String::from_str(&env, "Policy breach"),
            &admin,
        );
        let flag_events = env.events().all();
        assert_eq!(flag_events.len(), 1);
        let flag_event = flag_events.get(0).unwrap();
        assert_eq!(
            flag_event.1,
            (
                Symbol::new(&env, "agents"),
                Symbol::new(&env, "flagged"),
                agent_addr.clone(),
            )
                .into_val(&env)
        );
        let flag_data = <(Address, String, i32, i32)>::from_val(&env, &flag_event.2);
        assert_eq!(flag_data.2, 95); // old_score
        assert_eq!(flag_data.3, 0); // new_score
        reconstructed_scores.push_back(flag_data.3);
        assert_eq!(client.get_score(&agent_addr), 0);

        assert_eq!(reconstructed_scores, vec![&env, 100, 110, 120, 95, 0]);
    }
}
