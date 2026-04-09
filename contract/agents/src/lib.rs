#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, vec,
    Address, Env, String, Vec,
};

// ── Constants ────────────────────────────────────────────────────────────────
const MAX_TTL: u32 = 3_110_400;   // ~1 year at 5 s/ledger
const DAY_LEDGERS: u64 = 17_280;  // 86400 / 5
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
    pub min_score_to_earn: i32,
    pub daily_spent_stroops: i128,
    pub last_reset_ledger: u64,
}

// ── Contract ─────────────────────────────────────────────────────────────────
#[contract]
pub struct LodestarAgents;

#[contractimpl]
impl LodestarAgents {
    // Register a new agent
    pub fn register_agent(
        env: Env,
        agent_address: Address,
        name: String,
        description: String,
        owner: Address,
    ) -> u64 {
        owner.require_auth();

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

    // Get spending policy
    pub fn get_policy(env: Env, agent_address: Address) -> Option<SpendingPolicy> {
        let key = DataKey::Policy(agent_address.clone());
        if let Some(mut policy) = env.storage().persistent().get::<DataKey, SpendingPolicy>(&key) {
            // Reset daily spend if a new day has started
            let now = env.ledger().sequence() as u64;
            if now >= policy.last_reset_ledger + DAY_LEDGERS {
                policy.daily_spent_stroops = 0;
                policy.last_reset_ledger = now;
            }
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

        let now = env.ledger().sequence() as u64;
        let daily_spent = if now >= policy.last_reset_ledger + DAY_LEDGERS {
            0i128
        } else {
            policy.daily_spent_stroops
        };

        daily_spent + amount_stroops <= policy.max_per_day_stroops
    }

    // Record a payment outcome — updates score, stats, and daily spend
    pub fn record_payment(
        env: Env,
        agent_address: Address,
        amount_stroops: i128,
        success: bool,
    ) {
        let agent_key = DataKey::Agent(agent_address.clone());
        let mut agent: AgentEntry = env
            .storage()
            .persistent()
            .get(&agent_key)
            .expect("agent not found");

        agent.total_payments += 1;
        agent.total_volume_stroops += amount_stroops;
        agent.last_active = env.ledger().sequence() as u64;

        if success {
            agent.successful_payments += 1;
            agent.score = (agent.score + SCORE_SUCCESS).min(MAX_SCORE);
        } else {
            agent.failed_payments += 1;
            agent.score = (agent.score + SCORE_FAILURE).max(0);
        }

        env.storage().persistent().set(&agent_key, &agent);
        env.storage()
            .persistent()
            .extend_ttl(&agent_key, MAX_TTL, MAX_TTL);

        // Update daily spend in policy
        let policy_key = DataKey::Policy(agent_address);
        if let Some(mut policy) =
            env.storage().persistent().get::<DataKey, SpendingPolicy>(&policy_key)
        {
            let now = env.ledger().sequence() as u64;
            if now >= policy.last_reset_ledger + DAY_LEDGERS {
                policy.daily_spent_stroops = 0;
                policy.last_reset_ledger = now;
            }
            if success {
                policy.daily_spent_stroops += amount_stroops;
            }
            env.storage().persistent().set(&policy_key, &policy);
            env.storage()
                .persistent()
                .extend_ttl(&policy_key, MAX_TTL, MAX_TTL);
        }
    }

    // Flag an agent (admin: owner auth required on agent)
    pub fn flag_agent(env: Env, agent_address: Address, reason: String, caller: Address) {
        caller.require_auth();

        let key = DataKey::Agent(agent_address);
        let mut agent: AgentEntry = env
            .storage()
            .persistent()
            .get(&key)
            .expect("agent not found");

        // Only owner can flag their own agent
        if agent.owner != caller {
            panic!("unauthorized");
        }

        agent.flagged = true;
        agent.flag_reason = reason;
        agent.score = (agent.score + FLAG_PENALTY).max(0);

        env.storage().persistent().set(&key, &agent);
        env.storage()
            .persistent()
            .extend_ttl(&key, MAX_TTL, MAX_TTL);
    }

    // Deactivate agent
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
            .map(|p| {
                if now >= p.last_reset_ledger + DAY_LEDGERS {
                    (0i128, now)
                } else {
                    (p.daily_spent_stroops, p.last_reset_ledger)
                }
            })
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
}
