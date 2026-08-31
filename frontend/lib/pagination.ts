// Maximum page_size the Soroban service registry contract honours
// (see contract/src/lib.rs: page_size.min(20u32)).
// All client page sizes must stay at or below this value so that the contract
// returns exactly the number of items the client expects and page-boundary
// maths stays correct across every option.
export const CONTRACT_PAGE_SIZE_CAP = 20;

export const PAGE_SIZE = 12;
export const PAGE_SIZE_OPTIONS = [6, 12, 20] as const;
