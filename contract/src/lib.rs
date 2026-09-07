#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, vec, Address, Env, IntoVal, String,
    Symbol, Vec,
};

const MAX_TTL: u32 = 3110400;

// Minimum number of ledgers that must elapse before the same agent may vote on
// the same service again. ~1 hour at 5 s/ledger. This caps how fast any single
// identity can move a service's reputation, blocking automated inflation loops.
const VOTE_COOLDOWN_LEDGERS: u64 = 720;

const MAX_REPUTATION: i32 = 10_000;
const MIN_REPUTATION: i32 = -10_000;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RegistryError {
    InvalidName = 1,
    InvalidDescription = 2,
    DuplicateActiveService = 3,
    ServiceNotFound = 4,
    AgentsContractNotConfigured = 5,
    CallerNotRegisteredAgent = 6,
    ReputationVoteCooldown = 7,
    ProviderMismatch = 8,
    CategoryIndexNotFound = 9,
    InvalidEndpoint = 10,
    InvalidCategory = 11,
}

// Canonical category list. Keep in sync with `frontend/lib/categoryMeta.tsx`.
// Existing mixed-case entries are not migrated automatically; providers should
// re-register under a canonical category returned by `list_categories()`.
const VALID_CATEGORIES: &[&str] = &["search", "weather", "finance", "ai", "data", "compute"];

// Returns the canonical lower-case form for a user-supplied category string,
// or `None` if it is not one of the known categories.
fn canonicalize_category(env: &Env, category: &String) -> Option<String> {
    let len = category.len() as usize;
    if len > 32 {
        return None;
    }
    let mut bytes = [0u8; 32];
    category.copy_into_slice(&mut bytes[..len]);

    let mut start = 0;
    while start < len && bytes[start].is_ascii_whitespace() {
        start += 1;
    }
    let mut end = len;
    while end > start && bytes[end - 1].is_ascii_whitespace() {
        end -= 1;
    }
    let trimmed = &bytes[start..end];

    for &cat in VALID_CATEGORIES {
        if trimmed.eq_ignore_ascii_case(cat.as_bytes()) {
            return Some(String::from_str(env, cat));
        }
    }
    None
}

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

#[contracttype]
pub enum DataKey {
    Counter,
    ServiceIds,
    Service(u64),
    ServiceIdsByCategory(String),
    // Address of the LodestarAgents contract, used to verify that a reputation
    // voter is a registered agent via a cross-contract `is_registered` call.
    AgentsContract,
    // Last ledger on which `agent` voted on `service_id`. Models the
    // `(service_id, agent) -> last_vote_ledger` cooldown map as discrete keys so
    // each lookup touches only one entry instead of loading a growing Map.
    LastVote(u64, Address),
    ProviderEndpoint(Address, String),
}

fn active_service_exists(env: &Env, provider: &Address, endpoint: &String) -> bool {
    env.storage().persistent().has(&DataKey::ProviderEndpoint(
        provider.clone(),
        endpoint.clone(),
    ))
}

#[contract]
pub struct LodestarRegistry;

#[contractimpl]
impl LodestarRegistry {
    /// Deploy-time setup: store the address of the LodestarAgents contract so
    /// `update_reputation` can verify voters are registered agents.
    ///
    /// This is a contract constructor — it runs exactly once, atomically, as part
    /// of deployment, and can never be invoked by a later caller. That closes the
    /// trust-anchor takeover risk a public `init` would carry (a front-runner
    /// pointing the registry at a malicious agents contract where everyone is
    /// "registered"). The agents address is fixed for the contract's lifetime.
    pub fn __constructor(env: Env, agents_contract: Address) {
        env.storage()
            .persistent()
            .set(&DataKey::AgentsContract, &agents_contract);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::AgentsContract, MAX_TTL, MAX_TTL);
    }

    /// Address of the LodestarAgents contract this registry was deployed against.
    pub fn get_agents_contract(env: Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::AgentsContract)
    }

    pub fn register_service(
        env: Env,
        provider: Address,
        name: String,
        description: String,
        endpoint: String,
        price_usdc: String,
        pay_to: String,
        category: String,
    ) -> Result<u64, RegistryError> {
        provider.require_auth();

        if name.len() < 3 || name.len() > 64 {
            return Err(RegistryError::InvalidName);
        }
        if description.len() < 10 || description.len() > 256 {
            return Err(RegistryError::InvalidDescription);
        }
        if endpoint.len() > 256 {
            return Err(RegistryError::InvalidEndpoint);
        }
        if category.len() < 1 || category.len() > 32 {
            return Err(RegistryError::InvalidCategory);
        }
        if active_service_exists(&env, &provider, &endpoint) {
            return Err(RegistryError::DuplicateActiveService);
        }

        let counter: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::Counter)
            .unwrap_or(0u64);

        let new_id = counter + 1;

        let canonical_category =
            canonicalize_category(&env, &category).ok_or(RegistryError::InvalidCategory)?;
        let cat = canonical_category.clone();

        let entry = ServiceEntry {
            id: new_id,
            name,
            description,
            endpoint,
            price_usdc,
            pay_to,
            category: canonical_category,
            provider,
            reputation: 0,
            active: true,
            registered_at: env.ledger().sequence() as u64,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Service(new_id), &entry);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Service(new_id), MAX_TTL, MAX_TTL);

        let endpoint_key =
            DataKey::ProviderEndpoint(entry.provider.clone(), entry.endpoint.clone());
        env.storage().persistent().set(&endpoint_key, &new_id);
        env.storage()
            .persistent()
            .extend_ttl(&endpoint_key, MAX_TTL, MAX_TTL);

        env.storage().persistent().set(&DataKey::Counter, &new_id);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Counter, MAX_TTL, MAX_TTL);

        let mut ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::ServiceIds)
            .unwrap_or_else(|| vec![&env]);
        ids.push_back(new_id);
        env.storage().persistent().set(&DataKey::ServiceIds, &ids);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::ServiceIds, MAX_TTL, MAX_TTL);

        let mut cat_ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::ServiceIdsByCategory(cat.clone()))
            .unwrap_or_else(|| vec![&env]);
        cat_ids.push_back(new_id);
        env.storage()
            .persistent()
            .set(&DataKey::ServiceIdsByCategory(cat.clone()), &cat_ids);
        env.storage().persistent().extend_ttl(
            &DataKey::ServiceIdsByCategory(cat),
            MAX_TTL,
            MAX_TTL,
        );

        env.events().publish(
            (
                Symbol::new(&env, "registry"),
                Symbol::new(&env, "registered"),
                new_id,
            ),
            (
                entry.provider.clone(),
                entry.name.clone(),
                entry.description.clone(),
                entry.endpoint.clone(),
                entry.category.clone(),
                entry.price_usdc.clone(),
                entry.pay_to.clone(),
            ),
        );

        Ok(new_id)
    }

    pub fn get_service(env: Env, id: u64) -> Result<ServiceEntry, RegistryError> {
        env.storage()
            .persistent()
            .get(&DataKey::Service(id))
            .ok_or(RegistryError::ServiceNotFound)
    }

    pub fn list_services(
        env: Env,
        offset: u32,
        limit: u32,
        category: Option<String>,
    ) -> Vec<ServiceEntry> {
        let limit = limit.min(50u32).max(1u32);
        let start: u32 = offset;

        let ids: Vec<u64> = if let Some(ref category) = category {
            let Some(cat) = canonicalize_category(&env, category) else {
                return vec![&env];
            };
            env.storage()
                .persistent()
                .get(&DataKey::ServiceIdsByCategory(cat))
                .unwrap_or_else(|| vec![&env])
        } else {
            env.storage()
                .persistent()
                .get(&DataKey::ServiceIds)
                .unwrap_or_else(|| vec![&env])
        };

        let total = ids.len();
        let end = (start + limit).min(total);

        let mut services: Vec<ServiceEntry> = vec![&env];
        let mut i = start;
        while i < end {
            if let Some(entry) = env
                .storage()
                .persistent()
                .get::<DataKey, ServiceEntry>(&DataKey::Service(ids.get(i).unwrap()))
            {
                if entry.active {
                    services.push_back(entry);
                }
            }
            i += 1;
        }

        // Insertion sort by reputation descending
        let len = services.len();
        for i in 1..len {
            let mut j = i;
            while j > 0 {
                let a = services.get(j - 1).unwrap();
                let b = services.get(j).unwrap();
                if a.reputation >= b.reputation {
                    break;
                }
                services.set(j - 1, b);
                services.set(j, a);
                j -= 1;
            }
        }

        services
    }

    /// Return the list of valid category strings.
    pub fn list_categories(env: Env) -> Vec<String> {
        let mut categories: Vec<String> = vec![&env];
        for &cat in VALID_CATEGORIES {
            categories.push_back(String::from_str(&env, cat));
        }
        categories
    }

    /// List a single page of services in registration order, filtering only active services.
    /// This avoids the pagination bug where inactive services cause short pages.
    ///
    /// Unlike list_services, this function ensures that every page except the last
    /// contains exactly page_size entries when enough active services exist.
    pub fn list_services_page(env: Env, page: u32, page_size: u32) -> Vec<ServiceEntry> {
        let page_size = page_size.min(20u32).max(1u32);

        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::ServiceIds)
            .unwrap_or_else(|| vec![&env]);

        let mut result: Vec<ServiceEntry> = vec![&env];
        let total_ids = ids.len() as usize;
        let mut active_count = 0;
        let mut found_count = 0;
        let target_skip = page as usize * page_size as usize;

        // Walk through all services, counting active ones until we reach our page
        for i in 0..total_ids {
            if let Some(entry) = env
                .storage()
                .persistent()
                .get::<DataKey, ServiceEntry>(&DataKey::Service(ids.get(i as u32).unwrap()))
            {
                if entry.active {
                    if active_count >= target_skip {
                        // We're in the target page range
                        result.push_back(entry);
                        found_count += 1;
                        if found_count >= page_size as usize {
                            break;
                        }
                    }
                    active_count += 1;
                }
            }
        }

        result
    }

    /// Cast a reputation vote on a service.
    ///
    /// Authorization (closes the anonymous-write vulnerability):
    /// 1. `caller.require_auth()` — the vote must be signed by `caller`.
    /// 2. `caller` must be a registered agent, checked via a cross-contract
    ///    `is_registered` call to the configured LodestarAgents contract, so
    ///    only identities with an on-chain agent record can vote.
    /// 3. A per-(service, agent) cooldown of `VOTE_COOLDOWN_LEDGERS` rate-limits
    ///    repeat votes, preventing a single identity from inflating or tanking a
    ///    score in a tight loop.
    pub fn update_reputation(
        env: Env,
        id: u64,
        positive: bool,
        caller: Address,
    ) -> Result<(), RegistryError> {
        caller.require_auth();

        // ── 1. Caller must be a registered agent ──────────────────────────────
        let agents_contract: Address = env
            .storage()
            .persistent()
            .get(&DataKey::AgentsContract)
            .ok_or(RegistryError::AgentsContractNotConfigured)?;

        let registered: bool = env.invoke_contract(
            &agents_contract,
            &Symbol::new(&env, "is_registered"),
            vec![&env, caller.clone().into_val(&env)],
        );
        if !registered {
            return Err(RegistryError::CallerNotRegisteredAgent);
        }

        let mut entry: ServiceEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Service(id))
            .ok_or(RegistryError::ServiceNotFound)?;

        // ── 2. Per-(service, agent) cooldown ──────────────────────────────────
        let now = env.ledger().sequence() as u64;
        let vote_key = DataKey::LastVote(id, caller.clone());
        if let Some(last_vote) = env.storage().persistent().get::<DataKey, u64>(&vote_key) {
            if now < last_vote + VOTE_COOLDOWN_LEDGERS {
                return Err(RegistryError::ReputationVoteCooldown);
            }
        }

        // ── 3. Apply the vote ─────────────────────────────────────────────────
        if positive {
            entry.reputation = (entry.reputation + 1).min(MAX_REPUTATION);
        } else {
            entry.reputation = (entry.reputation - 1).max(MIN_REPUTATION);
        }

        env.storage()
            .persistent()
            .set(&DataKey::Service(id), &entry);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Service(id), MAX_TTL, MAX_TTL);

        env.storage().persistent().set(&vote_key, &now);
        env.storage()
            .persistent()
            .extend_ttl(&vote_key, MAX_TTL, MAX_TTL);

        env.events().publish(
            (
                Symbol::new(&env, "registry"),
                Symbol::new(&env, "reputation"),
                id,
            ),
            (caller, positive, entry.reputation),
        );

        Ok(())
    }

    pub fn deactivate_service(env: Env, provider: Address, id: u64) -> Result<(), RegistryError> {
        provider.require_auth();

        let mut entry: ServiceEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Service(id))
            .ok_or(RegistryError::ServiceNotFound)?;

        if provider != entry.provider {
            return Err(RegistryError::ProviderMismatch);
        }

        entry.active = false;
        env.storage()
            .persistent()
            .set(&DataKey::Service(id), &entry);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Service(id), MAX_TTL, MAX_TTL);

        env.storage()
            .persistent()
            .remove(&DataKey::ProviderEndpoint(
                entry.provider.clone(),
                entry.endpoint.clone(),
            ));

        // Remove from category index
        let cat_key = DataKey::ServiceIdsByCategory(entry.category.clone());
        let cat_ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&cat_key)
            .ok_or(RegistryError::CategoryIndexNotFound)?;
        let mut updated: Vec<u64> = vec![&env];
        for cid in cat_ids.iter() {
            if cid != id {
                updated.push_back(cid);
            }
        }
        env.storage().persistent().set(&cat_key, &updated);
        env.storage()
            .persistent()
            .extend_ttl(&cat_key, MAX_TTL, MAX_TTL);

        env.events().publish(
            (
                Symbol::new(&env, "registry"),
                Symbol::new(&env, "deactivated"),
                id,
            ),
            (provider,),
        );

        Ok(())
    }

    pub fn get_service_count(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::Counter)
            .unwrap_or(0u64)
    }

    pub fn get_reputation_bounds(_env: Env) -> (i32, i32) {
        (MIN_REPUTATION, MAX_REPUTATION)
    }
}

#[cfg(test)]
mod test {
    // This crate is no_std; `format!` lives in `alloc` and must be imported
    // explicitly for the tests that build strings.
    extern crate alloc;
    use alloc::format;

    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Events, Ledger as _, MockAuth, MockAuthInvoke},
        Address, FromVal, IntoVal, String,
    };
    fn setup_service(
        env: &Env,
        id: u64,
        provider: &Address,
        category: &str,
        reputation: i32,
        active: bool,
    ) {
        let cat = String::from_str(env, category);
        let entry = ServiceEntry {
            id,
            name: String::from_str(env, "Test Service"),
            description: String::from_str(env, "Test Description"),
            endpoint: String::from_str(env, "https://test.com"),
            price_usdc: String::from_str(env, "10"),
            pay_to: String::from_str(env, "G_TEST_PAYMENT"),
            category: cat.clone(),
            provider: provider.clone(),
            reputation,
            active,
            registered_at: env.ledger().sequence() as u64,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Service(id), &entry);

        // Add to ServiceIds list
        let mut ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::ServiceIds)
            .unwrap_or_else(|| vec![env]);
        ids.push_back(id);
        env.storage().persistent().set(&DataKey::ServiceIds, &ids);

        // Add to category index
        let mut cat_ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::ServiceIdsByCategory(cat.clone()))
            .unwrap_or_else(|| vec![env]);
        cat_ids.push_back(id);
        env.storage()
            .persistent()
            .set(&DataKey::ServiceIdsByCategory(cat), &cat_ids);
    }

    #[test]
    fn test_list_services_empty() {
        let env = Env::default();
        let contract_id = env.register(LodestarRegistry, (Address::generate(&env),));

        env.clone().as_contract(&contract_id, || {
            // Test with no services registered
            let result = LodestarRegistry::list_services(env.clone(), 0, 20, None);
            assert_eq!(result.len(), 0);
        });
    }

    #[test]
    fn test_list_services_single_entry() {
        let env = Env::default();
        let contract_id = env.register(LodestarRegistry, (Address::generate(&env),));

        env.clone().as_contract(&contract_id, || {
            let provider = Address::generate(&env);
            setup_service(&env, 1, &provider, "compute", 0, true);

            // Test listing all services
            let result = LodestarRegistry::list_services(env, 0, 20, None);
            assert_eq!(result.len(), 1);
            assert_eq!(result.get(0).unwrap().id, 1);
        });
    }

    #[test]
    fn test_list_services_reputation_sorting() {
        let env = Env::default();
        let contract_id = env.register(LodestarRegistry, (Address::generate(&env),));

        env.clone().as_contract(&contract_id, || {
            let provider = Address::generate(&env);

            // Register three services with different reputations
            setup_service(&env, 1, &provider, "compute", 2, true);
            setup_service(&env, 2, &provider, "compute", 1, true);
            setup_service(&env, 3, &provider, "compute", -1, true);

            // Test sorting (should be descending: 1=2, 2=1, 3=-1)
            let result = LodestarRegistry::list_services(env, 0, 20, None);
            assert_eq!(result.len(), 3);
            assert_eq!(result.get(0).unwrap().id, 1);
            assert_eq!(result.get(1).unwrap().id, 2);
            assert_eq!(result.get(2).unwrap().id, 3);
        });
    }

    #[test]
    fn test_list_services_tied_reputation() {
        let env = Env::default();
        let contract_id = env.register(LodestarRegistry, (Address::generate(&env),));

        env.clone().as_contract(&contract_id, || {
            let provider = Address::generate(&env);

            // Register three services with same reputation
            setup_service(&env, 1, &provider, "compute", 1, true);
            setup_service(&env, 2, &provider, "compute", 1, true);
            setup_service(&env, 3, &provider, "compute", 1, true);

            // Test that all are returned (order may vary for ties)
            let result = LodestarRegistry::list_services(env, 0, 20, None);
            assert_eq!(result.len(), 3);

            // Verify all have same reputation
            let rep1 = result.get(0).unwrap().reputation;
            let rep2 = result.get(1).unwrap().reputation;
            let rep3 = result.get(2).unwrap().reputation;
            assert_eq!(rep1, rep2);
            assert_eq!(rep2, rep3);
        });
    }

    #[test]
    fn test_list_services_category_filter() {
        let env = Env::default();
        let contract_id = env.register(LodestarRegistry, (Address::generate(&env),));

        env.clone().as_contract(&contract_id, || {
            let provider = Address::generate(&env);

            // Register services in different categories
            setup_service(&env, 1, &provider, "compute", 0, true);
            setup_service(&env, 2, &provider, "weather", 0, true);
            setup_service(&env, 3, &provider, "compute", 0, true);

            // Test filtering by compute category
            let compute_result = LodestarRegistry::list_services(
                env.clone(),
                0,
                20,
                Some(String::from_str(&env, "compute")),
            );
            assert_eq!(compute_result.len(), 2);

            // Test filtering by weather category
            let weather_result = LodestarRegistry::list_services(
                env.clone(),
                0,
                20,
                Some(String::from_str(&env, "weather")),
            );
            assert_eq!(weather_result.len(), 1);
            assert_eq!(weather_result.get(0).unwrap().id, 2);

            // Test with no filter (should return all)
            let all_result = LodestarRegistry::list_services(env, 0, 20, None);
            assert_eq!(all_result.len(), 3);
        });
    }

    #[test]
    fn test_list_services_inactive_filtered() {
        let env = Env::default();
        let contract_id = env.register(LodestarRegistry, (Address::generate(&env),));

        env.clone().as_contract(&contract_id, || {
            let provider = Address::generate(&env);

            // Register two services, one active and one inactive
            setup_service(&env, 1, &provider, "compute", 0, true);
            setup_service(&env, 2, &provider, "compute", 0, false);

            // Test that only active service is returned
            let result = LodestarRegistry::list_services(env, 0, 20, None);
            assert_eq!(result.len(), 1);
            assert_eq!(result.get(0).unwrap().id, 1);
        });
    }

    #[test]
    fn test_list_services_category_filter_with_reputation() {
        let env = Env::default();
        let contract_id = env.register(LodestarRegistry, (Address::generate(&env),));

        env.clone().as_contract(&contract_id, || {
            let provider = Address::generate(&env);

            // Register services in different categories with different reputations
            setup_service(&env, 1, &provider, "compute", 1, true);
            setup_service(&env, 2, &provider, "compute", 2, true);
            setup_service(&env, 3, &provider, "storage", 1, true);

            // Test filtering by compute category with reputation sorting
            let compute_result = LodestarRegistry::list_services(
                env.clone(),
                0,
                20,
                Some(String::from_str(&env, "compute")),
            );
            assert_eq!(compute_result.len(), 2);
            assert_eq!(compute_result.get(0).unwrap().id, 2); // Higher reputation
            assert_eq!(compute_result.get(1).unwrap().id, 1);
        });
    }

    #[test]
    fn test_list_services_nonexistent_category() {
        let env = Env::default();
        let contract_id = env.register(LodestarRegistry, (Address::generate(&env),));

        env.clone().as_contract(&contract_id, || {
            let provider = Address::generate(&env);

            // Register a service
            setup_service(&env, 1, &provider, "compute", 0, true);

            // Test filtering by non-existent category
            let result = LodestarRegistry::list_services(
                env.clone(),
                0,
                20,
                Some(String::from_str(&env, "nonexistent")),
            );
            assert_eq!(result.len(), 0);

            let long_category = "A".repeat(33);
            let result = LodestarRegistry::list_services(
                env.clone(),
                0,
                20,
                Some(String::from_str(&env, &long_category)),
            );
            assert_eq!(result.len(), 0);
        });
    }

    #[test]
    fn test_list_services_page_basic() {
        let env = Env::default();
        let contract_id = env.register(LodestarRegistry, (Address::generate(&env),));

        env.clone().as_contract(&contract_id, || {
            let provider = Address::generate(&env);

            // Register 5 active services
            for i in 1..=5 {
                setup_service(&env, i, &provider, "compute", 0, true);
            }

            // Test first page with page_size=3
            let page0 = LodestarRegistry::list_services_page(env.clone(), 0, 3);
            assert_eq!(page0.len(), 3);
            assert_eq!(page0.get(0).unwrap().id, 1);
            assert_eq!(page0.get(1).unwrap().id, 2);
            assert_eq!(page0.get(2).unwrap().id, 3);

            // Test second page with page_size=3
            let page1 = LodestarRegistry::list_services_page(env.clone(), 1, 3);
            assert_eq!(page1.len(), 2); // Only 2 remaining services
            assert_eq!(page1.get(0).unwrap().id, 4);
            assert_eq!(page1.get(1).unwrap().id, 5);

            // Test beyond available pages
            let page2 = LodestarRegistry::list_services_page(env, 2, 3);
            assert_eq!(page2.len(), 0);
        });
    }

    #[test]
    fn test_list_services_page_mixed_active_inactive() {
        let env = Env::default();
        let contract_id = env.register(LodestarRegistry, (Address::generate(&env),));

        env.clone().as_contract(&contract_id, || {
            let provider = Address::generate(&env);

            // Register services with alternating active/inactive pattern
            // IDs 1,3,5,7,9 are active; IDs 2,4,6,8,10 are inactive
            for i in 1..=10 {
                let active = i % 2 == 1; // odd IDs are active
                setup_service(&env, i, &provider, "compute", 0, active);
            }

            // Test first page with page_size=3
            // Should get services 1, 3, 5 (first 3 active services)
            let page0 = LodestarRegistry::list_services_page(env.clone(), 0, 3);
            assert_eq!(page0.len(), 3);
            assert_eq!(page0.get(0).unwrap().id, 1);
            assert_eq!(page0.get(1).unwrap().id, 3);
            assert_eq!(page0.get(2).unwrap().id, 5);

            // Test second page with page_size=3
            // Should get services 7, 9 (next 2 active services, only 2 remaining)
            let page1 = LodestarRegistry::list_services_page(env.clone(), 1, 3);
            assert_eq!(page1.len(), 2);
            assert_eq!(page1.get(0).unwrap().id, 7);
            assert_eq!(page1.get(1).unwrap().id, 9);

            // Test third page - should be empty
            let page2 = LodestarRegistry::list_services_page(env, 2, 3);
            assert_eq!(page2.len(), 0);
        });
    }

    #[test]
    fn test_list_services_page_all_inactive() {
        let env = Env::default();
        let contract_id = env.register(LodestarRegistry, (Address::generate(&env),));

        env.clone().as_contract(&contract_id, || {
            let provider = Address::generate(&env);

            // Register 3 inactive services
            for i in 1..=3 {
                setup_service(&env, i, &provider, "compute", 0, false);
            }

            // Test first page - should be empty since all services are inactive
            let page0 = LodestarRegistry::list_services_page(env, 0, 3);
            assert_eq!(page0.len(), 0);
        });
    }

    #[test]
    fn test_list_services_page_empty_registry() {
        let env = Env::default();
        let contract_id = env.register(LodestarRegistry, (Address::generate(&env),));

        env.clone().as_contract(&contract_id, || {
            // Test with no services registered
            let page0 = LodestarRegistry::list_services_page(env, 0, 3);
            assert_eq!(page0.len(), 0);
        });
    }

    #[test]
    fn test_list_services_page_parameter_bounds() {
        let env = Env::default();
        let contract_id = env.register(LodestarRegistry, (Address::generate(&env),));

        env.clone().as_contract(&contract_id, || {
            let provider = Address::generate(&env);

            // Register 5 active services
            for i in 1..=5 {
                setup_service(&env, i, &provider, "compute", 0, true);
            }

            // Test page_size clamping - should clamp 25 to 20
            let result = LodestarRegistry::list_services_page(env.clone(), 0, 25);
            assert_eq!(result.len(), 5); // All available services

            // Test page_size clamping - should clamp 0 to 1
            let result = LodestarRegistry::list_services_page(env, 0, 0);
            assert_eq!(result.len(), 1); // One service due to min clamp
        });
    }

    // ── update_reputation authorization tests ─────────────────────────────────

    // Minimal stand-in for the LodestarAgents contract exposing just the
    // `is_registered` entrypoint the registry cross-calls.
    #[contract]
    pub struct MockAgents;

    #[contractimpl]
    impl MockAgents {
        pub fn set_registered(env: Env, agent: Address, registered: bool) {
            env.storage().persistent().set(&agent, &registered);
        }

        pub fn is_registered(env: Env, agent_address: Address) -> bool {
            env.storage()
                .persistent()
                .get(&agent_address)
                .unwrap_or(false)
        }
    }

    fn deploy_registry_with_id(
        env: &Env,
    ) -> (
        Address,
        LodestarRegistryClient<'static>,
        MockAgentsClient<'static>,
    ) {
        let agents_id = env.register(MockAgents, ());
        let agents = MockAgentsClient::new(env, &agents_id);

        let registry_id = env.register(LodestarRegistry, (agents_id.clone(),));
        let registry = LodestarRegistryClient::new(env, &registry_id);

        (registry_id, registry, agents)
    }

    fn deploy_registry(env: &Env) -> (LodestarRegistryClient<'static>, MockAgentsClient<'static>) {
        let (_, registry, agents) = deploy_registry_with_id(env);
        (registry, agents)
    }

    fn register_a_service(env: &Env, registry: &LodestarRegistryClient) -> u64 {
        let provider = Address::generate(env);
        registry.register_service(
            &provider,
            &String::from_str(env, "Test Service"),
            &String::from_str(env, "Test Description"),
            &String::from_str(env, "https://test.com"),
            &String::from_str(env, "10"),
            &String::from_str(env, "G_TEST_PAYMENT"),
            &String::from_str(env, "compute"),
        )
    }

    fn register_service_with_provider_and_endpoint(
        env: &Env,
        registry: &LodestarRegistryClient,
        provider: &Address,
        endpoint: &String,
    ) -> u64 {
        registry.register_service(
            provider,
            &String::from_str(env, "Test Service"),
            &String::from_str(env, "Test Description"),
            endpoint,
            &String::from_str(env, "10"),
            &String::from_str(env, "G_TEST_PAYMENT"),
            &String::from_str(env, "compute"),
        )
    }

    #[test]
    fn test_register_service_emits_registered_event() {
        let env = Env::default();
        env.mock_all_auths();
        let (registry, _agents) = deploy_registry(&env);
        let provider = Address::generate(&env);
        let name = String::from_str(&env, "Test Service");
        let description = String::from_str(&env, "Test Description");
        let endpoint = String::from_str(&env, "https://test.com");
        let price = String::from_str(&env, "10");
        let pay_to = String::from_str(&env, "G_TEST_PAYMENT");
        let category = String::from_str(&env, "compute");

        let id = registry.register_service(
            &provider,
            &name,
            &description,
            &endpoint,
            &price,
            &pay_to,
            &category,
        );

        let events = env.events().all();
        assert_eq!(events.len(), 1);
        let event = events.get(0).unwrap();
        assert_eq!(
            event.1,
            (
                Symbol::new(&env, "registry"),
                Symbol::new(&env, "registered"),
                id,
            )
                .into_val(&env)
        );
        assert_eq!(
            <(Address, String, String, String, String, String, String)>::from_val(&env, &event.2),
            (
                provider,
                name,
                description,
                endpoint,
                category,
                price,
                pay_to
            )
        );
    }

    #[test]
    fn test_update_reputation_emits_reputation_event() {
        let env = Env::default();
        env.mock_all_auths();
        let (registry, agents) = deploy_registry(&env);
        let id = register_a_service(&env, &registry);
        let agent = Address::generate(&env);
        agents.set_registered(&agent, &true);

        registry.update_reputation(&id, &true, &agent);

        let events = env.events().all();
        assert_eq!(events.len(), 1);
        let event = events.get(0).unwrap();
        assert_eq!(
            event.1,
            (
                Symbol::new(&env, "registry"),
                Symbol::new(&env, "reputation"),
                id,
            )
                .into_val(&env)
        );
        assert_eq!(
            <(Address, bool, i32)>::from_val(&env, &event.2),
            (agent, true, 1i32)
        );
    }

    #[test]
    fn test_deactivate_service_emits_deactivated_event() {
        let env = Env::default();
        env.mock_all_auths();
        let (registry, _agents) = deploy_registry(&env);
        let provider = Address::generate(&env);
        let id = registry.register_service(
            &provider,
            &String::from_str(&env, "Test Service"),
            &String::from_str(&env, "Test Description"),
            &String::from_str(&env, "https://test.com"),
            &String::from_str(&env, "10"),
            &String::from_str(&env, "G_TEST_PAYMENT"),
            &String::from_str(&env, "compute"),
        );

        registry.deactivate_service(&provider, &id);

        let events = env.events().all();
        assert_eq!(events.len(), 1);
        let event = events.get(0).unwrap();
        assert_eq!(
            event.1,
            (
                Symbol::new(&env, "registry"),
                Symbol::new(&env, "deactivated"),
                id,
            )
                .into_val(&env)
        );
        assert_eq!(<(Address,)>::from_val(&env, &event.2), (provider,));
    }

    #[test]
    fn test_register_service_rejects_non_provider_auth() {
        let env = Env::default();
        let agents_id = env.register(MockAgents, ());
        let registry_id = env.register(LodestarRegistry, (agents_id,));
        let registry = LodestarRegistryClient::new(&env, &registry_id);

        let provider = Address::generate(&env);
        let different_signer = Address::generate(&env);
        let name = String::from_str(&env, "Test Service");
        let description = String::from_str(&env, "Test Description");
        let endpoint = String::from_str(&env, "https://test.com");
        let price = String::from_str(&env, "10");
        let pay_to = String::from_str(&env, "G_TEST_PAYMENT");
        let category = String::from_str(&env, "compute");

        env.mock_auths(&[MockAuth {
            address: &different_signer,
            invoke: &MockAuthInvoke {
                contract: &registry_id,
                fn_name: "register_service",
                args: (
                    provider.clone(),
                    name.clone(),
                    description.clone(),
                    endpoint.clone(),
                    price.clone(),
                    pay_to.clone(),
                    category.clone(),
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);

        assert!(registry
            .try_register_service(
                &provider,
                &name,
                &description,
                &endpoint,
                &price,
                &pay_to,
                &category,
            )
            .is_err());
        assert_eq!(registry.get_service_count(), 0);
    }

    #[test]
    fn test_update_reputation_requires_registered_agent() {
        let env = Env::default();
        env.mock_all_auths();
        let (registry_id, registry, agents) = deploy_registry_with_id(&env);
        let id = register_a_service(&env, &registry);

        // An address with no agent record cannot vote.
        let stranger = Address::generate(&env);
        let result = env.clone().as_contract(&registry_id, || {
            LodestarRegistry::update_reputation(env.clone(), id, true, stranger.clone())
        });
        assert!(matches!(
            result,
            Err(RegistryError::CallerNotRegisteredAgent)
        ));
        assert_eq!(registry.get_service(&id).reputation, 0);

        // Once registered, the same address may vote.
        agents.set_registered(&stranger, &true);
        registry.update_reputation(&id, &true, &stranger);
        assert_eq!(registry.get_service(&id).reputation, 1);
    }

    #[test]
    fn test_update_reputation_positive_and_negative() {
        let env = Env::default();
        env.mock_all_auths();
        let (registry, agents) = deploy_registry(&env);
        let id = register_a_service(&env, &registry);

        let agent = Address::generate(&env);
        agents.set_registered(&agent, &true);

        registry.update_reputation(&id, &true, &agent);
        assert_eq!(registry.get_service(&id).reputation, 1);

        // Advance past the cooldown, then a negative vote brings it back to 0.
        env.ledger()
            .with_mut(|li| li.sequence_number += VOTE_COOLDOWN_LEDGERS as u32 + 1);
        registry.update_reputation(&id, &false, &agent);
        assert_eq!(registry.get_service(&id).reputation, 0);
    }

    #[test]
    fn test_update_reputation_cooldown_blocks_rapid_repeat_votes() {
        let env = Env::default();
        env.mock_all_auths();
        let (registry_id, registry, agents) = deploy_registry_with_id(&env);
        let id = register_a_service(&env, &registry);

        let agent = Address::generate(&env);
        agents.set_registered(&agent, &true);

        // First vote succeeds.
        registry.update_reputation(&id, &true, &agent);
        assert_eq!(registry.get_service(&id).reputation, 1);

        // A second vote within the cooldown window is rejected — no inflation.
        let result = env.clone().as_contract(&registry_id, || {
            LodestarRegistry::update_reputation(env.clone(), id, true, agent.clone())
        });
        assert!(matches!(result, Err(RegistryError::ReputationVoteCooldown)));
        assert_eq!(registry.get_service(&id).reputation, 1);

        // After the cooldown elapses, voting is allowed again.
        env.ledger()
            .with_mut(|li| li.sequence_number += VOTE_COOLDOWN_LEDGERS as u32 + 1);
        registry.update_reputation(&id, &true, &agent);
        assert_eq!(registry.get_service(&id).reputation, 2);
    }

    #[test]
    fn test_cooldown_is_per_agent_and_per_service() {
        let env = Env::default();
        env.mock_all_auths();
        let (registry, agents) = deploy_registry(&env);
        let id1 = register_a_service(&env, &registry);
        let id2 = register_a_service(&env, &registry);

        let agent_a = Address::generate(&env);
        let agent_b = Address::generate(&env);
        agents.set_registered(&agent_a, &true);
        agents.set_registered(&agent_b, &true);

        // Agent A votes on service 1.
        registry.update_reputation(&id1, &true, &agent_a);
        // A different agent voting on the same service is unaffected by A's cooldown.
        registry.update_reputation(&id1, &true, &agent_b);
        // Agent A voting on a different service is also unaffected.
        registry.update_reputation(&id2, &true, &agent_a);

        assert_eq!(registry.get_service(&id1).reputation, 2);
        assert_eq!(registry.get_service(&id2).reputation, 1);
    }

    #[test]
    fn test_constructor_sets_agents_contract_immutably() {
        let env = Env::default();
        // The agents contract is fixed at deployment by the constructor — there is
        // no post-deploy setter, so the trust anchor can never be swapped.
        let agents = Address::generate(&env);
        let registry_id = env.register(LodestarRegistry, (agents.clone(),));
        let registry = LodestarRegistryClient::new(&env, &registry_id);
        assert_eq!(registry.get_agents_contract(), Some(agents));
    }

    #[test]
    fn test_update_reputation_requires_caller_auth() {
        // Regression guard for #104: without env.mock_all_auths(), the
        // caller.require_auth() in update_reputation must reject the vote. This
        // fails if require_auth() is ever removed, even though the agent is
        // registered and outside any cooldown.
        let env = Env::default();

        // Build the registry + a service + a registered agent under mocked auth…
        env.mock_all_auths();
        let (registry, agents) = deploy_registry(&env);
        let id = register_a_service(&env, &registry);
        let agent = Address::generate(&env);
        agents.set_registered(&agent, &true);

        // …then drop all auth mocks so require_auth is genuinely enforced.
        env.set_auths(&[]);
        assert!(registry.try_update_reputation(&id, &true, &agent).is_err());
        assert_eq!(registry.get_service(&id).reputation, 0);
    }

    #[test]
    fn test_update_reputation_clamped_at_max() {
        let env = Env::default();
        env.mock_all_auths();
        let agents_id = env.register(MockAgents, ());
        let agents = MockAgentsClient::new(&env, &agents_id);
        let registry_id = env.register(LodestarRegistry, (agents_id,));
        let registry = LodestarRegistryClient::new(&env, &registry_id);

        let provider = Address::generate(&env);
        env.clone().as_contract(&registry_id, || {
            setup_service(&env, 1, &provider, "compute", MAX_REPUTATION - 1, true);
        });

        let agent = Address::generate(&env);
        agents.set_registered(&agent, &true);

        registry.update_reputation(&1u64, &true, &agent);
        assert_eq!(registry.get_service(&1u64).reputation, MAX_REPUTATION);

        env.ledger()
            .with_mut(|li| li.sequence_number += VOTE_COOLDOWN_LEDGERS as u32 + 1);
        registry.update_reputation(&1u64, &true, &agent);
        assert_eq!(registry.get_service(&1u64).reputation, MAX_REPUTATION);
    }

    #[test]
    fn test_update_reputation_clamped_at_min() {
        let env = Env::default();
        env.mock_all_auths();
        let agents_id = env.register(MockAgents, ());
        let agents = MockAgentsClient::new(&env, &agents_id);
        let registry_id = env.register(LodestarRegistry, (agents_id,));
        let registry = LodestarRegistryClient::new(&env, &registry_id);

        let provider = Address::generate(&env);
        env.clone().as_contract(&registry_id, || {
            setup_service(&env, 1, &provider, "compute", MIN_REPUTATION + 1, true);
        });

        let agent = Address::generate(&env);
        agents.set_registered(&agent, &true);

        registry.update_reputation(&1u64, &false, &agent);
        assert_eq!(registry.get_service(&1u64).reputation, MIN_REPUTATION);

        env.ledger()
            .with_mut(|li| li.sequence_number += VOTE_COOLDOWN_LEDGERS as u32 + 1);
        registry.update_reputation(&1u64, &false, &agent);
        assert_eq!(registry.get_service(&1u64).reputation, MIN_REPUTATION);
    }

    // ── register_service input validation tests ───────────────────────────

    #[test]
    fn test_register_service_rejects_name_too_short() {
        let env = Env::default();
        env.mock_all_auths();
        let (registry, _agents) = deploy_registry(&env);
        let provider = Address::generate(&env);

        assert!(matches!(
            registry.try_register_service(
                &provider,
                &String::from_str(&env, "AB"),
                &String::from_str(&env, "Valid description long enough"),
                &String::from_str(&env, "https://example.com"),
                &String::from_str(&env, "10"),
                &String::from_str(&env, "G_PAYMENT"),
                &String::from_str(&env, "compute"),
            ),
            Err(Ok(RegistryError::InvalidName))
        ));
    }

    #[test]
    fn test_register_service_rejects_name_too_long() {
        let env = Env::default();
        env.mock_all_auths();
        let (registry, _agents) = deploy_registry(&env);
        let provider = Address::generate(&env);

        let long_name = "A".repeat(65);
        assert!(matches!(
            registry.try_register_service(
                &provider,
                &String::from_str(&env, &long_name),
                &String::from_str(&env, "Valid description long enough"),
                &String::from_str(&env, "https://example.com"),
                &String::from_str(&env, "10"),
                &String::from_str(&env, "G_PAYMENT"),
                &String::from_str(&env, "compute"),
            ),
            Err(Ok(RegistryError::InvalidName))
        ));
    }

    #[test]
    fn test_register_service_rejects_description_too_short() {
        let env = Env::default();
        env.mock_all_auths();
        let (registry, _agents) = deploy_registry(&env);
        let provider = Address::generate(&env);

        assert!(matches!(
            registry.try_register_service(
                &provider,
                &String::from_str(&env, "Valid Name"),
                &String::from_str(&env, "123456789"),
                &String::from_str(&env, "https://example.com"),
                &String::from_str(&env, "10"),
                &String::from_str(&env, "G_PAYMENT"),
                &String::from_str(&env, "compute"),
            ),
            Err(Ok(RegistryError::InvalidDescription))
        ));
    }

    #[test]
    fn test_register_service_rejects_description_too_long() {
        let env = Env::default();
        env.mock_all_auths();
        let (registry, _agents) = deploy_registry(&env);
        let provider = Address::generate(&env);

        let long_desc = "A".repeat(257);
        assert!(matches!(
            registry.try_register_service(
                &provider,
                &String::from_str(&env, "Valid Name"),
                &String::from_str(&env, &long_desc),
                &String::from_str(&env, "https://example.com"),
                &String::from_str(&env, "10"),
                &String::from_str(&env, "G_PAYMENT"),
                &String::from_str(&env, "compute"),
            ),
            Err(Ok(RegistryError::InvalidDescription))
        ));
    }

    #[test]
    fn test_register_service_accepts_minimum_boundaries() {
        let env = Env::default();
        env.mock_all_auths();
        let (registry, _agents) = deploy_registry(&env);
        let provider = Address::generate(&env);

        // name = 3, description = 10 (minimum boundaries)
        assert!(registry
            .try_register_service(
                &provider,
                &String::from_str(&env, "ABC"),
                &String::from_str(&env, "1234567890"),
                &String::from_str(&env, "https://example.com"),
                &String::from_str(&env, "10"),
                &String::from_str(&env, "G_PAYMENT"),
                &String::from_str(&env, "compute"),
            )
            .unwrap()
            .is_ok());
    }

    #[test]
    fn test_register_service_accepts_maximum_boundaries() {
        let env = Env::default();
        env.mock_all_auths();
        let (registry, _agents) = deploy_registry(&env);
        let provider = Address::generate(&env);

        let long_name = "A".repeat(64);
        let long_desc = "A".repeat(256);
        // name = 64, description = 256 (maximum boundaries)
        assert!(registry
            .try_register_service(
                &provider,
                &String::from_str(&env, &long_name),
                &String::from_str(&env, &long_desc),
                &String::from_str(&env, "https://example.com"),
                &String::from_str(&env, "10"),
                &String::from_str(&env, "G_PAYMENT"),
                &String::from_str(&env, "compute"),
            )
            .unwrap()
            .is_ok());
    }

    #[test]
    fn test_get_service_returns_typed_not_found_error() {
        let env = Env::default();
        env.mock_all_auths();
        let (registry_id, _registry, _agents) = deploy_registry_with_id(&env);

        let result = env.clone().as_contract(&registry_id, || {
            LodestarRegistry::get_service(env.clone(), 999)
        });
        assert!(matches!(result, Err(RegistryError::ServiceNotFound)));
    }

    #[test]
    fn test_register_service_returns_typed_duplicate_error() {
        let env = Env::default();
        env.mock_all_auths();
        let (registry, _agents) = deploy_registry(&env);
        let provider = Address::generate(&env);
        let endpoint = String::from_str(&env, "https://example.com");

        registry.register_service(
            &provider,
            &String::from_str(&env, "First Service"),
            &String::from_str(&env, "Valid description long enough"),
            &endpoint,
            &String::from_str(&env, "10"),
            &String::from_str(&env, "G_PAYMENT"),
            &String::from_str(&env, "compute"),
        );

        assert!(matches!(
            registry.try_register_service(
                &provider,
                &String::from_str(&env, "Second Service"),
                &String::from_str(&env, "Another valid description"),
                &endpoint,
                &String::from_str(&env, "10"),
                &String::from_str(&env, "G_PAYMENT"),
                &String::from_str(&env, "compute"),
            ),
            Err(Ok(RegistryError::DuplicateActiveService))
        ));
    }

    #[test]
    fn test_update_reputation_returns_typed_missing_service_error() {
        let env = Env::default();
        env.mock_all_auths();
        let (registry_id, _registry, agents) = deploy_registry_with_id(&env);
        let agent = Address::generate(&env);
        agents.set_registered(&agent, &true);

        let result = env.clone().as_contract(&registry_id, || {
            LodestarRegistry::update_reputation(env.clone(), 999u64, true, agent.clone())
        });
        assert!(matches!(result, Err(RegistryError::ServiceNotFound)));
    }

    #[test]
    fn test_update_reputation_returns_typed_missing_agents_config_error() {
        let env = Env::default();
        env.mock_all_auths();
        let agents_id = env.register(MockAgents, ());
        let registry_id = env.register(LodestarRegistry, (agents_id,));
        let provider = Address::generate(&env);
        let agent = Address::generate(&env);

        env.clone().as_contract(&registry_id, || {
            setup_service(&env, 1, &provider, "compute", 0, true);
            env.storage().persistent().remove(&DataKey::AgentsContract);
        });

        let result = env.clone().as_contract(&registry_id, || {
            LodestarRegistry::update_reputation(env.clone(), 1u64, true, agent.clone())
        });
        assert!(matches!(
            result,
            Err(RegistryError::AgentsContractNotConfigured)
        ));
    }

    #[test]
    fn test_deactivate_service_returns_typed_provider_mismatch_error() {
        let env = Env::default();
        env.mock_all_auths();
        let agents_id = env.register(MockAgents, ());
        let registry_id = env.register(LodestarRegistry, (agents_id,));
        let provider = Address::generate(&env);
        let other = Address::generate(&env);

        env.clone().as_contract(&registry_id, || {
            setup_service(&env, 1, &provider, "compute", 0, true);
        });

        let result = env.clone().as_contract(&registry_id, || {
            LodestarRegistry::deactivate_service(env.clone(), other.clone(), 1u64)
        });
        assert!(matches!(result, Err(RegistryError::ProviderMismatch)));
    }

    #[test]
    fn test_deactivate_service_returns_typed_missing_category_index_error() {
        let env = Env::default();
        env.mock_all_auths();
        let agents_id = env.register(MockAgents, ());
        let registry_id = env.register(LodestarRegistry, (agents_id,));
        let provider = Address::generate(&env);
        let entry = ServiceEntry {
            id: 1,
            name: String::from_str(&env, "Test Service"),
            description: String::from_str(&env, "Valid description"),
            endpoint: String::from_str(&env, "https://example.com"),
            price_usdc: String::from_str(&env, "10"),
            pay_to: String::from_str(&env, "G_PAYMENT"),
            category: String::from_str(&env, "compute"),
            provider: provider.clone(),
            reputation: 0,
            active: true,
            registered_at: env.ledger().sequence() as u64,
        };

        env.clone().as_contract(&registry_id, || {
            env.storage().persistent().set(&DataKey::Service(1), &entry);
        });

        let result = env.clone().as_contract(&registry_id, || {
            LodestarRegistry::deactivate_service(env.clone(), provider.clone(), 1u64)
        });
        assert!(matches!(result, Err(RegistryError::CategoryIndexNotFound)));
    }

    #[test]
    fn test_register_service_rejects_endpoint_too_long() {
        let env = Env::default();
        env.mock_all_auths();
        let (registry, _agents) = deploy_registry(&env);
        let provider = Address::generate(&env);

        let long_endpoint = "A".repeat(257);
        assert!(matches!(
            registry.try_register_service(
                &provider,
                &String::from_str(&env, "Valid Name"),
                &String::from_str(&env, "Valid description long enough"),
                &String::from_str(&env, &long_endpoint),
                &String::from_str(&env, "10"),
                &String::from_str(&env, "G_PAYMENT"),
                &String::from_str(&env, "compute"),
            ),
            Err(Ok(RegistryError::InvalidEndpoint))
        ));
    }

    #[test]
    fn test_register_service_accepts_endpoint_at_max() {
        let env = Env::default();
        env.mock_all_auths();
        let (registry, _agents) = deploy_registry(&env);
        let provider = Address::generate(&env);

        let max_endpoint = "A".repeat(256);
        assert_eq!(max_endpoint.len(), 256);
        assert!(registry
            .try_register_service(
                &provider,
                &String::from_str(&env, "Valid Name"),
                &String::from_str(&env, "Valid description long enough"),
                &String::from_str(&env, &max_endpoint),
                &String::from_str(&env, "10"),
                &String::from_str(&env, "G_PAYMENT"),
                &String::from_str(&env, "compute"),
            )
            .is_ok());
    }

    #[test]
    fn test_register_service_rejects_category_empty() {
        let env = Env::default();
        env.mock_all_auths();
        let (registry, _agents) = deploy_registry(&env);
        let provider = Address::generate(&env);

        assert!(matches!(
            registry.try_register_service(
                &provider,
                &String::from_str(&env, "Valid Name"),
                &String::from_str(&env, "Valid description long enough"),
                &String::from_str(&env, "https://example.com"),
                &String::from_str(&env, "10"),
                &String::from_str(&env, "G_PAYMENT"),
                &String::from_str(&env, ""),
            ),
            Err(Ok(RegistryError::InvalidCategory))
        ));
    }

    #[test]
    fn test_register_service_rejects_category_too_long() {
        let env = Env::default();
        env.mock_all_auths();
        let (registry, _agents) = deploy_registry(&env);
        let provider = Address::generate(&env);

        let long_category = "A".repeat(33);
        assert!(matches!(
            registry.try_register_service(
                &provider,
                &String::from_str(&env, "Valid Name"),
                &String::from_str(&env, "Valid description long enough"),
                &String::from_str(&env, "https://example.com"),
                &String::from_str(&env, "10"),
                &String::from_str(&env, "G_PAYMENT"),
                &String::from_str(&env, &long_category),
            ),
            Err(Ok(RegistryError::InvalidCategory))
        ));
    }

    #[test]
    fn test_register_service_canonicalizes_category() {
        let env = Env::default();
        env.mock_all_auths();
        let (registry, _agents) = deploy_registry(&env);
        let provider = Address::generate(&env);

        let id = registry.register_service(
            &provider,
            &String::from_str(&env, "Valid Name"),
            &String::from_str(&env, "Valid description long enough"),
            &String::from_str(&env, "https://example.com"),
            &String::from_str(&env, "10"),
            &String::from_str(&env, "G_PAYMENT"),
            &String::from_str(&env, " Compute "),
        );

        assert_eq!(
            registry.get_service(&id).category,
            String::from_str(&env, "compute")
        );
    }

    #[test]
    fn test_get_reputation_bounds() {
        let env = Env::default();
        let registry_id = env.register(LodestarRegistry, (Address::generate(&env),));
        let registry = LodestarRegistryClient::new(&env, &registry_id);

        let (min, max) = registry.get_reputation_bounds();
        assert_eq!(min, MIN_REPUTATION);
        assert_eq!(max, MAX_REPUTATION);
    }
}
