# Checkpoint 4C — opening pool state and LP ownership records

Prepared 3 October 2026. Starting revision: user-created commit `49586b3`.
Status: implemented and validated locally, pending the user-created commit.
The user creates every commit. No deployment or live transaction is included.

## What changed

The first successfully admitted order now fixes an epoch's pool state and LP
roster. Previously the epoch fixed its orders and clock, while settlement read
the current virtual reserves without retaining an opening record. Settlement
now derives those reserves from the stored opening price/liquidity and checks
that the live pool and funded ownership still match before execution.

This implements an opening record for the **currently admitted full-range
model**. Native ETH/ERC20 pairs remain supported. Concentrated positions remain
available for custody, but concentrated admission/swaps remain blocked. This
checkpoint does not supply a canonical auction or historical reward payouts.

## Snapshot and trust boundary

`IOtterLiquidityGuard` defines two shared structures:

- `PoolSnapshot`: full pool key, manager, opening sqrt price/tick, LP/protocol
  fee fields, active/aggregate liquidity, ownership version and roster hash.
- `PositionSnapshot`: position ID, beneficial owner, lower/upper ticks and
  funded liquidity. Fees, previously earned claims and future rewards are absent.

The dedicated vault builds the record with at most 32 funded positions. It
checks each position's liquidity against the actual pinned v4 core position
key `(vault address, lower, upper, bytes32(positionId))`. The roster sum must
equal the vault total and core's active liquidity. All ranges must be full-range.
The two shared endpoints must have the expected aggregate gross/net liquidity
and initialized bitmap bits, including negative compressed word positions.
Unsupported pools, mismatched positions/endpoints and missing endpoint bits
reject first admission before escrow is retained.

This relies on the configured hook's exclusive vault custody: no other router
can introduce ticks or modify positions. The vault's pool-specific
`ownershipVersion` increments on creation, funded increases/reopening, removal
and processed exits. Failed operations roll back the increment. Owners are
nontransferable. Reservations, donations, fee collection and claim delivery do
not change funded membership/liquidity and do not increment it.

Full-range custody has two funded endpoints. The snapshot does **not** copy a
complete bitmap or authenticate an arbitrary keeper-provided map. The epoch's
custody lock preserves its schedule; revalidation checks live slot0/active
liquidity, aggregate liquidity and version with constant work. The guard's
`assertSnapshot` checks execution-critical fields of the book's authenticated
record; it is not an independent proof of an arbitrary caller's roster hash.
Concentrated schedule commitments and their corresponding execution/state
reader integration remain required before removing that gate.

## Commitment, API and history

The order book exposes:

```text
openingSnapshot(poolId, epoch) -> PoolSnapshot
openingPositions(poolId, epoch) -> PositionSnapshot[]
snapshotHash(poolId, epoch) -> bytes32
openingBlock(poolId, epoch) -> uint256
assertSnapshot(poolId, epoch) -> pre-swap check or revert
EpochOpened(poolId, epoch, snapshotHash, openingBlock)
```

The hash is the keccak256 of `abi.encode` in this order:

```text
keccak256("OtterOpeningSnapshot/v1"), chainId, orderBookAddress,
poolId, epoch, configVersion, closesAt, executeUntil,
openingBlockNumber, registeredGuardAddress, PoolSnapshot
```

`PoolSnapshot.positionsHash` is `keccak256(abi.encode(PositionSnapshot[]))`.
The array preserves the vault's current funded-position order exactly; it is
not an economic ranking or sorted tie rule. Swap-and-pop/reopening may change
a later roster's order, while old records remain immutable. Missing records
raise `SnapshotMissing` rather than masquerading as empty epochs.

The v1 snapshot tag is domain separation, not a new EIP-712 order type.
The existing v2 signed order ABI is unchanged and does **not** include
`snapshotHash`. Its epoch/ask/budget/time constraints remain signed; the first
admission selects the actual opening state. An order signed before opening
does not authorize a particular opening price or LP roster by hash.

The block number identifies the opening transaction's block. It is not a block
hash, finality proof or production RPC reader. Consumers must distinguish the
recorded transaction-time opening state from later live state and handle their
chain's finality/reorg policy. The independent BigInt reference still does not
authenticate externally supplied maps. The snapshot hash and order membership
digest are separate commitments; a future canonical outcome must bind both.

Records survive successful settlement, expiry, LP removal/reopening and later
epochs. The pre-swap checker is intentionally not a historical-validity getter:
a successful swap changes price, so its old opening record need not match live
state afterwards. Historical getters remain available regardless.

## Atomicity and execution boundaries

- The book's existing global callback lock freezes LP changes during snapshot
  creation and first escrow, including across pools. First-admission failure
  rolls back the snapshot, event, clock, nonce, orders and escrow together.
- Later admission checks the original state, preserves the record, and checks
  again after asset callbacks. A fee-changing escrow callback rolls back the
  entire attempted submission, including the controller's fee change.
- Settlement verifies its manager/key and opening state before pricing the
  legacy outcome. It validates again after escrow release, **including when
  opposing orders net to zero residual input**, and at the actual swap boundary.
  Fee drift retains explicit fee errors; other state mismatches revert.
- Exit reservations and donations do not invalidate the current epoch. A
  queued exit cannot veto its settlement. After terminal completion, processed
  exits advance the version while leaving historical records intact.
- Expiry and individual stored-order recovery do not call the guard, quote the
  pool, or scan LP history. Fault-injected price/tick/liquidity drift cannot
  prevent timeout and budget recovery. Fee-invalidated early recovery remains.

The own swap legitimately changes pool price. Revalidation must occur before
that swap, not after it against the unchanged opening price. Existing actual
signed-delta checks remain. The separate exact oracle is still read-only and
is not yet integrated into the legacy auction's allocation/payment checks.

## Validation and resource evidence

Forge 1.5.1, solc 0.8.26, Cancun, via IR, optimizer 200 runs, pinned local
dependencies; Node 24.10.0 with TypeScript stripping:

- `forge test --offline --no-match-contract 'GasCurveTest|SandwichHarness' -vv`:
  **264 passed, 0 failed, 24 suites**, including 18 fuzz tests with at least
  512 runs each. The new snapshot suite contains 19 tests.
- `npm test` in `solver/`: the existing eight property groups and all
  **20 execution reference groups passed**.
- `node --experimental-strip-types test/grant-review.ts`: passed its existing
  failure reproductions, preserving their classification as open findings.
- `forge build --offline --sizes`: passed, including deployment/benchmark
  compilation. Lint/style suggestions remain; the build reports no source error.
- `forge fmt --check` on changed/new Solidity, tracked `git diff --check` and
  separate untracked-file whitespace checks: passed.

The grant-review reproductions still confirm minority dust
payment 6 versus required 9, arrival-dependent equal-ask winners, and the legacy
uint256/BigInt domain gap. These remain open findings, not successes.

The new snapshot suite checks commitment reconstruction, real-core roster and
endpoint authentication, failed first admission, callback rollback, preserved
history, version semantics, native/aligned endpoints, active mutation locks,
donations/reservations, zero-residual fee validation, unsupported concentrated
admission and missing records. Its drift/recovery test uses 512 randomized
price/tick/liquidity mutations. Fault injection tests defensive rejection, not
the existence of a production router capable of these mutations.

Cold resource measurements use 32 funded full-range positions, 32 distinct
contract wallets consuming about 90k signature-validation gas each, maximum
512-byte signatures, aggregate budgets just below the uint96 ceiling, maximum
asks and distinct wallet nonce slots. They include ERC20 escrow and snapshot
storage. Measurements from the final broad run:

| Measured operation | Gas |
|---|---:|
| Cold maximum roster/wallet opening call | 10,393,371 |
| Cancun base/calldata intrinsic component | 383,908 |
| Opening call plus that intrinsic component | 10,777,279 |
| Cold individual recovery with 32 retained LP records | 67,427 |

The opening call explicitly receives a 15-million gas cap and the test checks
call plus Cancun intrinsic cost against that budget. Setup is excluded. The
instrumented call is a fixture measurement, not a universal upper bound;
other forks' calldata rules, assets, wallets and the target chain need separate
evaluation. The existing prototype
fixture budget is 15 million gas; no target-chain deployability is inferred.
Persistent roster storage is paid again for each epoch, even with unchanged
membership. Consider version-based history reuse if this cost is unacceptable,
without losing historical owner data. Full candidate mechanism/counterfactual
cost remains G3; an admission measurement does not bound settlement.

Production runtime/init bytecode sizes after this checkpoint:

| Contract | Runtime bytes | Init bytes |
|---|---:|---:|
| Execution oracle | 6,882 | 7,057 |
| Hook | 3,231 | 18,928 |
| Liquidity vault | 14,870 | 15,219 |
| Order book | 18,342 | 18,874 |
| Settlement | 12,881 | 13,526 |

All are below the runtime/init limits enforced by the size check. The hook's
constructor embeds the larger vault, so its init size changes despite unchanged
runtime. Oracle code is unchanged; its prior cold maximum traversal fixtures
remain 599,783 / 600,847 gas. Existing benchmark outputs, deployment addresses,
solver algorithms and saved legacy economic vectors were not regenerated.

## Remaining grant blockers

This is ownership history, **not** a capital-weighted reward ledger. Principal
amounts/spot-valued weights, positive eligible-weight opening checks, per-epoch
residual allocation, retained exiting-owner rewards and community dust backing
remain step 6. Raw liquidity is not an acceptable cross-range reward weight.
The legacy `pendingSurplus`/`flushSurplus` donation paths remain captureable by
later LPs; R7 is not fixed by recording a roster.

R2 noncanonical outcomes, R6 integer minority IR, G1/G2 allocation/payment/
finite-capacity definitions, and G3 complete verification cost remain open.
Legacy execution still uses broad core price limits and demands complete input
consumption; exact-quote reconciliation and partial settlement remain separate.
Do not lift the concentrated gate or advertise the continuous incentive proof
as established by these tests. Wallet migration, testnet evidence, independent
audits, economics and a grant application remain subsequent deliverables.

## User-created commit handoff

Include exactly these files:

```text
contracts/src/interfaces/IOtterLiquidityGuard.sol
contracts/src/OtterLiquidityVault.sol
contracts/src/OtterOrderBook.sol
contracts/src/OtterSettlement.sol
contracts/test/utils/MockLiquidityGuard.sol
contracts/test/OtterSnapshots.t.sol
reviews/CHECKPOINT_4C.md
reviews/CHECKPOINT_4B.md
reviews/IMPLEMENTATION_SPEC.md
reviews/REMEDIATION_PLAN.md
README.md
```

Suggested title:

```text
feat: bind epochs to opening pool state and LP ownership
```

Suggested explanation:

> Store authenticated opening pool and LP records, bind them to the epoch configuration and clock, and validate state through admission and settlement callbacks. Preserve history across exits and new epochs while keeping recovery independent of pool reads. Keep concentrated auctions and historical reward distribution gated behind their remaining work.

Create the commit and confirm completion before the next implementation slice.
