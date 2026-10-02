# Checkpoint 3A — bounded signed epochs and independent stored recovery

Prepared 2 October 2026. Starting revision: user-created commit `57bdd33`.
Status: implemented and validated locally, pending the user-created commit. The user creates the commit. No live deployment is part of this checkpoint.

## What changed

`OtterOrderBook` now stores up to 32 admitted records per pool/epoch. It retains
the rolling commitment for settlement membership, but anyone can recover one
expired stored record without signatures, an indexer, a solver, or the other
orders. Records reconstruct all signed fields and retain their stable index.
Refund crediting and token delivery are separate operations. Native relayers
cannot redirect the signed trader's refund.

The first successful admission fixes `closesAt` and `executeUntil`. Settlement
is permitted only before `executeUntil`; at that timestamp expiry is public.
Expiry changes one state and makes no order, token, or liquidity-guard calls.
It releases the pool's economic freeze while each unrecovered budget remains
an escrow liability. Recovery credits the fixed owner and moves that budget
from escrow to claims without any token call. Later epochs and other pools
cannot use the old backing. Failed claims affect only their owner's withdrawal.

The owner can pause admission, but cannot pause expiry, recovery, trader claims,
or idle authenticated LP withdrawals. Traders can invalidate unused nonce words.
The existing settlement completes the economic transition only after outputs
have been funded; expiry and refunds cannot overlap execution or settlement.

Admission enforces individual/aggregate uint96 budgets, uint128 asks, uint64
timestamps, exact native value and ERC20 transfers, and the registered vault's
current supported full-range state. Both integer virtual reserves must be
nonzero. The existing liquidity/price bounds keep accepted ask/reserve products
within uint256. A vault funding callback cannot admit a new batch during an
unfinished LP mutation.

A real unsupported protocol/LP fee permits early expiry through the registered
vault's authenticated PoolManager key. Normal timed expiry requires no such
external check. Fee invalidation does not create a reward or transfer tokens.

## Signature and client migration

This is a breaking order ABI and signature-domain change. The v2 domain is:

```text
name: OtterOrderBook
version: 2
chainId: the active chain
verifyingContract: the new order-book address
```

The typed struct, including field order and ABI types, is:

```text
Order(address trader,bytes32 poolId,bool sellingCurrency0,uint256 ask,uint256 budget,uint256 deadline,uint256 nonce,uint256 configVersion,uint256 epoch,uint256 maxExecutionTime)
```

`deadline` is admission validity; `maxExecutionTime` caps execution exposure.
The latter must cover the epoch's full fixed execution window at admission.
A stale preview does not extend it. Configuration version is currently 1,
registered once and immutable; it must be snapshotted per epoch if configurable
versions are introduced later. Old domain/struct signatures are rejected.

EOAs use low-s, 65-byte ECDSA. Contract traders use static EIP-1271 validation,
capped at 100,000 gas and 512 signature bytes. Only one return word is copied.
These prototype limits exclude wallets needing larger signatures or more gas;
this is not unrestricted support for all smart wallets. A later signature
revocation does not cancel admitted escrow or block its recovery.

The Solidity fixtures now sign v2 orders. The web dashboard, live deployment,
and legacy solver are not a complete v2 client/mechanism yet. Published old
addresses retain their old code and ABI. Do not submit these signatures to them
or describe them as upgraded.

## Current API and transitions

| Operation | Behavior |
|---|---|
| `previewEpoch(poolId)` | Current/next collecting epoch ID, close, execution deadline, and configuration; unopened clocks are previews only |
| `nextEpochId(poolId)` | Signing helper; does not establish admission availability |
| `getOrder(poolId, epoch, index)` / `getOrders(poolId, epoch)` | Reconstruct stored signed orders; array length is at most 32 |
| `batchState(poolId, epoch)` | None, Collecting, derived Closed, Executing, Settled, or Refundable |
| `executionDeadline(poolId, epoch)` | Fixed exclusive execution upper boundary |
| `expire(poolId, epoch)` | Constant work, no asset calls; allowed at/after the deadline |
| `expireUnsupportedFees(poolId, epoch)` | Early invalidation after an authenticated registered-vault fee check |
| `refundOrder(poolId, epoch, index)` | Once-only credit to stored trader; can perform due expiry and works after a new epoch opens |
| `orderRecovered(poolId, epoch, index)` | Record-level refund status; output/unspent-input claims from a successful settlement use the ordinary claim ledger |
| `claim(currency, amount, recipient)` | Owner-only independent delivery; amount can be split and recipient chosen by the owner |
| `invalidateNonces(word, mask)` | Invalidate unused signatures; no cancellation of admitted escrow |
| `setAdmissionPaused(bool)` | Owner admission control; does not change clocks or pause recovery/claims |

`batches(poolId, epoch)` remains a three-value compatibility view, with its last
boolean meaning **terminal**: both Settled and Refundable return true. It is
false while Executing. Clients must use `batchState` to distinguish outcomes.
`refundExpired(poolId, epoch, orders)` remains an optional bounded compatibility
wrapper that skips already recovered records. Primary recovery never needs it.

Deployment defaults are WINDOW=60, EXECUTION_WINDOW=300, and the temporarily
retained legacy EXCLUSIVITY_WINDOW=60. The settlement constructor rejects an
exclusive interval covering the entire execution window. Environment durations
are checked before narrowing to uint64. REFUND_DELAY has been replaced with
EXECUTION_WINDOW. Canonical verification and removal of exclusivity remain step 5.

## Validation

Validation completed with Forge 1.5.1, Solidity 0.8.26, via-IR/optimizer 200,
and Cancun, using the pinned local dependencies:

- `forge test --offline --no-match-contract 'GasCurveTest|SandwichHarness' -vv`: **182 passed, 0 failed, 18 suites**, including 11 fuzz tests with at least 512 runs each.
- After formatting the two new test files, their **21 tests passed again**.
- `forge build --offline --sizes`: passed; build includes the deployment script and benchmark fixtures. Existing lint/style suggestions are not audit clearance.
- `forge fmt --check` on every changed/new Solidity file and `git diff --check`: passed.

Optimized runtime/init bytecode sizes, in bytes:

| Contract | Runtime | Init |
|---|---:|---:|
| OtterHook | 2,406 | 13,229 |
| OtterLiquidityVault | 10,024 | 10,359 |
| OtterOrderBook | 14,581 | 15,113 |
| OtterSettlement | 11,233 | 11,752 |

Tests cover:

- 32 records and rejection of order 33; individual and aggregate amount bounds;
  accepted maximum asks; explicit timestamp overflow; nonce rollback.
- Exact settlement/expiry boundaries, terminal publication after complete
  accounting, stale epochs/configurations, v1 signatures, and modified signed
  execution limits.
- Independent refund without token balance queries, relayed record availability,
  repeated calls, recovery across epochs/pools, pause, and nonce words beyond 0.
- Valid/revoked EIP-1271 wallets, gas exhaustion, oversized return data, and
  oversized signatures.
- Real-core fee invalidation, LP withdrawal before trader recovery, zero-L and
  zero integer-reserve admission rejection, and LP-token admission callbacks.
- Fuzzed counts 1–32, cold expiry and one-record recovery with explicit external
  gas budgets, then conservation of all recovered escrow and claim balances.

Cold resource checks use Cancun gas rules and the repository's local compiler
settings. A 32-order native test uses distinct contract wallets, 512 nonzero
signature bytes each, near-aggregate-cap budgets, uint128 maximum asks, and a
wallet burning about 90,000 gas per validation. Book, token, guard, and wallet
accounts/storage are explicitly cooled. It uses a mock admission guard, so
these measurements do not include future pool/reward snapshots or canonical
counterfactuals, and do not establish target-chain limits. Transaction calldata
and base gas are reported separately using Cancun's 4/16-byte costs. Expiry and
one-record recovery are separately cooled and checked with 100k/150k call budgets.

Measured gas for that resource fixture:

| Operation | Gas |
|---|---:|
| Cold 32-wallet admission execution | 6,364,617 |
| Admission calldata/base intrinsic | 355,864 |
| Their sum | 6,720,481 |
| Cold expiry execution | 10,258 |
| Cold one-record recovery execution | 67,346 |

Execution measurements include the external-call harness overhead and exclude
transaction gas refunds. The expiry/recovery rows exclude their own intrinsic
transaction cost. Wallet deployments/signature construction belong to fixture
setup, not the measured submission. A 15M local admission envelope is asserted;
this is a scoped resource regression, not a claim of a universal worst case.

The saved gas-curve and sandwich generators are excluded from routine execution
because they overwrite published result files. Their v2 fixtures and size
probes compile; saved benchmarks are historical, not measurements of this version.

## Remaining risks and next checkpoint

This is safety/data availability progress, not grant readiness or an audit.
The active unsafe reproductions remaining are R2 (feasible solver discretion),
R6 (minority dust IR), and R7 (historical surplus capture). The original R3/R5/R8
reproductions remain in Git history; their active tests now require prevention.
Accepted-domain classification no longer panics on the extreme ask, but the
legacy solver/curve and partial-input policy still require step 4. Some admitted
batches can fail settlement and need expiry; bounded admission is not a guarantee
of economic feasibility, optimality, or a quote fitting the target chain.

**Queued LP exits are checkpoint 3B, not implemented here.** Expiry releases the
pool, but a new batch can still win the next transaction before an LP withdraws.
3B must reserve owner-authorized exits during the batch and block next admission
until those exits are processed without recipient transfers. Concentrated
custody remains supported; concentrated batch admission/execution remains gated.
Opening snapshots, tick-aware quotes, the discrete mechanism gates G1–G3,
canonical verification, historical rewards, wallet/operations, and independent
contract/economic reviews remain necessary before a grant-ready claim.

## User-created commit handoff

Suggested title: `fix: bound epochs and enable independent stored-order recovery`

Suggested explanation:

> Add v2 epoch/configuration/execution-bound orders and cap admission at 32
> records with checked amounts and signatures. Store orders for constant-work
> expiry and independent refunds, isolate recovery from token calls, and add
> bounded EIP-1271 validation, nonce invalidation, admission pause, and fee-drift
> recovery. Migrate contract fixtures and document the remaining mechanism and
> LP exit work.

Include the following changed/new files:

```text
README.md
reviews/REMEDIATION_PLAN.md
reviews/IMPLEMENTATION_SPEC.md
reviews/CHECKPOINT_3A.md
contracts/script/Deploy.s.sol
contracts/src/OtterOrderBook.sol
contracts/src/OtterLiquidityVault.sol
contracts/src/OtterSettlement.sol
contracts/src/interfaces/IOtterLiquidityGuard.sol
contracts/test/OtterEpochs.t.sol
contracts/test/OtterEpochIntegration.t.sol
contracts/test/GrantReview.t.sol
contracts/test/OtterOrderBook.t.sol
contracts/test/OtterOrderBookView.t.sol
contracts/test/OtterAssets.t.sol
contracts/test/OtterLiquidityVault.t.sol
contracts/test/OtterNativeSettlement.t.sol
contracts/test/OtterMargin.t.sol
contracts/test/OtterSettlement.t.sol
contracts/test/OtterSettlementSellX.t.sol
contracts/test/OtterSurplusToLPs.t.sol
contracts/test/SolverEndToEnd.t.sol
contracts/test/GasCurve.t.sol
contracts/test/SandwichHarness.t.sol
contracts/test/utils/MockLiquidityGuard.sol
contracts/test/utils/OtterHookFixture.sol
```

Stop after handing off; do not begin 3B until the user confirms this commit.
