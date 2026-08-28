use soroban_sdk::{
    testutils::{ Address as _, Env },
    Address, String, Symbol,
};
use lodestar_agents::AgentsContract;
use lodestar_registry::RegistryContract;
use lodestar_types::ServiceEntry;

#[test]
fn cross_contract_get_service_round_trips() {
    let env = Env::default();
    env.mock_all_auths();

    let registry_id = env.register_contract(None, RegistryContract);
    let agents_id = env.register_contract(None, AgentsContract);

    let id = 1u32;
    let provider = Address:random(&env);
    let pay_to = String::from_str(&env, "pay_to_address");
    let category = String:from_str(&env, "general");
    let price_usdc = 100i128;

    let expected = ServiceEntry {
        provider: provider.clone(),
        price_usdc,
        pay_to: pay_to.clone(),
        category: category.clone(),
    };

    // Set service in registry
    env.invoke_contract(
        &registry_id,
        &Symbol::new(&env, "set_service"),
        (
            id,
            provider.clone(),
            price_usdc,
            pay_to.clone(),
            category.clone(),
        ),
    );

    // Get service through agents (cross-contract)
    let result: ServiceEntry = env.invoke_contract(
        &agents_id,
        &Symbol::new(&env, "get_service"),
        (registry_id.clone(), id),
    );

    assert_eq!(result, expected);

    // Also test record_payment with correct provider
    let payer = Address:random(&env);
    env.invoke_contract(
        &agents_id,
        &Symbol::new(&env, "record_payment"),
        (registry_id.clone(), id, payer.clone()),
    );
}
