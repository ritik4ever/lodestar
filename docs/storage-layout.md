# Contract Storage Layout

Every storage key used by both contracts, its value type, TTL class, and how it
grows (#859). This is the reference needed to reason about migration cost, TTL
budget, and — if a critical bug ever forces a redeploy — exactly what has to be
preserved.

All keys below live in **persistent** storage. Neither contract uses instance or
temporary storage today; adding either should be recorded here.

## Registry — `contract/src/lib.rs`

`DataKey` variants:

| Key | Value | Cardinality | Growth | TTL |
| --- | --- | --- | --- | --- |
| `Counter` | `u64` | 1 | fixed | threshold-bumped to `MAX_TTL` when below `LOW_WATERMARK` on each service registration |
| `ServiceIds` | `Vec<u64>` | 1 | **grows with every service ever registered** | threshold-bumped to `MAX_TTL` on registration |
| `Service(u64)` | `ServiceEntry` | one per service | linear in services | threshold-bumped to `MAX_TTL` on registration and on every reputation change |
| `ServiceIdsByCategory(String)` | `Vec<u64>` | one per category in use | linear in categories; each entry grows with services in that category | threshold-bumped to `MAX_TTL` on registration |
| `AgentsContract` | `Address` | 1 | fixed | threshold-bumped to `MAX_TTL` at construction |
| `LastVote(u64, Address)` | `u64` (ledger sequence) | **one per (service, voting agent) pair** | quadratic in the worst case: services × agents | threshold-bumped to `MAX_TTL` on each vote |

`MAX_TTL = 3_110_400` ledgers (~180 days at 5 s/ledger).
`LOW_WATERMARK = 1_555_200` ledgers (~90 days) — the threshold below which a TTL
bump is triggered. If remaining TTL exceeds `LOW_WATERMARK`, `extend_ttl` is a
no-op and the caller pays nothing for the bump.

### Notes

- **`ServiceIds` is the growth hotspot.** It is a single `Vec<u64>` holding every
  service id, rewritten on each registration, so its read and write cost climbs
  linearly with the registry's lifetime size. A migration would need to carry it
  intact, and it is the entry most likely to hit entry-size limits first.
- **`LastVote` is the cardinality hotspot.** Modelling the cooldown as discrete
  keys — rather than one growing map — was deliberate: each lookup touches one
  entry instead of loading the whole set. The trade-off is an unbounded number of
  small entries, one per (service, agent) pair that has ever voted. They are
  individually cheap and independently expirable.
- `ServiceEntry` is the struct most exposed to migration risk: a field added or
  reordered makes every existing `Service(id)` entry unreadable.

## Agents — `contract/agents/src/lib.rs`

`DataKey` variants:

| Key | Value | Cardinality | Growth | TTL |
| --- | --- | --- | --- | --- |
| `AgentCount` | `u64` | 1 | fixed | threshold-bumped to `MAX_TTL` on registration |
| `AgentIds` | `Vec<Address>` | 1 | **grows with every agent ever registered** | threshold-bumped to `MAX_TTL` on registration |
| `Agent(Address)` | `AgentEntry` | one per agent | linear in agents | threshold-bumped to `MAX_TTL` on registration and on every score update |
| `Policy(Address)` | spending policy | one per agent with a policy | linear in agents | threshold-bumped to `MAX_TTL` on policy write |
| `RegistryContract` | `Address` | 1 | fixed | threshold-bumped to `MAX_TTL` at construction |
| `Admin` | `Address` | 1 | fixed | threshold-bumped to `MAX_TTL` at construction |

`MAX_TTL = 100_000_000` ledgers — deliberately large for test and CI stability;
worth revisiting before a mainnet deploy, since TTL is rent.
`LOW_WATERMARK = 50_000_000` ledgers (½ × `MAX_TTL`) — bump only fires when
remaining TTL has decayed below this value.

### Notes

- **`AgentIds` mirrors `ServiceIds`** and carries the same growth problem: one
  vector rewritten on every registration.
- `Agent(Address)` is written on every score change, so it is the hottest key in
  the system and the one whose TTL extension dominates rent.
- `Policy(Address)` is sparse — only agents with an explicit spending policy have
  one — so absence is meaningful and must be preserved as absence in a migration.

## TTL classes

Both contracts use a threshold-based TTL bump: `extend_ttl(&key, LOW_WATERMARK, MAX_TTL)`.
The host skips the bump (and charges nothing) when the entry's remaining TTL is
already above `LOW_WATERMARK`.  This makes the bump a no-op on every call except
those that arrive more than half the max window after the previous write — which
cuts the worst-case rent cost on the hot `update_reputation` and `record_payment`
paths roughly in half.

Keys written **once** — `AgentsContract`, `RegistryContract`, `Admin` — are the
ones at highest archival risk on a quiet network, and their loss would break all
cross-contract calls.  The threshold form is safe for them too: they will be
refreshed on the first interaction after their TTL drops below `LOW_WATERMARK`.

## What a migration must preserve

In priority order:

1. `Service(u64)` and `Agent(Address)` — the actual records; everything else can
   in principle be rebuilt from them.
2. `ServiceIds` / `AgentIds` — enumeration; rebuildable from the records only if
   ids are known.
3. `Counter` / `AgentCount` — must not go backwards, or new records would collide
   with existing ids.
4. `AgentsContract` / `RegistryContract` / `Admin` — configuration; cheap to
   re-set but must not be forgotten, since the registry panics without the
   agents address.
5. `LastVote` — safe to drop. Losing it resets cooldowns, which allows one early
   repeat vote per pair; that is a far smaller cost than migrating an unbounded
   number of entries.

## Keeping this current

The PR template prompts for storage-layout impact on any contract change. If you
add, remove, or retype a `DataKey` variant or a `#[contracttype]` struct, update
this table in the same PR.
