#[!no_std]

use soroban_sdk::{contracttype, Address, String};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ServiceEntry {
    pub provider: Address,
    pub price_usdc: i128,
    pub pay_to: String,
    pub category: String,
}
