#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, vec, Address, Env, String, Vec,
};

const MAX_TTL: u32 = 3110400;

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

#[contracttype]
pub enum DataKey {
    Counter,
    ServiceIds,
    Service(u64),
}

#[contract]
pub struct LodestarRegistry;

#[contractimpl]
impl LodestarRegistry {
    pub fn register_service(
        env: Env,
        provider: Address,
        name: String,
        description: String,
        endpoint: String,
        price_usdc: String,
        category: String,
    ) -> u64 {
        provider.require_auth();

        let counter: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::Counter)
            .unwrap_or(0u64);

        let new_id = counter + 1;

        let entry = ServiceEntry {
            id: new_id,
            name,
            description,
            endpoint,
            price_usdc,
            category,
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

        env.storage()
            .persistent()
            .set(&DataKey::Counter, &new_id);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Counter, MAX_TTL, MAX_TTL);

        let mut ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::ServiceIds)
            .unwrap_or_else(|| vec![&env]);
        ids.push_back(new_id);
        env.storage()
            .persistent()
            .set(&DataKey::ServiceIds, &ids);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::ServiceIds, MAX_TTL, MAX_TTL);

        new_id
    }

    pub fn get_service(env: Env, id: u64) -> ServiceEntry {
        env.storage()
            .persistent()
            .get(&DataKey::Service(id))
            .expect("Service not found")
    }

    pub fn list_services(env: Env, category: Option<String>) -> Vec<ServiceEntry> {
        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::ServiceIds)
            .unwrap_or_else(|| vec![&env]);

        let mut services: Vec<ServiceEntry> = vec![&env];

        for id in ids.iter() {
            if let Some(entry) = env
                .storage()
                .persistent()
                .get::<DataKey, ServiceEntry>(&DataKey::Service(id))
            {
                if !entry.active {
                    continue;
                }
                if let Some(ref cat) = category {
                    if entry.category != *cat {
                        continue;
                    }
                }
                services.push_back(entry);
            }
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

    pub fn update_reputation(env: Env, id: u64, positive: bool) {
        let mut entry: ServiceEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Service(id))
            .expect("Service not found");

        if positive {
            entry.reputation += 1;
        } else {
            entry.reputation -= 1;
        }

        env.storage()
            .persistent()
            .set(&DataKey::Service(id), &entry);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Service(id), MAX_TTL, MAX_TTL);
    }

    pub fn deactivate_service(env: Env, provider: Address, id: u64) {
        provider.require_auth();

        let mut entry: ServiceEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Service(id))
            .expect("Service not found");

        assert!(
            provider == entry.provider,
            "Only the provider can deactivate this service"
        );

        entry.active = false;
        env.storage()
            .persistent()
            .set(&DataKey::Service(id), &entry);
    }

    pub fn get_service_count(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::Counter)
            .unwrap_or(0u64)
    }
}
