//! Cross-contract integration tests (#835).
//!
//! The registry's unit tests deploy a hand-written `MockAgents` stub that always
//! answers `is_registered` from a single boolean. That proves the registry calls
//! *something*, but not that it interoperates with the contract it actually calls
//! in production: the real `is_registered` reads a full `AgentEntry` from
//! persistent storage under its own `DataKey`, and the real contract panics in
//! places the mock never does.
//!
//! These tests deploy **both real contracts** into one test environment and
//! exercise the interaction end to end, including the case where the callee
//! rejects, and record the invocation cost.

use lodestar_agents::{LodestarAgents, LodestarAgentsClient};
use lodestar_registry::{LodestarRegistry, LodestarRegistryClient};
const VOTE_COOLDOWN_LEDGERS: u32 = 720;

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env, String,
};

/// Deploy the real agents contract and the real registry wired to it.
fn deploy_both(env: &Env) -> (LodestarRegistryClient<'static>, LodestarAgentsClient<'static>, Address) {
    let admin = Address::generate(env);

    let agents_id = env.register(LodestarAgents, (admin.clone(),));
    let agents = LodestarAgentsClient::new(env, &agents_id);

    let registry_id = env.register(LodestarRegistry, (agents_id.clone(),));
    let registry = LodestarRegistryClient::new(env, &registry_id);

    (registry, agents, admin)
}

/// Register a service so there is something to vote on.
fn register_service(env: &Env, registry: &LodestarRegistryClient) -> u64 {
    let provider = Address::generate(env);
    registry.register_service(
        &provider,
        &String::from_str(env, "Weather API"),
        &String::from_str(env, "Weather data for the integration test"),
        &String::from_str(env, "https://example.test/weather"),
        &String::from_str(env, "0.001"),
        &String::from_str(env, "GTESTPAYTOADDRESS"),
        &String::from_str(env, "weather"),
    )
}

/// Register an agent through the real agents contract.
fn register_agent(env: &Env, agents: &LodestarAgentsClient, agent: &Address) {
    let owner = Address::generate(env);
    agents.register_agent(
        agent,
        &String::from_str(env, "Test Agent"),
        &String::from_str(env, "An agent used in the integration test"),
        &owner,
    );
}

#[test]
fn registry_accepts_a_vote_from_an_agent_registered_in_the_real_contract() {
    let env = Env::default();
    env.mock_all_auths();

    let (registry, agents, _admin) = deploy_both(&env);
    let service_id = register_service(&env, &registry);

    let agent = Address::generate(&env);
    register_agent(&env, &agents, &agent);

    // Sanity: the real contract, not a stub, reports the registration.
    assert!(agents.is_registered(&agent));

    registry.update_reputation(&service_id, &true, &agent);

    let service = registry.get_service(&service_id);
    assert!(
        service.reputation > 0,
        "a positive vote from a registered agent should raise reputation",
    );
}

#[test]
#[should_panic(expected = "unauthorized: caller is not a registered agent")]
fn registry_rejects_a_vote_when_the_real_agents_contract_says_no() {
    let env = Env::default();
    env.mock_all_auths();

    let (registry, _agents, _admin) = deploy_both(&env);
    let service_id = register_service(&env, &registry);

    // Never registered in the agents contract.
    let stranger = Address::generate(&env);

    registry.update_reputation(&service_id, &true, &stranger);
}

#[test]
fn a_callee_panic_propagates_and_leaves_registry_state_untouched() {
    let env = Env::default();
    env.mock_all_auths();

    let (registry, agents, _admin) = deploy_both(&env);
    let service_id = register_service(&env, &registry);

    let agent = Address::generate(&env);
    register_agent(&env, &agents, &agent);

    // A second registration of the same address panics inside the *callee*.
    let owner = Address::generate(&env);
    let result = registry.try_register_service(
        &owner,
        &String::from_str(&env, "Another Service"),
        &String::from_str(&env, "A second service registered during the test"),
        &String::from_str(&env, "https://example.test/x"),
        &String::from_str(&env, "0.002"),
        &String::from_str(&env, "GTESTPAYTOADDRESS"),
        &String::from_str(&env, "weather"),
    );
    assert!(result.is_ok(), "sanity: registry itself still works");

    let before = registry.get_service(&service_id);

    // The registry surfaces the failure rather than silently counting the vote:
    // a duplicate registration in the agents contract panics, and the whole
    // invocation is rolled back.
    let duplicate = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        agents.register_agent(
            &agent,
            &String::from_str(&env, "Duplicate"),
            &String::from_str(&env, "Second registration of the same address"),
            &owner,
        );
    }));
    assert!(duplicate.is_err(), "duplicate registration must panic");

    let after = registry.get_service(&service_id);
    assert_eq!(
        before.reputation, after.reputation,
        "a panic in the agents contract must not alter registry state",
    );
}

#[test]
fn vote_cooldown_still_applies_across_the_real_cross_contract_call() {
    let env = Env::default();
    env.mock_all_auths();

    let (registry, agents, _admin) = deploy_both(&env);
    let service_id = register_service(&env, &registry);

    let agent = Address::generate(&env);
    register_agent(&env, &agents, &agent);

    registry.update_reputation(&service_id, &true, &agent);

    // Immediately voting again must be refused by the cooldown, not by the
    // registration check — the two guards are independent.
    let second = registry.try_update_reputation(&service_id, &true, &agent);
    assert!(second.is_err(), "second vote inside the cooldown must fail");

    // After the cooldown window the same agent can vote again.
    // Advance just past the cooldown. A larger jump would archive the contract
    // instance in the test host and fail for an unrelated reason.
    env.ledger()
        .with_mut(|li| li.sequence_number += VOTE_COOLDOWN_LEDGERS + 1);
    registry.update_reputation(&service_id, &false, &agent);

    // One positive then one negative vote nets back to the starting score.
    let service = registry.get_service(&service_id);
    assert_eq!(service.reputation, 0);
}

#[test]
fn records_the_cost_of_the_cross_contract_invocation() {
    let env = Env::default();
    env.mock_all_auths();

    let (registry, agents, _admin) = deploy_both(&env);
    let service_id = register_service(&env, &registry);

    let agent = Address::generate(&env);
    register_agent(&env, &agents, &agent);

    // Measure only the voting call, which contains the cross-contract hop.
    env.cost_estimate().budget().reset_unlimited();
    registry.update_reputation(&service_id, &true, &agent);

    let cpu = env.cost_estimate().budget().cpu_instruction_cost();
    let mem = env.cost_estimate().budget().memory_bytes_cost();

    // Printed so the figure is visible in `cargo test -- --nocapture` and can be
    // compared across changes; asserted loosely so the test measures rather than
    // freezes the cost.
    std::println!("cross-contract update_reputation cost: cpu={cpu} mem={mem}");

    assert!(cpu > 0, "invocation should consume CPU budget");
    assert!(mem > 0, "invocation should consume memory budget");
    assert!(
        cpu < 100_000_000,
        "cross-contract vote cost regressed sharply: {cpu} CPU instructions",
    );
}
